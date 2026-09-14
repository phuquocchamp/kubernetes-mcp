import type { PingResult } from "../operations/ping.js";

export function formatPing(result: PingResult): string {
  return JSON.stringify(result, null, 2);
}
