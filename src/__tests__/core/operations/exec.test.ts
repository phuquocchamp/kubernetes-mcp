import { describe, expect, test, vi } from "vitest";
import { KubectlError } from "../../../core/errors.js";
import { execInPod } from "../../../core/operations/exec.js";
import type { Deps } from "../../../core/types.js";

function fakeDeps(kubectlImpl?: (...args: unknown[]) => unknown): Deps {
  return {
    kubectl: vi.fn(kubectlImpl ?? (async () => "output\n")) as unknown as Deps["kubectl"],
    helm: vi.fn(async () => "") as unknown as Deps["helm"],
    client: {} as Deps["client"],
    config: {} as Deps["config"],
  };
}

describe("execInPod", () => {
  test("builds argv with default namespace and default timeout", async () => {
    const deps = fakeDeps();
    await execInPod(deps, { name: "web", command: ["ls", "-la"] });
    expect(deps.kubectl).toHaveBeenCalledWith(
      ["exec", "web", "-n", "default", "--", "ls", "-la"],
      "exec_in_pod",
      {
        timeoutMs: 60000,
      },
    );
  });

  test("adds container, context and custom timeout", async () => {
    const deps = fakeDeps();
    await execInPod(deps, {
      name: "web",
      namespace: "kube-system",
      container: "app",
      context: "prod-ctx",
      timeout: 5000,
      command: ["cat", "/etc/hostname"],
    });
    expect(deps.kubectl).toHaveBeenCalledWith(
      [
        "exec",
        "web",
        "-n",
        "kube-system",
        "-c",
        "app",
        "--context",
        "prod-ctx",
        "--",
        "cat",
        "/etc/hostname",
      ],
      "exec_in_pod",
      { timeoutMs: 5000 },
    );
  });

  test("returns kubectl's stdout as output", async () => {
    const deps = fakeDeps(async () => "hello\n");
    const result = await execInPod(deps, { name: "web", command: ["echo", "hello"] });
    expect(result).toEqual({ output: "hello\n" });
  });

  test("rejects a flag-like pod name before calling kubectl", async () => {
    const deps = fakeDeps();
    await expect(execInPod(deps, { name: "--evil", command: ["ls"] })).rejects.toThrow();
    expect(deps.kubectl).not.toHaveBeenCalled();
  });

  test("rejects an empty command array before calling kubectl", async () => {
    const deps = fakeDeps();
    await expect(execInPod(deps, { name: "web", command: [] })).rejects.toThrow();
    expect(deps.kubectl).not.toHaveBeenCalled();
  });

  test("rejects a non-array command before calling kubectl", async () => {
    const deps = fakeDeps();
    await expect(
      execInPod(deps, { name: "web", command: "ls -la" as unknown as string[] }),
    ).rejects.toThrow();
    expect(deps.kubectl).not.toHaveBeenCalled();
  });

  test("a non-zero exit from the in-pod command returns combined stdout/stderr instead of throwing", async () => {
    const deps = fakeDeps(async () => {
      throw new KubectlError(
        '"exec_in_pod" failed: some error',
        "exec_in_pod",
        "kubectl_failed",
        undefined,
        "partial diagnostic output\n",
        "some error\n",
        1,
      );
    });
    const result = await execInPod(deps, { name: "web", command: ["false"] });
    expect(result.output).toBe(
      "Command exited with code 1\n--- stdout ---\npartial diagnostic output\n\n--- stderr ---\nsome error\n",
    );
  });

  test("a genuine connection/timeout failure (no exitCode) still throws", async () => {
    const deps = fakeDeps(async () => {
      throw new KubectlError('Timed out running "exec_in_pod".', "exec_in_pod", "timeout");
    });
    await expect(execInPod(deps, { name: "web", command: ["ls"] })).rejects.toThrow(KubectlError);
  });
});
