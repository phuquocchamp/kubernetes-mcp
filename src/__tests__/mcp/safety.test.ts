/**
 * Structural safety-boundary tests.
 *
 * These assert the tool-filtering contract directly against the registrars
 * server.ts actually calls, driven with a throwaway McpServer and stub deps
 * — no cluster, no kubectl/helm binary, no real process. If a tool is added
 * to a registrar without updating the classification in server.ts, or a
 * registrar is added without being wired into the REGISTRARS list, these
 * fail.
 */
import { describe, expect, it } from "vitest";
import type { Config } from "../../core/config.js";
import { ALL_TOOL_NAMES, findUnknownToolNames, toolNames } from "../../server.js";

function baseConfig(overrides: Partial<Config> = {}): Config {
  return {
    allowOnlyReadonlyTools: false,
    allowOnlyNonDestructiveTools: false,
    allowedToolNames: null,
    maskSecrets: true,
    spawnMaxBufferBytes: 10 * 1024 * 1024,
    dnsRebindingProtection: true,
    host: "localhost",
    port: 3000,
    ...overrides,
  };
}

const DESTRUCTIVE = [
  "kubectl_delete",
  "uninstall_helm_chart",
  "cleanup",
  "kubectl_generic",
  "node_management",
];

describe("tool registration modes", () => {
  it("registers all 23 tools with no restriction", () => {
    const names = toolNames(baseConfig());
    expect(names).toHaveLength(23);
    expect(new Set(names)).toEqual(new Set(ALL_TOOL_NAMES));
  });

  it("registers exactly 8 read-only tools under ALLOW_ONLY_READONLY_TOOLS", () => {
    const names = toolNames(baseConfig({ allowOnlyReadonlyTools: true }));
    expect(names).toHaveLength(8);
    for (const destructive of DESTRUCTIVE) expect(names).not.toContain(destructive);
    expect(names).not.toContain("kubectl_apply");
    expect(names).not.toContain("kubectl_create");
  });

  it("registers exactly 18 tools under ALLOW_ONLY_NON_DESTRUCTIVE_TOOLS — no destructive tool reachable", () => {
    const names = toolNames(baseConfig({ allowOnlyNonDestructiveTools: true }));
    expect(names).toHaveLength(18);
    for (const destructive of DESTRUCTIVE) expect(names).not.toContain(destructive);
  });

  it("ALLOWED_TOOLS restricts to exactly the named set, even across groups", () => {
    const names = toolNames(baseConfig({ allowedToolNames: ["kubectl_get", "kubectl_scale"] }));
    expect(names.sort()).toEqual(["kubectl_get", "kubectl_scale"]);
  });

  it("a destructive tool is never reachable under BOTH readonly and non-destructive at once", () => {
    const names = toolNames(
      baseConfig({ allowOnlyReadonlyTools: true, allowOnlyNonDestructiveTools: true }),
    );
    // allowOnlyReadonlyTools is checked first, matching the original dispatcher's precedence.
    expect(names).toHaveLength(8);
  });

  it("flags an unknown name in ALLOWED_TOOLS instead of silently narrowing the surface", () => {
    const unknown = findUnknownToolNames(
      baseConfig({ allowedToolNames: ["kubectl_get", "kubectl_nonexistent"] }),
    );
    expect(unknown).toEqual(["kubectl_nonexistent"]);
  });

  it("ALL_TOOL_NAMES has no duplicates and matches the full registration", () => {
    expect(new Set(ALL_TOOL_NAMES).size).toBe(ALL_TOOL_NAMES.length);
    expect(ALL_TOOL_NAMES).toHaveLength(23);
  });
});
