import type { GenericResult } from "../operations/generic.js";

/** kubectl_generic returns kubectl's own stdout verbatim, same as the original tool. */
export function formatGeneric(result: GenericResult): string {
  return result.raw;
}
