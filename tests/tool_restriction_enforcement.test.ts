import { expect, test, describe, afterEach } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { z } from "zod";

/**
 * Verifies that tool-restriction environment variables
 * (ALLOW_ONLY_READONLY_TOOLS, ALLOW_ONLY_NON_DESTRUCTIVE_TOOLS, ALLOWED_TOOLS)
 * are enforced at the tools/call layer in addition to tools/list.
 *
 * Since the refactor onto server.ts's `gatedServer`, a restricted tool is
 * never registered at all rather than registered-and-refused (SAFE-03-style
 * gating): the SDK's own tools/call routing rejects an unknown tool name
 * with "Tool <name> not found" (verified against the built server), not the
 * old dispatcher's bespoke "not allowed under the current server
 * configuration" message. A client that knows a tool name must still not be
 * able to invoke a restricted tool directly by sending a tools/call request
 * — it just fails for "doesn't exist" instead of "exists but refused".
 */
describe("tool restriction enforcement (tools/call layer)", () => {
  let transport: StdioClientTransport | undefined;
  let client: Client | undefined;

  async function connectWithEnv(env: Record<string, string>): Promise<Client> {
    transport = new StdioClientTransport({
      command: "bun",
      args: ["src/index.ts"],
      env: {
        ...process.env,
        ...env,
      } as Record<string, string>,
      stderr: "pipe",
    });
    client = new Client(
      { name: "restriction-test-client", version: "1.0.0" },
      { capabilities: {} }
    );
    await client.connect(transport);
    return client;
  }

  afterEach(async () => {
    try {
      await client?.close();
    } catch {}
    try {
      await transport?.close();
    } catch {}
    client = undefined;
    transport = undefined;
  });

  test("ALLOW_ONLY_READONLY_TOOLS rejects a destructive tool at call-time", async () => {
    const c = await connectWithEnv({ ALLOW_ONLY_READONLY_TOOLS: "true" });

    const list = (await c.request(
      { method: "tools/list", params: {} },
      // @ts-ignore - minimal schema; we only inspect names
      z.any()
    )) as { tools: Array<{ name: string }> };
    const names = list.tools.map((t) => t.name);
    expect(names).not.toContain("kubectl_delete");

    const result = (await c.request(
      {
        method: "tools/call",
        params: {
          name: "kubectl_delete",
          arguments: { resourceType: "pod", name: "anything" },
        },
      },
      // @ts-ignore - minimal schema
      z.any()
    )) as { content: Array<{ text: string }>; isError?: boolean };
    // A restricted tool is never registered, so the SDK's own routing
    // returns an isError result for an unknown tool name (it does not
    // reject the client.request() promise) — see the file docstring.
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toMatch(/not found/i);
  }, 30000);

  test("ALLOW_ONLY_NON_DESTRUCTIVE_TOOLS rejects a destructive tool at call-time", async () => {
    const c = await connectWithEnv({
      ALLOW_ONLY_NON_DESTRUCTIVE_TOOLS: "true",
    });

    const result = (await c.request(
      {
        method: "tools/call",
        params: {
          name: "kubectl_delete",
          arguments: { resourceType: "pod", name: "anything" },
        },
      },
      // @ts-ignore - minimal schema
      z.any()
    )) as { content: Array<{ text: string }>; isError?: boolean };
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toMatch(/not found/i);
  }, 30000);

  test("ALLOWED_TOOLS allowlist rejects unlisted tools at call-time", async () => {
    const c = await connectWithEnv({ ALLOWED_TOOLS: "kubectl_get,ping" });

    const result = (await c.request(
      {
        method: "tools/call",
        params: {
          name: "kubectl_delete",
          arguments: { resourceType: "pod", name: "anything" },
        },
      },
      // @ts-ignore - minimal schema
      z.any()
    )) as { content: Array<{ text: string }>; isError?: boolean };
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toMatch(/not found/i);
  }, 30000);

  test("ALLOWED_TOOLS lists exactly the named tools", async () => {
    const c = await connectWithEnv({ ALLOWED_TOOLS: "kubectl_get,ping" });

    const list = (await c.request(
      { method: "tools/list", params: {} },
      // @ts-ignore - minimal schema; we only inspect names
      z.any()
    )) as { tools: Array<{ name: string }> };

    expect(list.tools.map((t) => t.name).sort()).toEqual([
      "kubectl_get",
      "ping",
    ]);
  }, 30000);

  test("ALLOWED_TOOLS with an unknown name stops the server from starting", async () => {
    await expect(
      connectWithEnv({ ALLOWED_TOOLS: "kubectl_get,kubectl_gett" })
    ).rejects.toThrow();
  }, 30000);
});
