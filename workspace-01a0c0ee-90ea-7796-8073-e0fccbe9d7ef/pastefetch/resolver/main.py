"""
PasteFetch resolver — the yt-dlp + ffmpeg microservice.

Deploy anywhere that runs containers (Hugging Face Space, Koyeb, Render,
Oracle Always Free, or your own machine). The Cloudflare Worker calls
POST /resolve for Tier-2 platforms (YouTube, TikTok, Instagram, X, …)
and 302-redirects browsers to the signed GET /stream for IP-locked files.

Zero storage: metadata lives in memory for the length of the request;
media streams through pipes only.

Env:
  RESOLVER_TOKEN       shared secret with the Worker (required in prod)
  YTDLP_COOKIES_FILE   optional Netscape cookies.txt (YouTube/Vimeo login)
  MAX_BYTES            per-download cap, default 2 GiB
  CONCURRENCY          parallel resolve/stream cap, default 4
"""

from __future__ import annotations

import asyncio
import hashlib
import hmac
import os
import shutil
import subprocess
import time
from typing import Any, AsyncIterator, Iterator

import httpx
import yt_dlp
from fastapi import FastAPI, Header, HTTPException, Query, Response
from fastapi.responses import JSONResponse, StreamingResponse
from pydantic import BaseModel

TOKEN = os.environ.get("RESOLVER_TOKEN", "")
COOKIES_FILE = os.environ.get("YTDLP_COOKIES_FILE", "")
MAX_BYTES = int(os.environ.get("MAX_BYTES", str(2 * 1024 * 1024 * 1024)))
CONCURRENCY = int(os.environ.get("CONCURRENCY", "4"))
STREAM_URL_TTL = 600

_semaphore = asyncio.Semaphore(CONCURRENCY)
app = FastAPI(title="pastefetch-resolver", docs_url=None, redoc_url=None)

UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36"


# ── auth ──────────────────────────────────────────────────────────────────────
def require_token(authorization: str | None) -> None:
    if not TOKEN:
        return  # local dev without a token set — production must set one
    if authorization != f"Bearer {TOKEN}":
        raise HTTPException(status_code=401, detail="bad token")


def verify_stream_signature(u: str, u2: str, t: str, fn: str, e: str, s: str) -> None:
    if not TOKEN:
        return
    expected = hmac.new(TOKEN.encode(), "\n".join([u, u2, t, fn, e]).encode(), hashlib.sha256).hexdigest()
    if not hmac.compare_digest(expected, s):
        raise HTTPException(status_code=403, detail="bad signature")
    if int(e) < int(time.time()):
        raise HTTPException(status_code=410, detail="link expired — resolve again")


# ── helpers ───────────────────────────────────────────────────────────────────
def _ydl_opts() -> dict[str, Any]:
    opts: dict[str, Any] = {
        "quiet": True,
        "no_warnings": True,
        "skip_download": True,
        "noplaylist": True,
        "socket_timeout": 20,
        "nocheckcertificate": False,
    }
    if COOKIES_FILE and os.path.exists(COOKIES_FILE):
        opts["cookiefile"] = COOKIES_FILE
    return opts


def platform_error(exc: Exception) -> JSONResponse:
    """Map a yt-dlp failure to the API's honest error codes."""
    text = str(exc)
    lowered = text.lower()
    if "http error 403" in lowered or "http error 429" in lowered:
        code, msg = "platform_error", "The platform refused this server's IP (blocked or rate-limited)"
    elif any(k in lowered for k in ("sign in", "login", "private", "requested content is not available", "account")):
        code, msg = "private_or_auth_required", "This content requires a login or is private"
    elif "unsupported url" in lowered:
        code, msg = "unsupported_url", "yt-dlp does not support this link"
    elif "404" in text or "not found" in lowered or "no video" in lowered or "no formats" in lowered:
        code, msg = "no_video_in_post", "No downloadable video at that link"
    elif "geo" in lowered or "country" in lowered:
        code, msg = "platform_error", "This content is geo-restricted from the resolver's location"
    elif "age" in lowered and "confirm" in lowered:
        code, msg = "private_or_auth_required", "Age-restricted content requires cookies"
    else:
        code, msg = "platform_error", text[:220]
    return JSONResponse(status_code=422, content={"error": code, "detail": msg})


