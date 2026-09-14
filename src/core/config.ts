/**
 * Env-only, zod-validated config for the tool-filtering and transport knobs.
 *
 * Kubeconfig SOURCE selection (KUBECONFIG_YAML / _JSON / K8S_SERVER+TOKEN /
 * in-cluster / KUBECONFIG_PATH / KUBECONFIG / ~/.kube/config, plus
 * K8S_CONTEXT / K8S_NAMESPACE) stays inside KubernetesManager — that
 * priority chain picks a SOURCE, it doesn't validate a shape, so it isn't
 * folded into this schema. This file covers the knobs that decide what the
 * server DOES: which tools are registered, whether secrets are masked, HTTP
 * transport settings.
 */
import { z } from "zod";

function boolEnv(raw: string | undefined, fallback: boolean): boolean {
  if (raw === undefined || raw === "") return fallback;
  return raw.toLowerCase() === "true";
}

export const ConfigSchema = z.object({
  /** SAFE: only read/list/describe/explain tools are registered. */
  allowOnlyReadonlyTools: z.boolean(),
  /** SAFE: destructive tools (delete, uninstall, cleanup, generic, node drain) are not registered. */
  allowOnlyNonDestructiveTools: z.boolean(),
  /** Exact allowlist of tool names, or null for "no restriction". Unknown names fail startup (see loadConfig). */
  allowedToolNames: z.array(z.string()).nullable(),
  maskSecrets: z.boolean(),
  spawnMaxBufferBytes: z.number().int().positive(),
  httpAuthToken: z.string().optional(),
  dnsRebindingProtection: z.boolean(),
  dnsRebindingAllowedHost: z.string().optional(),
  host: z.string().min(1),
  port: z.number().int().positive(),
});

export type Config = z.infer<typeof ConfigSchema>;

const DEFAULT_MAX_BUFFER = 10 * 1024 * 1024;

export interface ValidateConfigResult {
  success: boolean;
  data?: Config;
  message?: string;
}

/** Pure — no process.exit, no I/O. Exists so it can be unit-tested directly. */
export function validateConfig(env: NodeJS.ProcessEnv | Record<string, string | undefined>): ValidateConfigResult {
  const allowedToolsRaw = env.ALLOWED_TOOLS;
  const parsedPort = Number.parseInt(env.PORT ?? "3000", 10);
  const parsedMaxBuffer = env.SPAWN_MAX_BUFFER ? Number.parseInt(env.SPAWN_MAX_BUFFER, 10) : DEFAULT_MAX_BUFFER;

  const result = ConfigSchema.safeParse({
    allowOnlyReadonlyTools: boolEnv(env.ALLOW_ONLY_READONLY_TOOLS, false),
    allowOnlyNonDestructiveTools: boolEnv(env.ALLOW_ONLY_NON_DESTRUCTIVE_TOOLS, false),
    allowedToolNames: allowedToolsRaw
      ? allowedToolsRaw
          .split(",")
          .map((t) => t.trim())
          .filter(Boolean)
      : null,
    maskSecrets: boolEnv(env.MASK_SECRETS, true),
    spawnMaxBufferBytes: Number.isFinite(parsedMaxBuffer) && parsedMaxBuffer > 0 ? parsedMaxBuffer : DEFAULT_MAX_BUFFER,
    httpAuthToken: env.MCP_AUTH_TOKEN || undefined,
    dnsRebindingProtection: boolEnv(env.DNS_REBINDING_PROTECTION, true),
    dnsRebindingAllowedHost: env.DNS_REBINDING_ALLOWED_HOST || undefined,
    host: env.HOST || "localhost",
    port: Number.isFinite(parsedPort) ? parsedPort : 3000,
  });

  if (!result.success) {
    const fields = [...new Set(result.error.issues.map((issue) => issue.path.join(".")))].join(", ");
    return { success: false, message: `kubernetes-mcp: invalid configuration for: ${fields}` };
  }

  return { success: true, data: result.data };
}

/** Validates and, on failure, writes to stderr and exits non-zero — the server must never start misconfigured. */
export function loadConfig(env: NodeJS.ProcessEnv): Config {
  const result = validateConfig(env);
  if (!result.success || !result.data) {
    process.stderr.write(`${result.message}\n`);
    process.exit(1);
  }
  return result.data;
}
