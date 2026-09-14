/**
 * Formats a LogsResult into the same JSON shapes kubectl-logs.ts returned
 * as its content[0].text: { name, logs } for a single pod, { message } for
 * an empty-selector/empty-jobs case, { selector, namespace, logs } for a
 * label-selector fan-out, and { cronjob, namespace, jobs } for a cronjob.
 */
import type { LogsResult } from "../operations/logs.js";

export function formatLogs(result: LogsResult): string {
  switch (result.kind) {
    case "pod":
      return JSON.stringify({ name: result.name, logs: result.logs }, null, 2);
    case "message":
      return JSON.stringify({ message: result.message }, null, 2);
    case "selector":
      return JSON.stringify(
        { selector: result.selector, namespace: result.namespace, logs: result.logs },
        null,
        2,
      );
    case "cronjob":
      return JSON.stringify(
        { cronjob: result.cronjob, namespace: result.namespace, jobs: result.jobs },
        null,
        2,
      );
  }
}
