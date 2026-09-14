import { describe, expect, test, vi } from "vitest";
import { scale } from "../../../core/operations/scale.js";
import type { Deps } from "../../../core/types.js";

function fakeDeps(kubectlImpl?: (...args: unknown[]) => unknown): Deps {
  return {
    kubectl: vi.fn(kubectlImpl ?? (async () => "ok")) as unknown as Deps["kubectl"],
    helm: vi.fn(async () => "") as unknown as Deps["helm"],
    client: {} as Deps["client"],
    config: {} as Deps["config"],
  };
}

describe("scale", () => {
  test("builds argv with defaults (resourceType, namespace)", async () => {
    const deps = fakeDeps();
    await scale(deps, { name: "web", replicas: 3 });
    expect(deps.kubectl).toHaveBeenCalledWith(
      ["scale", "deployment", "web", "--replicas=3", "--namespace=default"],
      "kubectl_scale",
    );
  });

  test("builds argv with resourceType, namespace and context overrides", async () => {
    const deps = fakeDeps();
    await scale(deps, {
      name: "web",
      replicas: 5,
      resourceType: "statefulset",
      namespace: "prod",
      context: "prod-ctx",
    });
    expect(deps.kubectl).toHaveBeenCalledWith(
      ["scale", "statefulset", "web", "--replicas=5", "--namespace=prod", "--context", "prod-ctx"],
      "kubectl_scale",
    );
  });

  test("returns a typed result derived from the args and raw output", async () => {
    const deps = fakeDeps(async () => "statefulset.apps/web scaled\n");
    const result = await scale(deps, { name: "web", replicas: 2, resourceType: "statefulset" });
    expect(result).toEqual({
      kind: "statefulset",
      name: "web",
      namespace: "default",
      replicas: 2,
      raw: "statefulset.apps/web scaled\n",
    });
  });

  test("rejects a flag-like name before calling kubectl", async () => {
    const deps = fakeDeps();
    await expect(scale(deps, { name: "--evil", replicas: 1 })).rejects.toThrow();
    expect(deps.kubectl).not.toHaveBeenCalled();
  });

  test("rejects a flag-like resourceType before calling kubectl", async () => {
    const deps = fakeDeps();
    await expect(scale(deps, { name: "web", replicas: 1, resourceType: "--evil" })).rejects.toThrow();
    expect(deps.kubectl).not.toHaveBeenCalled();
  });
});
