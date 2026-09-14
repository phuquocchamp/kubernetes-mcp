import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { patch } from "../../../core/operations/patch.js";
import type { Deps } from "../../../core/types.js";

vi.mock("../../../security/transport.js", () => ({
  isRemoteTransport: vi.fn(() => false),
}));

import { isRemoteTransport } from "../../../security/transport.js";

function fakeDeps(kubectlImpl?: (...args: unknown[]) => unknown): Deps {
  return {
    kubectl: vi.fn(kubectlImpl ?? (async () => "ok")) as unknown as Deps["kubectl"],
    helm: vi.fn(async () => "") as unknown as Deps["helm"],
    client: {} as Deps["client"],
    config: {} as Deps["config"],
  };
}

describe("patch", () => {
  beforeEach(() => {
    vi.mocked(isRemoteTransport).mockReturnValue(false);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  test("builds argv for patchData, writing a temp --patch-file and defaulting type/namespace", async () => {
    const deps = fakeDeps();
    await patch(deps, {
      resourceType: "deployment",
      name: "web",
      patchData: { spec: { replicas: 2 } },
    });

    expect(deps.kubectl).toHaveBeenCalledTimes(1);
    const [argv, operation] = vi.mocked(deps.kubectl).mock.calls[0];
    expect(operation).toBe("kubectl_patch");
    expect(argv.slice(0, 6)).toEqual(["patch", "deployment", "web", "-n", "default", "--type"]);
    expect(argv[6]).toBe("strategic");
    expect(argv[7]).toBe("--patch-file");
    expect(typeof argv[8]).toBe("string");
  });

  test("builds argv for patchFile, patchType, dryRun and context", async () => {
    const deps = fakeDeps();
    await patch(deps, {
      resourceType: "deployment",
      name: "web",
      namespace: "prod",
      patchType: "merge",
      patchFile: "/tmp/my-patch.json",
      dryRun: true,
      context: "ctx-a",
    });
    expect(deps.kubectl).toHaveBeenCalledWith(
      [
        "patch",
        "deployment",
        "web",
        "-n",
        "prod",
        "--type",
        "merge",
        "--patch-file",
        "/tmp/my-patch.json",
        "--dry-run=client",
        "--context",
        "ctx-a",
      ],
      "kubectl_patch",
    );
  });

  test("rejects when neither patchData nor patchFile is provided", async () => {
    const deps = fakeDeps();
    await expect(patch(deps, { resourceType: "deployment", name: "web" })).rejects.toThrow(
      /patchData or patchFile/,
    );
    expect(deps.kubectl).not.toHaveBeenCalled();
  });

  test("rejects a non-object patchData", async () => {
    const deps = fakeDeps();
    await expect(
      patch(deps, {
        resourceType: "deployment",
        name: "web",
        patchData: "oops" as unknown as object,
      }),
    ).rejects.toThrow(/must be a valid JSON object/);
    expect(deps.kubectl).not.toHaveBeenCalled();
  });

  test("rejects patchFile over a remote transport", async () => {
    vi.mocked(isRemoteTransport).mockReturnValue(true);
    const deps = fakeDeps();
    await expect(
      patch(deps, { resourceType: "deployment", name: "web", patchFile: "/etc/passwd" }),
    ).rejects.toThrow(/disabled on remote/);
    expect(deps.kubectl).not.toHaveBeenCalled();
  });
});
