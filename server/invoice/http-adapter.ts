import type { OcrAdapter } from "./extract.js";
import { requireThat } from "../lib.js";
/** Explicit configured processor; image forwarding only after per-request recipient consent. */
export function httpOcr(
  endpoint: string,
  recipient: string,
  bearerToken?: string,
): OcrAdapter {
  requireThat(new URL(endpoint).protocol === "https:", "ocr_https_required");
  return {
    recipient,
    cloud: true,
    async extract(image, signal) {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/octet-stream",
          ...(bearerToken ? { Authorization: `Bearer ${bearerToken}` } : {}),
        },
        body: new Uint8Array(image),
        signal,
        redirect: "error",
      });
      requireThat(response.ok, "ocr_processor_failed", undefined, 502);
      const raw = await response.text();
      requireThat(raw.length <= 100000, "ocr_response_limit");
      return JSON.parse(raw);
    },
  };
}
