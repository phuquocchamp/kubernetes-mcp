import type { ApiResourcesResult } from "../operations/api-resources.js";

export function formatApiResources(result: ApiResourcesResult): string {
  return result.raw;
}
