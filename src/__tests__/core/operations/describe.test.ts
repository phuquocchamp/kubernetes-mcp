import { describe as describeSuite, expect, test, vi } from "vitest";
import { describe } from "../../../core/operations/describe.js";
import type { Deps } from "../../../core/types.js";

function fakeDeps(kubectlImpl?: (...args: unknown[]) => unknown): Deps {
  return {
    kubectl: vi.fn(
      kubectlImpl ?? (async () => "Name: web\nNamespace: default\n"),
    ) as unknown as Deps["kubectl"],
    helm: vi.fn(async () => "") as unknown as Deps["helm"],
    client: {} as Deps["client"],
    config: {} as Deps["config"],
  };
}

describeSuite("describe", () => {
  test("builds argv with default namespace", async () => {
    const deps = fakeDeps();
    await describe(deps, { resourceType: "pods", name: "web" });
    expect(deps.kubectl).toHaveBeenCalledWith(
      ["describe", "pods", "web", "-n", "default"],
      "kubectl_describe",
    );
  });

  test("uses --all-namespaces instead of -n when allNamespaces is set", async () => {
    const deps = fakeDeps();
    await describe(deps, {
      resourceType: "pods",
      name: "web",
      allNamespaces: true,
      namespace: "prod",
    });
    expect(deps.kubectl).toHaveBeenCalledWith(
      ["describe", "pods", "web", "--all-namespaces"],
      "kubectl_describe",
    );
  });

  test("omits -n for a non-namespaced resource type", async () => {
    const deps = fakeDeps();
    await describe(deps, { resourceType: "nodes", name: "node-1" });
    expect(deps.kubectl).toHaveBeenCalledWith(["describe", "nodes", "node-1"], "kubectl_describe");
  });

  test("passes namespace and context overrides", async () => {
    const deps = fakeDeps();
    await describe(deps, {
      resourceType: "pods",
      name: "web",
      namespace: "kube-system",
      context: "prod-ctx",
    });
    expect(deps.kubectl).toHaveBeenCalledWith(
      ["describe", "pods", "web", "-n", "kube-system", "--context", "prod-ctx"],
      "kubectl_describe",
    );
  });

  test("returns the raw kubectl output", async () => {
    const deps = fakeDeps(async () => "Name: web\nStatus: Running\n");
    const result = await describe(deps, { resourceType: "pods", name: "web" });
    expect(result).toEqual({ raw: "Name: web\nStatus: Running\n" });
  });

  test("rejects a flag-like resourceType before calling kubectl", async () => {
    const deps = fakeDeps();
    await expect(describe(deps, { resourceType: "--evil", name: "web" })).rejects.toThrow();
    expect(deps.kubectl).not.toHaveBeenCalled();
  });

  test("rejects a flag-like name before calling kubectl", async () => {
    const deps = fakeDeps();
    await expect(describe(deps, { resourceType: "pods", name: "--evil" })).rejects.toThrow();
    expect(deps.kubectl).not.toHaveBeenCalled();
  });
});
