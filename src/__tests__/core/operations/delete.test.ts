import { promises as fsp } from "node:fs";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { deleteResource } from "../../../core/operations/delete.js";
import type { Deps } from "../../../core/types.js";

function fakeDeps(): Deps {
  return {
    kubectl: vi.fn(async () => "pod/web deleted\n"),
    helm: vi.fn(async () => ""),
    client: {} as Deps["client"],
    config: {} as Deps["config"],
  };
}

describe("deleteResource", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env.ENABLE_UNSAFE_SSE_TRANSPORT = "";
    process.env.ENABLE_UNSAFE_STREAMABLE_HTTP_TRANSPORT = "";
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.restoreAllMocks();
  });

  test("builds argv for resourceType + name, defaulting the namespace", async () => {
    const deps = fakeDeps();
    const result = await deleteResource(deps, { resourceType: "pod", name: "web" });

    expect(deps.kubectl).toHaveBeenCalledWith(
      ["delete", "pod", "web", "-n", "default"],
      "kubectl_delete",
    );
    expect(result.raw).toBe("pod/web deleted\n");
  });

  test("builds argv for resourceType + labelSelector, force and gracePeriod", async () => {
    const deps = fakeDeps();
    await deleteResource(deps, {
      resourceType: "pods",
      labelSelector: "app=nginx",
      namespace: "team-a",
      force: true,
      gracePeriodSeconds: 0,
      context: "prod",
    });

    expect(deps.kubectl).toHaveBeenCalledWith(
      [
        "delete",
        "pods",
        "-l",
        "app=nginx",
        "-n",
        "team-a",
        "--force",
        "--grace-period=0",
        "--context",
        "prod",
      ],
      "kubectl_delete",
    );
  });

  test("omits the namespace flag for a non-namespaced resource type", async () => {
    const deps = fakeDeps();
    await deleteResource(deps, { resourceType: "nodes", name: "node-1" });

    expect(deps.kubectl).toHaveBeenCalledWith(["delete", "nodes", "node-1"], "kubectl_delete");
  });

  test("uses --all-namespaces instead of -n when allNamespaces is set", async () => {
    const deps = fakeDeps();
    await deleteResource(deps, {
      resourceType: "pods",
      labelSelector: "app=nginx",
      allNamespaces: true,
    });

    expect(deps.kubectl).toHaveBeenCalledWith(
      ["delete", "pods", "-l", "app=nginx", "--all-namespaces"],
      "kubectl_delete",
    );
  });

  test("writes an inline manifest to a temp file, deletes with -f, and cleans it up", async () => {
    const deps = fakeDeps();
    const writeSpy = vi.spyOn(fsp, "writeFile").mockResolvedValue(undefined);
    const unlinkSpy = vi.spyOn(fsp, "unlink").mockResolvedValue(undefined);

    await deleteResource(deps, { manifest: "kind: Pod" });

    expect(writeSpy).toHaveBeenCalledWith(
      expect.stringMatching(/delete-manifest-\d+\.yaml$/),
      "kind: Pod",
    );
    const [argv] = (deps.kubectl as any).mock.calls[0];
    expect(argv[0]).toBe("delete");
    expect(argv).toContain("-f");
    expect(unlinkSpy).toHaveBeenCalled();
  });

  test("uses filename directly (no temp file)", async () => {
    const deps = fakeDeps();
    const writeSpy = vi.spyOn(fsp, "writeFile").mockResolvedValue(undefined);

    await deleteResource(deps, { filename: "/tmp/manifest.yaml" });

    expect(writeSpy).not.toHaveBeenCalled();
    expect(deps.kubectl).toHaveBeenCalledWith(
      ["delete", "-f", "/tmp/manifest.yaml"],
      "kubectl_delete",
    );
  });

  test("rejects when neither resourceType, manifest, nor filename is provided", async () => {
    const deps = fakeDeps();
    await expect(deleteResource(deps, {})).rejects.toMatchObject({ code: "invalid_input" });
    expect(deps.kubectl).not.toHaveBeenCalled();
  });

  test("rejects resourceType without name or labelSelector", async () => {
    const deps = fakeDeps();
    await expect(deleteResource(deps, { resourceType: "pod" })).rejects.toMatchObject({
      code: "invalid_input",
    });
    expect(deps.kubectl).not.toHaveBeenCalled();
  });

  test("rejects filename over a remote transport", async () => {
    process.env.ENABLE_UNSAFE_SSE_TRANSPORT = "true";
    const deps = fakeDeps();

    await expect(deleteResource(deps, { filename: "/etc/kube/config" })).rejects.toMatchObject({
      code: "invalid_input",
    });
    expect(deps.kubectl).not.toHaveBeenCalled();
  });

  test("rejects a flag-like resourceType before calling kubectl", async () => {
    const deps = fakeDeps();
    await expect(deleteResource(deps, { resourceType: "--evil", name: "web" })).rejects.toThrow();
    expect(deps.kubectl).not.toHaveBeenCalled();
  });

  test("rejects a flag-like name before calling kubectl", async () => {
    const deps = fakeDeps();
    await expect(deleteResource(deps, { resourceType: "pod", name: "--evil" })).rejects.toThrow();
    expect(deps.kubectl).not.toHaveBeenCalled();
  });
});
