import { describe, expect, test, vi } from "vitest";
import { rollout } from "../../../core/operations/rollout.js";
import type { Deps } from "../../../core/types.js";

function fakeDeps(kubectlImpl?: (...args: unknown[]) => unknown): Deps {
  return {
    kubectl: vi.fn(kubectlImpl ?? (async () => "ok")) as unknown as Deps["kubectl"],
    helm: vi.fn(async () => "") as unknown as Deps["helm"],
    client: {} as Deps["client"],
    config: {} as Deps["config"],
  };
}

describe("rollout", () => {
  test("builds argv for a plain status check with default namespace", async () => {
    const deps = fakeDeps();
    await rollout(deps, { subCommand: "status", resourceType: "deployment", name: "web" });
    expect(deps.kubectl).toHaveBeenCalledWith(
      ["rollout", "status", "deployment/web", "-n", "default"],
      "kubectl_rollout",
    );
  });

  test("adds --to-revision for undo", async () => {
    const deps = fakeDeps();
    await rollout(deps, {
      subCommand: "undo",
      resourceType: "deployment",
      name: "web",
      namespace: "prod",
      revision: 4,
    });
    expect(deps.kubectl).toHaveBeenCalledWith(
      ["rollout", "undo", "deployment/web", "-n", "prod", "--to-revision=4"],
      "kubectl_rollout",
    );
  });

  test("adds --revision for history's toRevision", async () => {
    const deps = fakeDeps();
    await rollout(deps, {
      subCommand: "history",
      resourceType: "deployment",
      name: "web",
      toRevision: 2,
    });
    expect(deps.kubectl).toHaveBeenCalledWith(
      ["rollout", "history", "deployment/web", "-n", "default", "--revision=2"],
      "kubectl_rollout",
    );
  });

  test("adds --timeout and --context when provided", async () => {
    const deps = fakeDeps();
    await rollout(deps, {
      subCommand: "status",
      resourceType: "statefulset",
      name: "db",
      timeout: "30s",
      context: "ctx-a",
    });
    expect(deps.kubectl).toHaveBeenCalledWith(
      [
        "rollout",
        "status",
        "statefulset/db",
        "-n",
        "default",
        "--timeout=30s",
        "--context",
        "ctx-a",
      ],
      "kubectl_rollout",
    );
  });

  test("status + watch appends --watch and passes a bounded timeoutMs, marking the result watch-limited", async () => {
    const deps = fakeDeps();
    const result = await rollout(deps, {
      subCommand: "status",
      resourceType: "deployment",
      name: "web",
      watch: true,
    });
    expect(deps.kubectl).toHaveBeenCalledWith(
      ["rollout", "status", "deployment/web", "-n", "default", "--watch"],
      "kubectl_rollout",
      { timeoutMs: 15_000 },
    );
    expect(result.watchLimited).toBe(true);
  });

  test("rejects a flag-like name before calling kubectl", async () => {
    const deps = fakeDeps();
    await expect(
      rollout(deps, { subCommand: "status", resourceType: "deployment", name: "--evil" }),
    ).rejects.toThrow();
    expect(deps.kubectl).not.toHaveBeenCalled();
  });
});
