/**
 * exec_in_pod returned kubectl exec's stdout verbatim as content[0].text on
 * success — keep that exact shape.
 */
import type { ExecResult } from "../operations/exec.js";

export function formatExec(result: ExecResult): string {
  return result.output;
}
