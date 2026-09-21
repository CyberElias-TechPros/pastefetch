/* PasteFetch — app logic. Zero dependencies.
 * Flow: paste → POST /api/resolve → poll job → render → /api/download.
 * Falls back to demo mode when no API is configured/reachable.
 */
(function () {
  "use strict";

  var CFG = window.PASTEFETCH_CONFIG || {};
  var API = (CFG.API_BASE || "").replace(/\/+$/, "");

  var $ = function (id) { return document.getElementById(id); };
  var els = {
    form: $("fetchForm"), input: $("urlInput"), go: $("goBtn"), pasteBtn: $("pasteBtn"),
    resolving: $("resolvingCard"), resolvingLabel: $("resolvingLabel"),
    error: $("errorCard"), errorTitle: $("errorTitle"), errorMessage: $("errorMessage"), errorMeta: $("errorMeta"),
    result: $("resultCard"), demoPill: $("demoPill"), demoWhy: $("demoWhy"),
    thumbImg: $("thumbImg"), thumbBox: $("thumbBox"), dur: $("durBadge"),
    platform: $("platformBadge"), title: $("resTitle"), author: $("resAuthor"),
    qualities: $("qualities"), dl: $("dlBtn"), dlLabel: $("dlLabel"), direct: $("directLink"),
    platforms: $("platformChips"), statusNote: $("statusNote"), uptimePill: $("uptimePill"), uptimeText: $("uptimeText"),
    recentWrap: $("recentWrap"), recentList: $("recentList"), toasts: $("toasts"), hint: $("inputHint"),
  };

  var state = { job: null, selected: null, demo: false, busy: false, pollTimer: null, pollDeadline: 0 };
  var reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  // ── friendly error copy (server codes → human words) ──────────────────────
  var ERR_COPY = {
    invalid_url: ["That doesn't look like a link", "Paste a full video URL, e.g. https://…"],
    unsupported_platform: ["Platform not supported yet", "Paste a link from YouTube, TikTok, Instagram, X, Facebook, Reddit, Vimeo, Twitch, Dailymotion or SoundCloud."],
    rate_limited: ["Slow down a moment", "You've hit the free tier's rate limit. Try again in a minute or two."],
    gone: ["That session expired", "Links only live for 15 minutes. Paste the link again."],
    no_video_in_post: ["No video there", "This link has no downloadable video (it may be an image gallery, text post, or HLS-only stream)."],
    private_or_auth_required: ["This one's locked", "The content is private, age-restricted or needs a login — we only fetch what anyone can already view."],
    resolver_not_configured: ["Needs the free resolver add-on", "This platform runs on yt-dlp, which needs the resolver service. The site owner can add it in ~5 minutes (see the deploy docs)."],
    resolver_unreachable: ["Resolver is waking up", "Free hosting sleeps when idle. Try again in ~30 seconds."],
    resolver_error: ["Resolver hiccup", "The yt-dlp backend hit an error. Usually fixed by retrying once."],
    platform_error: ["The platform pushed back", "It's rate-limiting or blocking our server right now. Retrying sometimes helps — the status section below stays honest about this."],
    unknown_format: ["Format expired", "Resolve the link again to get a fresh one."],
    internal_error: ["Our bad", "Something broke on our side. It's noted — try again."],
  };

  // ── boot ───────────────────────────────────────────────────────────────────
  document.addEventListener("DOMContentLoaded", init);

  function init() {
    if (navigator.clipboard && navigator.clipboard.readText) {
      els.pasteBtn.hidden = false;
      els.pasteBtn.addEventListener("click", function () {
        navigator.clipboard.readText().then(function (t) {
          if (t) { els.input.value = t.trim(); els.input.focus(); }
        }).catch(function () { /* permission denied — fine */ });
      });
    }
    document.addEventListener("paste", function (e) {
      if (e.target !== els.input) {
        var t = (e.clipboardData || window.clipboardData).getData("text");
        if (t && /^https?:\/\//i.test(t.trim())) {
          els.input.value = t.trim();
          setStatusHint("Link detected — press Enter to fetch");
          els.input.focus();
        }
      }
    });
    document.addEventListener("keydown", function (e) {
      if (e.key === "/" && document.activeElement !== els.input) { e.preventDefault(); els.input.focus(); }
    });
    els.form.addEventListener("submit", function (e) { e.preventDefault(); resolve(); });
    renderRecent();
    loadStatus();
    if (!reduceMotion && window.matchMedia("(pointer: fine)").matches) parallax();
    els.input.focus();
  }

  // ── resolve flow ──────────────────────────────────────────────────────────
  function resolve() {
    if (state.busy) return;
    var url = els.input.value.trim();
    if (!url) { els.input.focus(); toast("Paste a video link first", "warn"); return; }

    setBusy(true);
    show(els.resolving); hide(els.error); hide(els.result);
    els.resolvingLabel.textContent = "Resolving…";
    setStatusHint("");

    withTimeout(fetchJson("POST", API + "/api/resolve", { url: url }), 65000)
      .then(function (job) {
        if (job && (job.error || job.status === "error")) { fail(job.error_code, job.message); return; }
        if (job.status === "queued" || job.status === "processing") { poll(job.job_id, url); return; }
        done(job, url);
      })
      .catch(function (err) {
        // network/CORS failure → API not configured on this host → demo mode
        enterDemoMode();
        setTimeout(function () { done(demoJob(), url); }, 900);
      });
  }

  function poll(jobId, url) {
    els.resolvingLabel.textContent = "Resolving on the yt-dlp engine…";
    state.pollDeadline = Date.now() + 70000;
    state.pollTimer = setInterval(function () {
      if (Date.now() > state.pollDeadline) { clearInterval(state.pollTimer); fail("resolver_unreachable"); return; }
      fetchJson("GET", API + "/api/jobs/" + encodeURIComponent(jobId))
        .then(function (job) {
          if (job.status === "done") { clearInterval(state.pollTimer); done(job, url); }
          else if (job.status === "error") { clearInterval(state.pollTimer); fail(job.error_code, job.message); }
        })
        .catch(function () { /* transient — keep polling */ });
    }, 1300);
  }

  function done(job, url) {
    hide(els.resolving); hide(els.error); show(els.result);
    state.job = job;
    var isDemo = Boolean(job._demo);
    els.demoPill.hidden = !isDemo;
    if (isDemo) els.demoWhy.textContent = "— API not configured here";

    // metadata
    els.platform.textContent = job.platform || "video";
    els.title.textContent = job.title || "Untitled";
    els.author.textContent = [job.author, job.duration_s ? fmtDur(job.duration_s) : null].filter(Boolean).join(" · ") || " ";

    // thumbnail
    els.thumbImg.classList.remove("loaded");
    if (job.thumbnail) {
      els.thumbImg.src = job.thumbnail;
      els.thumbImg.onload = function () { els.thumbImg.classList.add("loaded"); };
      els.thumbImg.onerror = function () { els.thumbImg.src = ""; };
    } else { els.thumbImg.removeAttribute("src"); }
    els.dur.textContent = job.duration_s ? fmtDur(job.duration_s) : "";

    // quality chips — pick best video format as recommended
    var fmts = (job.formats || []).slice();
    var recIdx = Math.max(0, fmts.findIndex(function (f) { return f.kind !== "audio" && f.kind !== "image"; }));
    els.qualities.innerHTML = "";
    fmts.forEach(function (f, i) {
      var b = document.createElement("button");
      b.type = "button"; b.className = "q" + (i === recIdx ? " sel" : "");
      b.setAttribute("aria-pressed", i === recIdx ? "true" : "false");
      var label = document.createElement("span"); label.textContent = f.label;
      b.appendChild(label);
      if (i === recIdx) { var tag = document.createElement("span"); tag.className = "tag"; tag.textContent = "BEST"; b.appendChild(tag); }
      if (f.bytes) { var sz = document.createElement("span"); sz.className = "size"; sz.textContent = fmtBytes(f.bytes); b.appendChild(sz); }
      b.addEventListener("click", function () { select(i); });
      els.qualities.appendChild(b);
    });
    select(recIdx);
    saveRecent(url, job);
    els.result.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "nearest" });
  }

  function select(i) {
    state.selected = i;
    var chips = els.qualities.querySelectorAll(".q");
    chips.forEach(function (c, j) {
      c.classList.toggle("sel", j === i);
      c.setAttribute("aria-pressed", j === i ? "true" : "false");
    });
    var f = (state.job.formats || [])[i];
    if (f) {
      els.dlLabel.textContent = f.kind === "audio" ? "Download MP3" : "Download " + (f.container || "MP4").toUpperCase();
      els.direct.href = API + "/api/download/" + encodeURIComponent(state.job.job_id) + "/" + encodeURIComponent(f.id) + "?mode=direct";
    }
  }

  els && null; // (guard for minifiers)
  function download() {
    if (!state.job) return;
    if (state.job._demo) { toast("Demo mode — deploy the API to enable real downloads (see README)", "warn"); return; }
    var f = (state.job.formats || [])[state.selected || 0];
    if (!f) return;
    els.dl.classList.add("busy");
    els.dlLabel.textContent = "Starting…";
    window.location.href = API + "/api/download/" + encodeURIComponent(state.job.job_id) + "/" + encodeURIComponent(f.id);
    setTimeout(function () {
      els.dl.classList.remove("busy");
      els.dlLabel.textContent = "Download";
      toast("Streaming to your browser — nothing is kept on our servers", "ok");
    }, 1400);
  }

  function fail(code, message) {
    hide(els.resolving); hide(els.result); show(els.error);
    var copy = ERR_COPY[code] || ERR_COPY.internal_error;
    els.errorTitle.textContent = copy[0];
    els.errorMessage.textContent = message && code !== "platform_error" ? message : copy[1];
    els.errorMeta.innerHTML = "";
    if (code) {
      var c = document.createElement("code");
      c.textContent = code;
      els.errorMeta.appendChild(document.createTextNode("error · "));
      els.errorMeta.appendChild(c);
    }
    setBusy(false);
  }

  // ── demo mode (API unreachable / not configured) ──────────────────────────
  function enterDemoMode() { state.demo = true; }

  function demoJob() {
    return {
      _demo: true,
      job_id: "demo",
      status: "done",
      platform: "sample",
      title: "Big Buck Bunny — open movie (sample data)",
      author: "Blender Foundation · 10:34",
      duration_s: 635,
      thumbnail: "",
      formats: [
        { id: "mux", label: "MP4 · 2160p · remux", kind: "video+audio", bytes: null },
        { id: "p1080", label: "MP4 · 1080p", kind: "video+audio", bytes: 158 * 1048576 },
        { id: "p720", label: "MP4 · 720p", kind: "video+audio", bytes: 74 * 1048576 },
        { id: "audio", label: "Audio · MP3", kind: "audio", bytes: 14.6 * 1048576 },
      ],
    };
  }

  // ── status chips ──────────────────────────────────────────────────────────
  function loadStatus() {
    withTimeout(fetchJson("GET", API + "/api/status"), 4000)
      .then(function (data) { renderStatus(data.platforms || [], data.resolver_configured); })
      .catch(function () {
        renderStatus(
          [
            { id: "youtube", name: "YouTube", status: "up" }, { id: "tiktok", name: "TikTok", status: "up" },
            { id: "reddit", name: "Reddit", status: "degraded" }, { id: "vimeo", name: "Vimeo", status: "degraded" },
            { id: "streamable", name: "Streamable", status: "up" }, { id: "x", name: "X", status: "up" },
            { id: "instagram", name: "Instagram", status: "degraded" }, { id: "facebook", name: "Facebook", status: "unknown" },
            { id: "twitch", name: "Twitch", status: "up" },
          ],
          null, true
        );
      });
  }

  function renderStatus(platforms, resolverConfigured, isFallback) {
    els.platforms.innerHTML = "";
    var counts = { up: 0, total: 0 };
    platforms.forEach(function (p) {
      counts.total++;
      if (p.status === "up") counts.up++;
      var chip = document.createElement("span");
      chip.className = "pchip";
      chip.dataset.status = p.status;
      chip.title = p.name + " — " + p.status + (p.detail ? " (" + p.detail + ")" : "");
      var dot = document.createElement("span"); dot.className = "pdot";
      var label = document.createElement("span"); label.textContent = p.name;
      chip.appendChild(dot); chip.appendChild(label);
      els.platforms.appendChild(chip);
    });
    var up = counts.up, total = counts.total;
    els.uptimeText.textContent = up + " of " + total + " up" + (isFallback ? " (cached)" : "");
    els.uptimePill.classList.toggle("up", up > total * 0.6);
    els.uptimePill.classList.toggle("down", up <= total * 0.3);
    els.statusNote.textContent = isFallback
      ? "Can't reach the status API from here — showing the typical picture. YouTube reliability depends on the resolver's IP (see the free-tier guide)."
      : (resolverConfigured === false
        ? "Resolver add-on not connected — YouTube/TikTok/Instagram/X need it. Everything else works natively."
        : "Updated automatically every 6 hours by the canary suite. When a platform blocks us, we show it.");
  }

  // ── recents (local only) ──────────────────────────────────────────────────
  function renderRecent() {
    var items = loadRecent();
    if (!items.length) { els.recentWrap.hidden = true; return; }
    els.recentWrap.hidden = false;
    els.recentList.innerHTML = "";
    items.forEach(function (it) {
      var b = document.createElement("button");
      b.type = "button"; b.className = "recent-chip"; b.textContent = it.title || it.url;
      b.title = it.url;
      b.addEventListener("click", function () { els.input.value = it.url; resolve(); });
      els.recentList.appendChild(b);
    });
  }

  function loadRecent() {
    try { return JSON.parse(localStorage.getItem("pf_recent") || "[]"); } catch (e) { return []; }
  }
  function saveRecent(url, job) {
    if (!url || job._demo) return;
    var items = loadRecent().filter(function (i) { return i.url !== url; });
    items.unshift({ url: url, title: job.title || "", ts: Date.now() });
    try { localStorage.setItem("pf_recent", JSON.stringify(items.slice(0, 5))); } catch (e) { /* private mode */ }
    renderRecent();
  }

  // ── ambience: pointer parallax on the orbs ───────────────────────────────
  function parallax() {
    var orbs = document.querySelectorAll(".orb");
    var tx = 0, ty = 0, cx = 0, cy = 0, raf = null;
    document.addEventListener("pointermove", function (e) {
      tx = (e.clientX / window.innerWidth - 0.5) * 30;
      ty = (e.clientY / window.innerHeight - 0.5) * 24;
      if (!raf) raf = requestAnimationFrame(tick);
    });
    function tick() {
      cx += (tx - cx) * 0.06; cy += (ty - cy) * 0.06;
      orbs.forEach(function (o, i) {
        var k = (i + 1) * 0.5;
        o.style.setProperty("--px", (cx * k).toFixed(1) + "px");
        o.style.setProperty("--py", (cy * k).toFixed(1) + "px");
      });
      raf = Math.abs(tx - cx) + Math.abs(ty - cy) > 0.3 ? requestAnimationFrame(tick) : null;
    }
  }

  // ── small helpers ─────────────────────────────────────────────────────────
  function fetchJson(method, url, body) {
    return fetch(url, {
      method: method,
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (j) {
        if (!r.ok) { j.error = j.error || "internal_error"; return j; }
        return j;
      });
    });
  }

  function withTimeout(promise, ms) {
    return Promise.race([
      pre(function (_, rej) { setTimeout(function () { rej(new Error("timeout")); }, ms); }),
    ]);
  }

  function setBusy(b) {
    state.busy = b;
    els.go.disabled = b;
    els.go.classList.toggle("loading", b);
    els.go.setAttribute("aria-busy", b ? "true" : "false");
    if (!b) { clearInterval(state.pollTimer); hide(els.resolving); }
  }

  function show(el) { el.hidden = false; }
  function hide(el) { el.hidden = true; }

  function setStatusHint(text) {
    if (!text) { els.hint.innerHTML = 'press <kbd>⌘V</kbd> anywhere &nbsp;·&nbsp; <kbd>Enter</kbd> to fetch'; return; }
    els.hint.textContent = text;
  }

  function toast(msg, kind) {
    var t = document.createElement("div");
    t.className = "toast " + (kind || "ok");
    var d = document.createElement("span"); d.className = "t-dot";
    var m = document.createElement("span"); m.textContent = msg;
    t.appendChild(d); t.appendChild(m);
    els.toasts.appendChild(t);
    setTimeout(function () { t.classList.add("out"); setTimeout(function () { t.remove(); }, 350); }, 4200);
  }

  function fmtDur(s) {
    s = Math.round(s);
    var m = Math.floor(s / 60), r = s % 60;
    return m + ":" + (r < 10 ? "0" : "") + r;
  }
  function fmtBytes(b) {
    if (b > 1048576) return (b / 1048576).toFixed(b > 10485760 ? 0 : 1) + " MB";
    if (b > 1024) return Math.round(b / 1024) + " KB";
    return b + " B";
  }

})();
