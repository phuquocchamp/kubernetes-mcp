/**
 * MCP tool-result adapter. Every registered handler in a tools/*.ts
 * registrar is one line:
 *
 *   (args) => runTool("kubectl_scale", () => formatScale(await scale(deps, args)))
 *
 * Core operations return data or throw KubectlError; this is the only place
 * that turns that into the MCP content-block shape.
 */
import { KubectlError } from "../core/errors.js";

export type ToolResult = {
  content: Array<{ type: "text"; text: string }>;
  isError?: true;
};

export function textResult(text: string): ToolResult {
  return { content: [{ type: "text", text }] };
}

export function errorResult(text: string): ToolResult {
  return { content: [{ type: "text", text }], isError: true };
}

function formatErrorLine(err: unknown): string {
  if (err instanceof KubectlError) {
    return `error: ${err.code} - ${err.message}${err.tryHint ? ` - try: ${err.tryHint}` : ""}`;
  }
  return `error: internal - ${err instanceof Error ? err.message : String(err)}`;
}

export async function runTool(toolName: string, body: () => Promise<string>): Promise<ToolResult> {
  try {
    return textResult(await body());
  } catch (err) {
    console.error(`[kubernetes-mcp] ${toolName} error:`, err instanceof Error ? err.message : err);
    return errorResult(formatErrorLine(err));
  }
}