def _needs_ffmpeg(fmt: dict[str, Any]) -> bool:
    url = fmt.get("url") or ""
    return bool(fmt.get("url2") or fmt.get("transcode") or ".m3u8" in url or ".mpd" in url)


def pick_formats(info: dict[str, Any]) -> list[dict[str, Any]]:
    """Select and normalize the formats we offer. Pure function — easy to test."""
    raw: list[dict[str, Any]] = info.get("formats") or []
    if not raw and info.get("url"):  # single-format extraction
        return [
            {
                "id": "best",
                "label": (info.get("ext") or "mp4").upper(),
                "container": info.get("ext") or "mp4",
                "kind": "video+audio",
                "bytes": info.get("filesize") or info.get("filesize_approx"),
                "url": info["url"],
            }
        ]

    def has_url(f: dict[str, Any]) -> bool:
        return bool(f.get("url"))

    progressive = [
        f
        for f in raw
        if has_url(f) and f.get("vcodec") not in (None, "none") and f.get("acodec") not in (None, "none") and (f.get("ext") or "") in ("mp4", "mov", "m4v", "webm")
    ]
    video_only = [f for f in raw if has_url(f) and f.get("vcodec") not in (None, "none") and f.get("acodec") in (None, "none")]
    audio_only = [f for f in raw if has_url(f) and f.get("acodec") not in (None, "none") and f.get("vcodec") in (None, "none")]

    progressive.sort(key=lambda f: (f.get("height") or 0), reverse=True)
    video_only.sort(key=lambda f: (f.get("height") or 0, f.get("tbr") or 0), reverse=True)
    audio_only.sort(key=lambda f: (f.get("abr") or f.get("tbr") or 0), reverse=True)

    formats: list[dict[str, Any]] = []
    seen: set[int] = set()
    for f in progressive[:6]:
        height = f.get("height") or 0
        if height in seen:
            continue
        seen.add(height)
        formats.append(
            {
                "id": f"p{height or 'best'}",
                "label": f"MP4 · {height}p" if height else "MP4",
                "container": "mp4" if (f.get("ext") or "mp4") in ("mp4", "mov", "m4v") else "webm",
                "kind": "video+audio",
                "bytes": f.get("filesize") or f.get("filesize_approx"),
                "url": f["url"],
            }
        )

    # best adaptive pair → ffmpeg remux at stream time (usually the highest quality)
    if video_only and audio_only:
        best_video = video_only[0]
        if (best_video.get("height") or 0) > max(seen or {0}):
            formats.append(
                {
                    "id": "mux",
                    "label": f"MP4 · {best_video.get('height')}p+ · remux",
                    "container": "mp4",
                    "kind": "video+audio",
                    "bytes": best_video.get("filesize") or best_video.get("filesize_approx"),
                    "url": best_video["url"],
                    "url2": audio_only[0]["url"],
                }
            )

    # audio: transcode the best audio stream to MP3 on the fly
    if audio_only:
        formats.append(
            {
                "id": "audio",
                "label": "Audio · MP3",
                "container": "mp3",
                "kind": "audio",
                "bytes": None,
                "url": audio_only[0]["url"],
                "transcode": "mp3",
            }
        )

    # nothing browser-friendly → stream the best thing we have through ffmpeg
    if not formats:
        usable = [f for f in raw if has_url(f)]
        if usable:
            best = max(usable, key=lambda f: (f.get("height") or 0, f.get("tbr") or 0))
            formats.append(
                {
                    "id": "best",
                    "label": "Best available · streamed",
                    "container": "mp4",
                    "kind": "video",
                    "bytes": None,
                    "url": best["url"],
                }
            )

    # HLS/DASH can't be 302'd to a browser — force streaming through us
    for f in formats:
        if _needs_ffmpeg(f):
            f["proxy"] = "resolver"
    return formats


# ── endpoints ─────────────────────────────────────────────────────────────────
class ResolveRequest(BaseModel):
    url: str


