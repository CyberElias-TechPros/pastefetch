import type { Env } from "./types";

export type Params = Record<string, string>;
export type Handler = (req: Request, params: Params, env: Env, ctx: ExecutionContext) => Promise<Response>;

interface Route {
  method: string;
  segments: string[];
  handler: Handler;
}

/** Minimal zero-dependency router with `:param` segments. */
export class Router {
  private routes: Route[] = [];

  on(method: string, path: string, handler: Handler): this {
    this.routes.push({ method, segments: path.split("/").filter(Boolean), handler });
    return this;
  }

  async dispatch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response | null> {
    const { pathname } = new URL(req.url);
    const segments = pathname.split("/").filter(Boolean);
    for (const route of this.routes) {
      if (route.method !== req.method) continue;
      const params = match(route.segments, segments);
      if (params) return route.handler(req, params, env, ctx);
    }
    return null;
  }
}

function match(pattern: string[], actual: string[]): Params | null {
  if (pattern.length !== actual.length) return null;
  const params: Params = {};
  for (let i = 0; i < pattern.length; i++) {
    const p = pattern[i] as string;
    const a = actual[i] as string;
    if (p.startsWith(":")) {
      params[p.slice(1)] = decodeURIComponent(a);
    } else if (p !== a) {
      return null;
    }
  }
  return params;
}
