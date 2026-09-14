/**
 * stderr-only logger. stdout is the JSON-RPC channel in stdio mode — a
 * single stray byte on it corrupts the protocol (S7 in the analysis), so
 * every diagnostic in this codebase must go through here, never
 * console.log. biome's noConsole rule (allow: ["error"]) enforces this
 * mechanically for new code.
 */
type Level = "debug" | "info" | "warn" | "error";

function write(level: Level, message: string, meta?: Record<string, unknown>): void {
  const suffix = meta ? ` ${JSON.stringify(meta)}` : "";
  console.error(`[kubernetes-mcp] ${level}: ${message}${suffix}`);
}

export const logger = {
  debug: (message: string, meta?: Record<string, unknown>) => write("debug", message, meta),
  info: (message: string, meta?: Record<string, unknown>) => write("info", message, meta),
  warn: (message: string, meta?: Record<string, unknown>) => write("warn", message, meta),
  error: (message: string, meta?: Record<string, unknown>) => write("error", message, meta),
};
