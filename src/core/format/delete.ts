import type { DeleteResult } from "../operations/delete.js";

/** kubectl_delete returns kubectl's own stdout verbatim, same as the original tool. */
export function formatDelete(result: DeleteResult): string {
  return result.raw;
}
