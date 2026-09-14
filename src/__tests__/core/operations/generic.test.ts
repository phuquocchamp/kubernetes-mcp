import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { generic } from "../../../core/operations/generic.js";
import type { Deps } from "../../../core/types.js";

function fakeDeps(): Deps {
  return {
    kubectl: vi.fn(async () => "ok\n"),
    helm: vi.fn(async () => ""),
    client: {} as Deps["client"],
    config: {} as Deps["config"],
  };
}

describe("generic", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env.ENABLE_UNSAFE_SSE_TRANSPORT = "";
    process.env.ENABLE_UNSAFE_STREAMABLE_HTTP_TRANSPORT = "";
    process.env.ALLOW_KUBECTL_UNSAFE_FLAGS = "";
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.restoreAllMocks();
  });

  test("builds argv for command + resourceType + name + namespace", async () => {
    const deps = fakeDeps();
    const result = await generic(deps, {
      command: "rollout",
      subCommand: "status",
      resourceType: "deployment",
      name: "web",
      namespace: "team-a",
    });

    expect(deps.kubectl).toHaveBeenCalledWith(
      ["rollout", "status", "deployment", "web", "--namespace=team-a"],
      "kubectl_generic",
    );
    expect(result.raw).toBe("ok\n");
  });

  test("uses --all-namespaces instead of --namespace when allNamespaces is set", async () => {
    const deps = fakeDeps();
    await generic(deps, { command: "get", resourceType: "pods", allNamespaces: true, namespace: "ignored" });

    expect(deps.kubectl).toHaveBeenCalledWith(["get", "pods", "--all-namespaces"], "kubectl_generic");
  });

  test("appends outputFormat, flags, args and context in order", async () => {
    const deps = fakeDeps();
    await generic(deps, {
      command: "get",
      resourceType: "pods",
      outputFormat: "json",
      flags: { watch: true, timeout: "30s", skip: false, ignoreMe: undefined },
      args: ["--", "extra"],
      context: "prod",
    });

    expect(deps.kubectl).toHaveBeenCalledWith(
      ["get", "pods", "-o=json", "--watch", "--timeout=30s", "--", "extra", "--context", "prod"],
      "kubectl_generic",
    );
  });

  test("rejects a dangerous flag in `flags` before calling kubectl", async () => {
    const deps = fakeDeps();
    await expect(generic(deps, { command: "get", flags: { server: "https://evil" } })).rejects.toThrow();
    expect(deps.kubectl).not.toHaveBeenCalled();
  });

  test("rejects a dangerous flag in `args` before calling kubectl", async () => {
    const deps = fakeDeps();
    await expect(generic(deps, { command: "get", args: ["--kubeconfig=/tmp/evil"] })).rejects.toThrow();
    expect(deps.kubectl).not.toHaveBeenCalled();
  });

  test("rejects a flag-like command before calling kubectl", async () => {
    const deps = fakeDeps();
    await expect(generic(deps, { command: "--evil" })).rejects.toThrow();
    expect(deps.kubectl).not.toHaveBeenCalled();
  });

  test("rejects a flag-like resourceType before calling kubectl", async () => {
    const deps = fakeDeps();
    await expect(generic(deps, { command: "get", resourceType: "--evil" })).rejects.toThrow();
    expect(deps.kubectl).not.toHaveBeenCalled();
  });

  test("rejects a server-side file-read flag in args over a remote transport", async () => {
    process.env.ENABLE_UNSAFE_SSE_TRANSPORT = "true";
    const deps = fakeDeps();

    await expect(generic(deps, { command: "apply", args: ["-f", "/etc/passwd"] })).rejects.toThrow();
    expect(deps.kubectl).not.toHaveBeenCalled();
  });
});
