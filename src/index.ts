#!/usr/bin/env node

// Initialize OpenTelemetry before any other imports, so auto-instrumented
// libraries are patched before they're required anywhere else.
import { getTelemetryConfigSummary, initializeTelemetry } from "./config/telemetry-config.js";

const telemetrySdk = initializeTelemetry();

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { serverConfig } from "./config/server-config.js";
import { loadConfig } from "./core/config.js";
import { ALL_TOOL_NAMES, createServer, findUnknownToolNames } from "./server.js";
import { startSSEServer } from "./utils/sse.js";
import { startStreamableHTTPServer } from "./utils/streamable-http.js";

const config = loadConfig(process.env);

// A misspelled name in ALLOWED_TOOLS would otherwise be dropped silently,
// leaving a narrower tool surface than was configured. Refuse to start instead.
const unknownToolNames = findUnknownToolNames(config);
if (unknownToolNames.length > 0) {
  console.error(
    `ALLOWED_TOOLS contains unknown tool ${unknownToolNames.length === 1 ? "name" : "names"}: ${unknownToolNames.join(", ")}`,
  );
  console.error(`Available tools: ${[...ALL_TOOL_NAMES].sort().join(", ")}`);
  process.exit(1);
}

const { server, toolNames } = createServer(config);

if (process.env.ENABLE_UNSAFE_SSE_TRANSPORT) {
  startSSEServer(server.server);
  console.error("SSE server started");
} else if (process.env.ENABLE_UNSAFE_STREAMABLE_HTTP_TRANSPORT) {
  startStreamableHTTPServer(server.server);
  console.error("Streamable HTTP server started");
} else {
  const transport = new StdioServerTransport();
  console.error(`Starting Kubernetes MCP server v${serverConfig.version}, handling commands...`);
  console.error(`Registered ${toolNames.length} tools.`);
  console.error(getTelemetryConfigSummary());
  server.connect(transport);
}

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, async () => {
    console.error(`Received ${signal}, shutting down...`);
    await server.close();
    if (telemetrySdk) await telemetrySdk.shutdown();
    process.exit(0);
  });
}
