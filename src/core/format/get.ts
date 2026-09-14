/**
 * kubectl_get formatter — ported verbatim (list-shaping logic) from
 * src/tools/kubectl-get.ts. Keeps the exact same JSON shapes the old tool
 * returned as content[0].text: `{ events: [...] }` for an events list,
 * `{ items: [...] }` for any other resource list, or the raw
 * (possibly secret-masked) kubectl output otherwise.
 */
import { getResourceStatus } from "../operations/get.js";
import type { GetResult } from "../operations/get.js";

export function formatGet(result: GetResult): string {
  const { resourceType, output, raw, isListOperation } = result;

  if (isListOperation && output === "json") {
    try {
      const parsed = JSON.parse(raw);

      if (parsed.kind && parsed.kind.endsWith("List") && parsed.items) {
        if (resourceType === "events") {
          // biome-ignore lint/suspicious/noExplicitAny: mirrors raw kubectl JSON shape
          const formattedEvents = parsed.items.map((event: any) => ({
            type: event.type || "",
            reason: event.reason || "",
            message: event.message || "",
            involvedObject: {
              kind: event.involvedObject?.kind || "",
              name: event.involvedObject?.name || "",
              namespace: event.involvedObject?.namespace || "",
            },
            firstTimestamp: event.firstTimestamp || "",
            lastTimestamp: event.lastTimestamp || "",
            count: event.count || 0,
          }));

          return JSON.stringify({ events: formattedEvents }, null, 2);
        }

        // biome-ignore lint/suspicious/noExplicitAny: mirrors raw kubectl JSON shape
        const items = parsed.items.map((item: any) => ({
          name: item.metadata?.name || "",
          namespace: item.metadata?.namespace || "",
          kind: item.kind || resourceType,
          status: getResourceStatus(item, resourceType),
          createdAt: item.metadata?.creationTimestamp,
        }));

        return JSON.stringify({ items }, null, 2);
      }
    } catch (_parseError) {
      // If JSON parsing fails, fall through and return the raw output.
    }
  }

  return raw;
}
