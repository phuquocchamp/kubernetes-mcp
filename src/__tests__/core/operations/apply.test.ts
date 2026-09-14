import { promises as fsp } from "node:fs";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { apply } from "../../../core/operations/apply.js";
import type { Deps } from "../../../core/types.js";

function fakeDeps(): Deps {
  return {
    kubectl: vi.fn(async () => "applied\n"),
    helm: vi.fn(async () => ""),
    client: {} as Deps["client"],
    config: {} as Deps["config"],
  };
}

describe("apply", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env.ENABLE_UNSAFE_SSE_TRANSPORT = "";
    process.env.ENABLE_UNSAFE_STREAMABLE_HTTP_TRANSPORT = "";
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.restoreAllMocks();
  });

  test("builds argv for an inline manifest, writing and cleaning up a temp file", async () => {
    const deps = fakeDeps();
    const writeSpy = vi.spyOn(fsp, "writeFile").mockResolvedValue(undefined);
    const unlinkSpy = vi.spyOn(fsp, "unlink").mockResolvedValue(undefined);

    const result = await apply(deps, { manifest: "kind: Pod", namespace: "team-a" });

    expect(deps.kubectl).toHaveBeenCalledTimes(1);
    const [argv, operation] = (deps.kubectl as any).mock.calls[0];
    expect(operation).toBe("kubectl_apply");
    expect(argv[0]).toBe("apply");
    expect(argv).toContain("-f");
    expect(argv).toEqual(expect.arrayContaining(["-n", "team-a"]));
    expect(writeSpy).toHaveBeenCalledWith(
      expect.stringMatching(/manifest-\d+\.yaml$/),
      "kind: Pod",
    );
    expect(unlinkSpy).toHaveBeenCalled();
    expect(result.raw).toBe("applied\n");
  });

  test("uses filename directly (no temp file) and appends dryRun/force/context flags", async () => {
    const deps = fakeDeps();
    const writeSpy = vi.spyOn(fsp, "writeFile").mockResolvedValue(undefined);

    await apply(deps, {
      filename: "/tmp/manifest.yaml",
      dryRun: true,
      force: true,
      context: "prod",
    });

    expect(writeSpy).not.toHaveBeenCalled();
    const [argv] = (deps.kubectl as any).mock.calls[0];
    expect(argv).toEqual([
      "apply",
      "-f",
      "/tmp/manifest.yaml",
      "-n",
      "default",
      "--dry-run=client",
      "--force",
      "--context",
      "prod",
    ]);
  });

  test("rejects when neither manifest nor filename is provided", async () => {
    const deps = fakeDeps();
    await expect(apply(deps, {})).rejects.toMatchObject({ code: "invalid_input" });
    expect(deps.kubectl).not.toHaveBeenCalled();
  });

  test("rejects filename over a remote transport", async () => {
    process.env.ENABLE_UNSAFE_SSE_TRANSPORT = "true";
    const deps = fakeDeps();

    await expect(apply(deps, { filename: "/etc/kube/config" })).rejects.toMatchObject({
      code: "invalid_input",
    });
    expect(deps.kubectl).not.toHaveBeenCalled();
  });
});
