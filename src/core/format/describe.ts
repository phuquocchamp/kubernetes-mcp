/**
 * kubectl_describe returned kubectl's raw describe output verbatim as
 * content[0].text (not JSON) — keep that exact shape.
 */
import type { DescribeResult } from "../operations/describe.js";

export function formatDescribe(result: DescribeResult): string {
  return result.raw;
}
