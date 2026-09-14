import { describe, expect, test, vi } from "vitest";
import { explain } from "../../../core/operations/explain.js";
import type { Deps } from "../../../core/types.js";

function fakeDeps(): Deps {
  return {
    kubectl: vi.fn(async () => "KIND: Pod\n"),
    helm: vi.fn(async () => ""),
    client: {} as Deps["client"],
    config: {} as Deps["config"],
  };
}

describe("explain", () => {
  test("builds minimal argv for a bare resource", async () => {
    const deps = fakeDeps();
    const result = await explain(deps, { resource: "pods" });

    expect(deps.kubectl).toHaveBeenCalledWith(["explain", "pods"], "explain_resource");
    expect(result.raw).toBe("KIND: Pod\n");
  });

  test("includes apiVersion, recursive, context and output flags when provided", async () => {
    const deps = fakeDeps();
    await explain(deps, {
      resource: "pods.spec.containers",
      apiVersion: "apps/v1",
      recursive: true,
      context: "prod",
      output: "plaintext-openapiv2",
    });

    const [argv] = (deps.kubectl as any).mock.calls[0];
    expect(argv).toEqual([
      "explain",
      "--api-version=apps/v1",
      "--recursive",
      "--context",
      "prod",
      "--output=plaintext-openapiv2",
      "pods.spec.containers",
    ]);
  });
});
