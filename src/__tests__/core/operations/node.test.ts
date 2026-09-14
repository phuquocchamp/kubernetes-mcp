import { describe, expect, test, vi } from "vitest";
import type { KubectlError } from "../../../core/errors.js";
import { manageNode } from "../../../core/operations/node.js";
import type { Deps } from "../../../core/types.js";

function fakeDeps(kubectl: ReturnType<typeof vi.fn>): Deps {
  return {
    kubectl,
    helm: vi.fn(),
    client: {} as Deps["client"],
    config: {} as Deps["config"],
  };
}

const nodeJson = (unschedulable: boolean) => JSON.stringify({ spec: { unschedulable } });

// Mirrors NODE_OP_OPTS in core/operations/node.ts: every deps.kubectl call
// for a node op must carry the 5-minute timeout the original tool used.
const NODE_OP_OPTS = expect.objectContaining({ timeoutMs: 300_000 });

describe("manageNode", () => {
  test("cordon builds `get node -o json` then `cordon <name>`", async () => {
    const kubectl = vi.fn().mockResolvedValueOnce(nodeJson(false)).mockResolvedValueOnce("");
    const deps = fakeDeps(kubectl);

    const result = await manageNode(deps, { operation: "cordon", nodeName: "node-1" });

    expect(kubectl).toHaveBeenNthCalledWith(
      1,
      ["get", "node", "node-1", "-o", "json"],
      "node_management",
      NODE_OP_OPTS,
    );
    expect(kubectl).toHaveBeenNthCalledWith(
      2,
      ["cordon", "node-1"],
      "node_management",
      NODE_OP_OPTS,
    );
    expect(result.message).toContain("Successfully cordoned node 'node-1'");
  });

  test("cordon short-circuits (no cordon call) when node is already unschedulable", async () => {
    const kubectl = vi.fn().mockResolvedValueOnce(nodeJson(true));
    const deps = fakeDeps(kubectl);

    const result = await manageNode(deps, { operation: "cordon", nodeName: "node-1" });

    expect(kubectl).toHaveBeenCalledTimes(1);
    expect(result.message).toContain("already cordoned");
  });

  test("uncordon builds `get node -o json` then `uncordon <name>`", async () => {
    const kubectl = vi.fn().mockResolvedValueOnce(nodeJson(true)).mockResolvedValueOnce("");
    const deps = fakeDeps(kubectl);

    const result = await manageNode(deps, { operation: "uncordon", nodeName: "node-1" });

    expect(kubectl).toHaveBeenNthCalledWith(
      2,
      ["uncordon", "node-1"],
      "node_management",
      NODE_OP_OPTS,
    );
    expect(result.message).toContain("Successfully uncordoned node 'node-1'");
  });

  test("drain without confirmDrain and without dryRun does not call kubectl drain", async () => {
    const kubectl = vi.fn().mockResolvedValueOnce(nodeJson(false));
    const deps = fakeDeps(kubectl);

    const result = await manageNode(deps, {
      operation: "drain",
      nodeName: "node-1",
      confirmDrain: false,
      dryRun: false,
    });

    expect(kubectl).toHaveBeenCalledTimes(1);
    expect(result.message).toContain("requires explicit confirmation");
  });

  test("drain with dryRun=true runs without confirmDrain and passes --dry-run=client", async () => {
    const kubectl = vi
      .fn()
      .mockResolvedValueOnce(nodeJson(false))
      .mockResolvedValueOnce("node/node-1 drained (dry run)");
    const deps = fakeDeps(kubectl);

    const result = await manageNode(deps, {
      operation: "drain",
      nodeName: "node-1",
      dryRun: true,
      confirmDrain: false,
    });

    expect(kubectl).toHaveBeenNthCalledWith(
      2,
      ["drain", "node-1", "--ignore-daemonsets", "--dry-run=client"],
      "node_management",
      NODE_OP_OPTS,
    );
    expect(result.message).toContain("Dry run drain operation");
  });

  test("drain with confirmDrain=true builds full argv from force/gracePeriod/deleteLocalData/timeout options", async () => {
    const kubectl = vi
      .fn()
      .mockResolvedValueOnce(nodeJson(false))
      .mockResolvedValueOnce("node/node-1 drained");
    const deps = fakeDeps(kubectl);

    const result = await manageNode(deps, {
      operation: "drain",
      nodeName: "node-1",
      confirmDrain: true,
      force: true,
      gracePeriod: 30,
      deleteLocalData: true,
      ignoreDaemonsets: false,
      timeout: "5m",
    });

    expect(kubectl).toHaveBeenNthCalledWith(
      2,
      [
        "drain",
        "node-1",
        "--force",
        "--grace-period",
        "30",
        "--delete-local-data",
        "--timeout",
        "5m",
      ],
      "node_management",
      NODE_OP_OPTS,
    );
    expect(result.message).toContain("Successfully drained node 'node-1'");
  });

  test("drain short-circuits when node is already unschedulable", async () => {
    const kubectl = vi.fn().mockResolvedValueOnce(nodeJson(true));
    const deps = fakeDeps(kubectl);

    const result = await manageNode(deps, {
      operation: "drain",
      nodeName: "node-1",
      confirmDrain: true,
    });

    expect(kubectl).toHaveBeenCalledTimes(1);
    expect(result.message).toContain("already cordoned");
  });

  test("missing nodeName throws invalid_input before calling kubectl", async () => {
    const kubectl = vi.fn();
    const deps = fakeDeps(kubectl);

    await expect(manageNode(deps, { operation: "cordon" })).rejects.toMatchObject({
      code: "invalid_input",
    } satisfies Partial<KubectlError>);
    expect(kubectl).not.toHaveBeenCalled();
  });

  test("flag-like nodeName is rejected before calling kubectl (assertNotFlagLike)", async () => {
    const kubectl = vi.fn();
    const deps = fakeDeps(kubectl);

    await expect(
      manageNode(deps, { operation: "cordon", nodeName: "--kubeconfig=/tmp/evil" }),
    ).rejects.toThrow();
    expect(kubectl).not.toHaveBeenCalled();
  });
});
