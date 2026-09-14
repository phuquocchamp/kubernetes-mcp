import type { ContextResult, ReconnectResult } from "../operations/context.js";

export function formatContext(result: ContextResult): string {
  switch (result.kind) {
    case "list-structured":
      return JSON.stringify({ contexts: result.contexts }, null, 2);
    case "list-raw":
      return result.raw;
    case "get-simple":
      return JSON.stringify({ currentContext: result.currentContext }, null, 2);
    case "get-detailed":
      return JSON.stringify(
        {
          name: result.name,
          cluster: result.cluster,
          user: result.user,
          namespace: result.namespace,
        },
        null,
        2,
      );
    case "set":
      return JSON.stringify(
        { success: true, message: result.message, context: result.context },
        null,
        2,
      );
  }
}

export function formatReconnect(result: ReconnectResult): string {
  return JSON.stringify(result, null, 2);
}
