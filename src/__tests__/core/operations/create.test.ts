import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { create } from "../../../core/operations/create.js";
import type { Deps } from "../../../core/types.js";

const TRANSPORT_ENV = ["ENABLE_UNSAFE_SSE_TRANSPORT", "ENABLE_UNSAFE_STREAMABLE_HTTP_TRANSPORT"] as const;

function fakeDeps(kubectlImpl?: (...a: unknown[]) => unknown): Deps {
  return {
    kubectl: vi.fn(kubectlImpl ?? (async () => "ok")) as unknown as Deps["kubectl"],
    helm: vi.fn(async () => "ok") as unknown as Deps["helm"],
    client: {} as Deps["client"],
    config: {} as Deps["config"],
  };
}

describe("create (kubectl_create)", () => {
  test("namespace resource type omits -n and pushes the name", async () => {
    const deps = fakeDeps();
    await create(deps, { resourceType: "namespace", name: "team-a" });

    expect(deps.kubectl).toHaveBeenCalledTimes(1);
    const argv = (deps.kubectl as any).mock.calls[0][0] as string[];
    expect(argv).toEqual(["create", "namespace", "team-a", "-o", "yaml"]);
  });

  test("configmap with fromLiteral builds --from-literal args and defaults namespace", async () => {
    const deps = fakeDeps();
    await create(deps, {
      resourceType: "configmap",
      name: "cfg",
      fromLiteral: ["key1=value1", "key2=value2"],
    });

    const argv = (deps.kubectl as any).mock.calls[0][0] as string[];
    expect(argv).toEqual([
      "create",
      "configmap",
      "cfg",
      "--from-literal=key1=value1",
      "--from-literal=key2=value2",
      "-n",
      "default",
      "-o",
      "yaml",
    ]);
  });

  test("deployment with image, replicas and port", async () => {
    const deps = fakeDeps();
    await create(deps, {
      resourceType: "deployment",
      name: "web",
      image: "nginx:latest",
      replicas: 3,
      port: 80,
      namespace: "prod",
      context: "prod-ctx",
    });

    const argv = (deps.kubectl as any).mock.calls[0][0] as string[];
    expect(argv).toEqual([
      "create",
      "deployment",
      "web",
      "--image=nginx:latest",
      "--replicas=3",
      "--port=80",
      "-n",
      "prod",
      "-o",
      "yaml",
      "--context",
      "prod-ctx",
    ]);
  });

  test("fromFileContent writes a temp file and emits --from-file=<key>=<tempfile>, then cleans it up", async () => {
    const deps = fakeDeps();
    await create(deps, {
      resourceType: "configmap",
      name: "cfg",
      fromFileContent: [{ key: "app.conf", content: "hello=world" }],
    });

    const argv = (deps.kubectl as any).mock.calls[0][0] as string[];
    const fromFileArg = argv.find((a) => a.startsWith("--from-file="));
    expect(fromFileArg).toMatch(/^--from-file=app\.conf=.*$/);

    const tempPath = fromFileArg!.split("=").slice(2).join("=");
    const fs = await import("node:fs");
    expect(fs.existsSync(tempPath)).toBe(false); // cleaned up after the call
  });

  test("cleans up temp files even when deps.kubectl throws", async () => {
    const deps = fakeDeps(async () => {
      throw new Error("boom");
    });

    await expect(
      create(deps, { manifest: "kind: ConfigMap\nmetadata:\n  name: cfg\n" }),
    ).rejects.toThrow("boom");

    const argv = (deps.kubectl as any).mock.calls[0][0] as string[];
    const manifestPath = argv[argv.indexOf("-f") + 1];
    const fs = await import("node:fs");
    expect(fs.existsSync(manifestPath)).toBe(false);
  });

  test("rejects missing manifest/filename/resourceType with invalid_input", async () => {
    const deps = fakeDeps();
    await expect(create(deps, {})).rejects.toMatchObject({
      code: "invalid_input",
      message: expect.stringContaining("Either manifest, filename, or resourceType"),
    });
    expect(deps.kubectl).not.toHaveBeenCalled();
  });

  test("rejects secret without secretType", async () => {
    const deps = fakeDeps();
    await expect(create(deps, { resourceType: "secret", name: "s1" })).rejects.toMatchObject({
      code: "invalid_input",
      message: expect.stringContaining("secretType is required"),
    });
    expect(deps.kubectl).not.toHaveBeenCalled();
  });

  test("rejects deployment without image", async () => {
    const deps = fakeDeps();
    await expect(create(deps, { resourceType: "deployment", name: "web" })).rejects.toMatchObject({
      code: "invalid_input",
    });
    expect(deps.kubectl).not.toHaveBeenCalled();
  });

  describe("remote transport guards", () => {
    let saved: Record<string, string | undefined>;

    beforeEach(() => {
      saved = {};
      TRANSPORT_ENV.forEach((k) => {
        saved[k] = process.env[k];
        delete process.env[k];
      });
    });

    afterEach(() => {
      TRANSPORT_ENV.forEach((k) => {
        if (saved[k] === undefined) delete process.env[k];
        else process.env[k] = saved[k];
      });
    });

    test("rejects filename under a remote transport before calling kubectl", async () => {
      process.env.ENABLE_UNSAFE_STREAMABLE_HTTP_TRANSPORT = "true";
      const deps = fakeDeps();
      await expect(create(deps, { filename: "/etc/passwd" })).rejects.toMatchObject({
        code: "invalid_input",
        message: expect.stringContaining("disabled on remote"),
      });
      expect(deps.kubectl).not.toHaveBeenCalled();
    });

    test("rejects fromFile under a remote transport before calling kubectl", async () => {
      process.env.ENABLE_UNSAFE_SSE_TRANSPORT = "true";
      const deps = fakeDeps();
      await expect(
        create(deps, { resourceType: "configmap", name: "leak", fromFile: ["/etc/passwd"] }),
      ).rejects.toMatchObject({
        code: "invalid_input",
        message: expect.stringContaining("disabled on remote"),
      });
      expect(deps.kubectl).not.toHaveBeenCalled();
    });

    test("allows fromFileContent under a remote transport", async () => {
      process.env.ENABLE_UNSAFE_STREAMABLE_HTTP_TRANSPORT = "true";
      const deps = fakeDeps();
      await create(deps, {
        resourceType: "configmap",
        name: "cfg",
        fromFileContent: [{ key: "app.conf", content: "hello=world" }],
      });
      expect(deps.kubectl).toHaveBeenCalledTimes(1);
    });
  });
});
