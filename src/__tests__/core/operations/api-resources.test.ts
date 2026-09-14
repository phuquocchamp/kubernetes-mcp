import { describe, expect, test, vi } from "vitest";
import { listApiResources } from "../../../core/operations/api-resources.js";
import type { Deps } from "../../../core/types.js";

function fakeDeps(): Deps {
  return {
    kubectl: vi.fn(async () => "NAME  SHORTNAMES\n"),
    helm: vi.fn(async () => ""),
    client: {} as Deps["client"],
    config: {} as Deps["config"],
  };
}

describe("listApiResources", () => {
  test("builds minimal argv with no filters", async () => {
    const deps = fakeDeps();
    const result = await listApiResources(deps, {});

    expect(deps.kubectl).toHaveBeenCalledWith(["api-resources"], "list_api_resources");
    expect(result.raw).toBe("NAME  SHORTNAMES\n");
  });

  test("includes apiGroup, namespaced, verbs, output and context flags when provided", async () => {
    const deps = fakeDeps();
    await listApiResources(deps, {
      apiGroup: "apps",
      namespaced: true,
      verbs: ["get", "list"],
      output: "name",
      context: "prod",
    });

    const [argv] = (deps.kubectl as any).mock.calls[0];
    expect(argv).toEqual([
      "api-resources",
      "--api-group=apps",
      "--namespaced=true",
      "--verbs=get,list",
      "-o",
      "name",
      "--context",
      "prod",
    ]);
  });

  test("omits --verbs when the list is empty", async () => {
    const deps = fakeDeps();
    await listApiResources(deps, { verbs: [] });

    const [argv] = (deps.kubectl as any).mock.calls[0];
    expect(argv).not.toContain(expect.stringContaining("--verbs"));
    expect(argv).toEqual(["api-resources"]);
  });
});
