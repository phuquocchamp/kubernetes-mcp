import { McpError } from "@modelcontextprotocol/sdk/types.js";
import { describe, expect, test, vi } from "vitest";
import { get } from "../../../core/operations/get.js";
import type { Deps } from "../../../core/types.js";

function fakeDeps(kubectlResult = "{}"): { deps: Deps; kubectl: ReturnType<typeof vi.fn> } {
  const kubectl = vi.fn().mockResolvedValue(kubectlResult);
  const helm = vi.fn();
  const deps = {
    kubectl,
    helm,
    client: {} as Deps["client"],
    config: {} as Deps["config"],
  } as Deps;
  return { deps, kubectl };
}

describe("get operation", () => {
  test("builds argv for a plain namespaced list", async () => {
    const { deps, kubectl } = fakeDeps(JSON.stringify({ kind: "PodList", items: [] }));

    await get(deps, { resourceType: "pods" });

    expect(kubectl).toHaveBeenCalledWith(
      ["get", "pods", "-n", "default", "-o", "json"],
      "kubectl_get",
    );
  });

  test("builds argv for a named resource with namespace, output and context", async () => {
    const { deps, kubectl } = fakeDeps(JSON.stringify({ kind: "Pod" }));

    await get(deps, {
      resourceType: "Pods",
      name: "my-pod",
      namespace: "kube-system",
      output: "yaml",
      context: "prod",
    });

    expect(kubectl).toHaveBeenCalledWith(
      ["get", "pods", "my-pod", "-n", "kube-system", "--context", "prod", "-o", "yaml"],
      "kubectl_get",
    );
  });

  test("uses --all-namespaces instead of -n when allNamespaces is set", async () => {
    const { deps, kubectl } = fakeDeps(JSON.stringify({ kind: "PodList", items: [] }));

    await get(deps, { resourceType: "pods", allNamespaces: true });

    expect(kubectl).toHaveBeenCalledWith(
      ["get", "pods", "--all-namespaces", "-o", "json"],
      "kubectl_get",
    );
  });

  test("skips -n for a non-namespaced resource type", async () => {
    const { deps, kubectl } = fakeDeps(JSON.stringify({ kind: "NodeList", items: [] }));

    await get(deps, { resourceType: "nodes" });

    expect(kubectl).toHaveBeenCalledWith(["get", "nodes", "-o", "json"], "kubectl_get");
  });

  test("events default to --all-namespaces and default sort-by unless namespace given", async () => {
    const { deps, kubectl } = fakeDeps(JSON.stringify({ kind: "EventList", items: [] }));

    await get(deps, { resourceType: "events" });

    expect(kubectl).toHaveBeenCalledWith(
      ["get", "events", "--all-namespaces", "--sort-by=.lastTimestamp", "-o", "json"],
      "kubectl_get",
    );
  });

  test("events respect an explicit namespace and custom sortBy", async () => {
    const { deps, kubectl } = fakeDeps(JSON.stringify({ kind: "EventList", items: [] }));

    await get(deps, { resourceType: "events", namespace: "default", sortBy: "count" });

    expect(kubectl).toHaveBeenCalledWith(
      ["get", "events", "-n", "default", "--sort-by=.count", "-o", "json"],
      "kubectl_get",
    );
  });

  test("adds label and field selectors", async () => {
    const { deps, kubectl } = fakeDeps(JSON.stringify({ kind: "PodList", items: [] }));

    await get(deps, {
      resourceType: "pods",
      labelSelector: "app=nginx",
      fieldSelector: "metadata.name=my-pod",
    });

    expect(kubectl).toHaveBeenCalledWith(
      [
        "get",
        "pods",
        "-n",
        "default",
        "-l",
        "app=nginx",
        "--field-selector=metadata.name=my-pod",
        "-o",
        "json",
      ],
      "kubectl_get",
    );
  });

  test("rejects a flag-like resourceType", async () => {
    const { deps, kubectl } = fakeDeps();

    await expect(get(deps, { resourceType: "--server=https://evil.example.com" })).rejects.toThrow(
      McpError,
    );
    expect(kubectl).not.toHaveBeenCalled();
  });

  test("rejects a flag-like name", async () => {
    const { deps, kubectl } = fakeDeps();

    await expect(
      get(deps, { resourceType: "pods", name: "--kubeconfig=/tmp/evil" }),
    ).rejects.toThrow(McpError);
    expect(kubectl).not.toHaveBeenCalled();
  });
});
