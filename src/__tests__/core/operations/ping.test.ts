import { describe, expect, test, vi } from "vitest";
import { ping } from "../../../core/operations/ping.js";
import type { Deps } from "../../../core/types.js";

function fakeDeps(): Deps {
  return {
    kubectl: vi.fn(async () => ""),
    helm: vi.fn(async () => ""),
    client: {} as Deps["client"],
    config: {} as Deps["config"],
  };
}

describe("ping", () => {
  test("resolves to an empty object without touching kubectl/helm", async () => {
    const deps = fakeDeps();
    const result = await ping(deps);

    expect(result).toEqual({});
    expect(deps.kubectl).not.toHaveBeenCalled();
    expect(deps.helm).not.toHaveBeenCalled();
  });
});
