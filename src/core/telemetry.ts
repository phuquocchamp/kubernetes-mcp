/**
 * OpenTelemetry span wrapper for kubectl/helm invocations.
 *
 * Ported from src/middleware/telemetry-middleware.ts's withTelemetry(),
 * re-homed at the single spawn point (core/kubectl.ts) instead of wrapping
 * the whole CallToolRequest dispatcher — the dispatcher no longer exists,
 * and every converted operation already funnels through runKubectl/runHelm,
 * so this covers the same tool calls without touching any of the 10
 * converted tools/*.ts or core/operations/*.ts files.
 *
 * Coverage note: tools that never call kubectl/helm (ping, kubectl_context,
 * kubectl_reconnect, cleanup, port_forward's own long-lived spawn) get no
 * span from this. That's a smaller gap than it sounds — the previous
 * dispatcher-level middleware traced ALL of them, but those five are also
 * the lowest-value telemetry targets (cheap, rarely fail, or long-running
 * by design). Left as a follow-up rather than threading a span through
 * every operation file individually.
 */
import { type Span, SpanStatusCode, trace } from "@opentelemetry/api";
import { serverConfig } from "../config/server-config.js";
import { getTelemetryConfig } from "../config/telemetry-config.js";

const tracer = trace.getTracer(serverConfig.name, serverConfig.version);

export async function withCommandSpan<T>(
  command: string,
  args: string[],
  operation: string,
  fn: () => Promise<T>,
): Promise<T> {
  return tracer.startActiveSpan(
    `tools/call ${operation}`,
    {
      attributes: {
        "mcp.method.name": "tools/call",
        "gen_ai.tool.name": operation,
        "gen_ai.operation.name": "execute_tool",
        "network.transport": "pipe",
        "process.command": command,
        "process.argument_count": args.length,
      },
    },
    async (span: Span) => {
      const startTime = Date.now();
      try {
        const result = await fn();
        span.setAttribute("tool.duration_ms", Date.now() - startTime);
        span.setStatus({ code: SpanStatusCode.OK });
        if (getTelemetryConfig().captureResponseMetadata && typeof result === "string") {
          span.setAttribute("response.text_size_bytes", result.length);
        }
        return result;
      } catch (error: any) {
        span.setAttribute("tool.duration_ms", Date.now() - startTime);
        span.setAttribute("error.type", "tool_error");
        if (error?.code) span.setAttribute("error.code", String(error.code));
        span.setStatus({
          code: SpanStatusCode.ERROR,
          message: error?.message || "Command execution failed",
        });
        throw error;
      } finally {
        span.end();
      }
    },
  );
}
