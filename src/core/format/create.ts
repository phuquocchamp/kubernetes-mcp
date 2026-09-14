/**
 * kubectl_create's original tool returns raw kubectl stdout as
 * `content[0].text` (not JSON — the default output format is `-o yaml`, and
 * a caller can request any other `-o` format too). Preserve that verbatim.
 */
import type { CreateResult } from "../operations/create.js";

export function formatCreate(result: CreateResult): string {
  return result.raw;
}