@app.post("/resolve", response_model=None)
def resolve(body: ResolveRequest, authorization: str | None = Header(default=None)) -> JSONResponse | dict[str, Any]:
    require_token(authorization)
    try:
        with yt_dlp.YoutubeDL(_ydl_opts()) as ydl:
            info = ydl.extract_info(body.url, download=False)
    except yt_dlp.utils.DownloadError as exc:
        return platform_error(exc)
    except Exception as exc:  # noqa: BLE001 — surface anything else honestly
        return platform_error(exc)

    if not info:
        return JSONResponse(status_code=422, content={"error": "no_video_in_post", "detail": "Nothing found"})
    if info.get("_type") == "playlist":
        entries = info.get("entries") or []
        if not entries:
            return JSONResponse(status_code=422, content={"error": "no_video_in_post", "detail": "Empty playlist"})
        info = entries[0]

    formats = pick_formats(info)
    if not formats:
        return JSONResponse(status_code=422, content={"error": "no_video_in_post", "detail": "No downloadable formats"})

    return {
        "platform": (info.get("extractor_key") or info.get("extractor") or "video").lower(),
        "title": info.get("title") or "video",
        "author": info.get("uploader") or info.get("channel") or None,
        "duration_s": info.get("duration"),
        "thumbnail": info.get("thumbnail"),
        "ip_locked": (info.get("extractor_key") or "").lower() == "youtube",
        "formats": formats,
    }


@app.get("/stream")
def stream(
    u: str = Query(...),
    fn: str = Query("video.mp4"),
    e: str = Query(...),
    s: str = Query(...),
    u2: str = Query(default=""),
    t: str = Query(default=""),
) -> Response:
    verify_stream_signature(u, u2, t, fn, e, s)
    safe_name = os.path.basename(fn)[:120] or "video.mp4"
    media_type = "audio/mpeg" if t == "mp3" else "video/mp4"
    headers = {
        "Content-Disposition": f"attachment; filename*=UTF-8''{safe_name}",
        "Cache-Control": "no-store",
    }

    if u2 or t or ".m3u8" in u or ".mpd" in u:
        return StreamingResponse(ffmpeg_pipe(u, u2, t), media_type=media_type, headers=headers)
    return StreamingResponse(http_pipe(u), media_type=media_type, headers=headers)


def ffmpeg_pipe(u: str, u2: str, t: str) -> Iterator[bytes]:
    args = ["ffmpeg", "-hide_banner", "-loglevel", "error", "-nostdin"]
    if t == "mp3":
        args += ["-i", u, "-vn", "-c:a", "libmp3lame", "-b:a", "192k", "-f", "mp3", "pipe:1"]
    else:
        args += ["-i", u]
        if u2:
            args += ["-i", u2, "-map", "0:v:0", "-map", "1:a:0"]
        args += ["-c", "copy", "-f", "mp4", "-movflags", "frag_keyframe+empty_moov", "pipe:1"]

    proc = subprocess.Popen(args, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)  # noqa: S603
    try:
        assert proc.stdout is not None
        sent = 0
        while True:
            chunk = proc.stdout.read(64 * 1024)
            if not chunk:
                break
            sent += len(chunk)
            if sent > MAX_BYTES:
                break
            yield chunk
    finally:
        proc.kill()


async def http_pipe(url: str) -> AsyncIterator[bytes]:
    async with httpx.AsyncClient(follow_redirects=True, timeout=httpx.Timeout(30, read=60)) as client:
        async with client.stream("GET", url, headers={"User-Agent": UA}) as resp:
            if resp.status_code >= 400:
                raise HTTPException(status_code=502, detail=f"CDN responded {resp.status_code}")
            sent = 0
            async for chunk in resp.aiter_bytes(64 * 1024):
                sent += len(chunk)
                if sent > MAX_BYTES:
                    break
                yield chunk


@app.get("/health")
def health() -> dict[str, Any]:
    return {
        "ok": True,
        "resolver": "pastefetch",
        "ytdlp_version": yt_dlp.version.__version__,
        "ffmpeg": bool(shutil.which("ffmpeg")),
        "cookies_configured": bool(COOKIES_FILE and os.path.exists(COOKIES_FILE)),
    }


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=int(os.environ.get("PORT", "7860")))
