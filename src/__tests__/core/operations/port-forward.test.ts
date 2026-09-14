import { EventEmitter } from "node:events";
import { describe, expect, test, vi } from "vitest";

// spawn is mocked so no real kubectl process is ever launched; the fake
// child emits stdout containing "Forwarding from" so executePortForward's
// promise resolves the way it does against a real successful port-forward.
vi.mock("node:child_process", () => {
  return {
    spawn: vi.fn(() => {
      const child: any = new EventEmitter();
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      child.pid = 4242;
      // Emit success asynchronously so listeners are attached first.
      setImmediate(() =>
        child.stdout.emit("data", Buffer.from("Forwarding from 127.0.0.1:8080 -> 80\n")),
      );
      return child;
    }),
  };
});

const { spawn } = await import("node:child_process");
const { portForward, stopPortForward } = await import("../../../core/operations/port-forward.js");
const { KubectlError } = await import("../../../core/errors.js");

import type { Deps } from "../../../core/types.js";

function fakeDeps(): Deps & { client: any } {
  const tracked = new Map<string, any>();
  const client = {
    trackPortForward: vi.fn((pf: any) => tracked.set(pf.id, pf)),
    getPortForward: vi.fn((id: string) => tracked.get(id)),
    removePortForward: vi.fn((id: string) => tracked.delete(id)),
  };
  return {
    kubectl: vi.fn(async () => "") as unknown as Deps["kubectl"],
    helm: vi.fn(async () => "") as unknown as Deps["helm"],
    client: client as unknown as Deps["client"],
    config: {} as Deps["config"],
  } as Deps & { client: any };
}

describe("portForward", () => {
  test("spawns kubectl with the expected argv and tracks the process", async () => {
    const deps = fakeDeps();
    const result = await portForward(deps, {
      resourceType: "deployment",
      resourceName: "web",
      localPort: 8080,
      targetPort: 80,
      namespace: "prod",
    });

    expect(spawn).toHaveBeenCalledWith("kubectl", [
      "port-forward",
      "-n",
      "prod",
      "deployment/web",
      "8080:80",
    ]);
    expect(result).toEqual({
      success: true,
      message: "port-forwarding was successful",
      id: "deployment-web-8080",
    });
    expect(deps.client.trackPortForward).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "deployment-web-8080",
        resourceType: "deployment",
        name: "web",
        namespace: "prod",
      }),
    );
  });

  test("omits -n when no namespace is given", async () => {
    const deps = fakeDeps();
    await portForward(deps, {
      resourceType: "pod",
      resourceName: "web",
      localPort: 3000,
      targetPort: 3000,
    });
    expect(spawn).toHaveBeenCalledWith("kubectl", ["port-forward", "pod/web", "3000:3000"]);
  });

  test("rejects a flag-like argv before spawning (assertSafeArgv)", async () => {
    const deps = fakeDeps();
    await expect(
      portForward(deps, {
        resourceType: "--server=evil",
        resourceName: "web",
        localPort: 8080,
        targetPort: 80,
      }),
    ).rejects.toThrow();
  });
});

describe("stopPortForward", () => {
  test("stops and untracks a tracked port-forward", async () => {
    const deps = fakeDeps();
    await portForward(deps, {
      resourceType: "pod",
      resourceName: "web",
      localPort: 8080,
      targetPort: 80,
    });

    const result = await stopPortForward(deps, { id: "pod-web-8080" });

    expect(result).toEqual({ success: true, message: "port-forward stopped successfully" });
    expect(deps.client.removePortForward).toHaveBeenCalledWith("pod-web-8080");
  });

  test("throws a not_found KubectlError for an unknown id", async () => {
    const deps = fakeDeps();
    await expect(stopPortForward(deps, { id: "missing" })).rejects.toThrow(KubectlError);
    await expect(stopPortForward(deps, { id: "missing" })).rejects.toMatchObject({
      code: "not_found",
    });
  });
});
