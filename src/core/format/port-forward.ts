/**
 * Keeps the same JSON shape { success, message } the original tool returned
 * as content[0].text for both port_forward and stop_port_forward (the
 * generated `id` is not part of that shape — it never was in the original
 * response body either, only used internally for tracking).
 */
import type { PortForwardResult, StopPortForwardResult } from "../operations/port-forward.js";

export function formatPortForward(result: PortForwardResult): string {
  return JSON.stringify({ success: result.success, message: result.message }, null, 2);
}

export function formatStopPortForward(result: StopPortForwardResult): string {
  return JSON.stringify({ success: result.success, message: result.message }, null, 2);
}
