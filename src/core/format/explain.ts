import type { ExplainResult } from "../operations/explain.js";

export function formatExplain(result: ExplainResult): string {
  return result.raw;
}
