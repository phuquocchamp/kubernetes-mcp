import { describe, expect, test, vi } from "vitest";
import { cleanup } from "../../../core/operations/cleanup.js";
import type { Deps } from "../../../core/types.js";

function fakeDeps(cleanupImpl?: () => Promise<void>): Deps {
  return {
    kubectl: vi.fn(async () => ""),
    helm: vi.fn(async () => ""),
    client: { cleanup: vi.fn(cleanupImpl ?? (async () => undefined)) } as unknown as Deps["client"],
    config: {} as Deps["config"],
  };
}

describe("cleanup", () => {
  test("delegates to KubernetesManager.cleanup() and does not reimplement tracking", async () => {
    const deps = fakeDeps();
    const result = await cleanup(deps);

    expect(deps.client.cleanup).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ success: true });
  });

  test("propagates a failure from client.cleanup()", async () => {
    const deps = fakeDeps(async () => {
      throw new Error("boom");
    });

    await expect(cleanup(deps)).rejects.toThrow("boom");
  });
});
