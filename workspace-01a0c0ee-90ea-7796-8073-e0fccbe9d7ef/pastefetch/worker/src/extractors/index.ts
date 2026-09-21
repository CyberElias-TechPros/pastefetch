import type { ResolvePayload } from "../types";
import * as reddit from "./reddit";
import * as vimeo from "./vimeo";
import * as streamable from "./streamable";

export interface NativeExtractor {
  resolve(url: URL): Promise<ResolvePayload>;
}

/** Tier-1 extractors that run natively inside the Worker. */
export const NATIVE_EXTRACTORS: Record<string, NativeExtractor> = {
  reddit: { resolve: (url) => reddit.resolve(url) },
  vimeo: { resolve: (url) => vimeo.resolve(url) },
  streamable: { resolve: (url) => streamable.resolve(url) },
};
