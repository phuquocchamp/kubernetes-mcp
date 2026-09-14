import type { ApplyResult } from "../operations/apply.js";

export function formatApply(result: ApplyResult): string {
  return result.raw;
}
