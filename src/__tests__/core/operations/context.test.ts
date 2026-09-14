import { describe, expect, test, vi } from "vitest";
import { getSpawnMaxBuffer } from "../../../config/max-buffer.js";
import { KubectlError } from "../../../core/errors.js";
import { kubectlContext, kubectlReconnect } from "../../../core/operations/context.js";
import type { Deps } from "../../../core/types.js";

const RUN_OPTS = { maxBuffer: getSpawnMaxBuffer() };

function makeDeps(kubectlImpl: (args: string[]) => Promise<string>): Deps {
  return {
    kubectl: vi.fn((args: string[]) => kubectlImpl(args)),
    helm: vi.fn(),
    client: { refreshApiClients: vi.fn() } as unknown as Deps["client"],
    config: {} as Deps["config"],
  };
}

describe("kubectlContext operation", () => {
  test("list (json output) builds `config get-contexts` and parses the table", async () => {
    const table = [
      "CURRENT   NAME      CLUSTER   AUTHINFO   NAMESPACE",
      "*         ctx-a     cluster-a user-a     default",
      "          ctx-b     cluster-b user-b     kube-system",
    ].join("\n");
    const deps = makeDeps(async () => table);

    const result = await kubectlContext(deps, { operation: "list", output: "json" });

    expect(deps.kubectl).toHaveBeenCalledWith(
      ["config", "get-contexts"],
      "kubectl_context",
      RUN_OPTS,
    );
    expect(result).toEqual({
      kind: "list-structured",
      contexts: [
        {
          name: "ctx-a",
          cluster: "cluster-a",
          user: "user-a",
          namespace: "default",
          isCurrent: true,
        },
        {
          name: "ctx-b",
          cluster: "cluster-b",
          user: "user-b",
          namespace: "kube-system",
          isCurrent: false,
        },
      ],
    });
  });

  test("list (name output) builds `config get-contexts -o name`", async () => {
    const deps = makeDeps(async () => "ctx-a\nctx-b\n");

    const result = await kubectlContext(deps, { operation: "list", output: "name" });

    expect(deps.kubectl).toHaveBeenCalledWith(
      ["config", "get-contexts", "-o", "name"],
      "kubectl_context",
      RUN_OPTS,
    );
    expect(result).toEqual({ kind: "list-raw", raw: "ctx-a\nctx-b\n" });
  });

  test("get (simple) builds `config current-context`", async () => {
    const deps = makeDeps(async () => "ctx-a\n");

    const result = await kubectlContext(deps, { operation: "get" });

    expect(deps.kubectl).toHaveBeenCalledWith(
      ["config", "current-context"],
      "kubectl_context",
      RUN_OPTS,
    );
    expect(result).toEqual({ kind: "get-simple", currentContext: "ctx-a" });
  });

  test("get (detailed) also fetches get-contexts and cross-references the current context", async () => {
    let call = 0;
    const deps = makeDeps(async (args) => {
      call++;
      if (args[1] === "current-context") return "ctx-b\n";
      return [
        "CURRENT   NAME      CLUSTER   AUTHINFO   NAMESPACE",
        "          ctx-a     cluster-a user-a     default",
        "*         ctx-b     cluster-b user-b     kube-system",
      ].join("\n");
    });

    const result = await kubectlContext(deps, { operation: "get", detailed: true });

    expect(call).toBe(2);
    expect(deps.kubectl).toHaveBeenNthCalledWith(
      1,
      ["config", "current-context"],
      "kubectl_context",
      RUN_OPTS,
    );
    expect(deps.kubectl).toHaveBeenNthCalledWith(
      2,
      ["config", "get-contexts"],
      "kubectl_context",
      RUN_OPTS,
    );
    expect(result).toEqual({
      kind: "get-detailed",
      name: "ctx-b",
      cluster: "cluster-b",
      user: "user-b",
      namespace: "kube-system",
    });
  });

  test("set resolves the short name and calls use-context", async () => {
    const deps = makeDeps(async (args) => {
      if (args[1] === "get-contexts") return "ctx-a\nctx-b\n";
      return 'Switched to context "ctx-b".\n';
    });

    const result = await kubectlContext(deps, { operation: "set", name: "ctx-b" });

    expect(deps.kubectl).toHaveBeenNthCalledWith(
      1,
      ["config", "get-contexts", "-o", "name"],
      "kubectl_context",
      RUN_OPTS,
    );
    expect(deps.kubectl).toHaveBeenNthCalledWith(
      2,
      ["config", "use-context", "ctx-b"],
      "kubectl_context",
      RUN_OPTS,
    );
    expect(result).toEqual({
      kind: "set",
      success: true,
      message: "Current context set to 'ctx-b'",
      context: "ctx-b",
    });
  });

  test("set resolves an EKS-style ARN context to its short cluster/<name> suffix", async () => {
    const deps = makeDeps(async (args) => {
      if (args[1] === "get-contexts") return "my-cluster\n";
      return "Switched to context.\n";
    });

    const arn = "arn:aws:eks:us-east-1:123456789012:cluster/my-cluster";
    const result = await kubectlContext(deps, { operation: "set", name: arn });

    expect(deps.kubectl).toHaveBeenNthCalledWith(
      2,
      ["config", "use-context", "my-cluster"],
      "kubectl_context",
      RUN_OPTS,
    );
    expect(result).toEqual({
      kind: "set",
      success: true,
      message: `Current context set to '${arn}'`,
      context: arn,
    });
  });

  test("set throws invalid_input when the target context does not exist", async () => {
    const deps = makeDeps(async (args) => {
      if (args[1] === "get-contexts") return "ctx-a\n";
      throw new Error("should not reach use-context");
    });

    await expect(kubectlContext(deps, { operation: "set", name: "missing" })).rejects.toMatchObject(
      {
        code: "invalid_input",
      },
    );
  });

  test("set throws invalid_input when name is missing", async () => {
    const deps = makeDeps(async () => "");

    await expect(kubectlContext(deps, { operation: "set" })).rejects.toBeInstanceOf(KubectlError);
    expect(deps.kubectl).not.toHaveBeenCalled();
  });

  test("set rejects a flag-like context name before ever calling kubectl", async () => {
    const deps = makeDeps(async () => "ctx-a\n");

    await expect(
      kubectlContext(deps, { operation: "set", name: "--kubeconfig=/etc/passwd" }),
    ).rejects.toThrow();
    expect(deps.kubectl).not.toHaveBeenCalled();
  });
});

describe("kubectlReconnect operation", () => {
  test("calls refreshApiClients on deps.client and never spawns a process", async () => {
    const refreshApiClients = vi.fn();
    const deps = {
      kubectl: vi.fn(),
      helm: vi.fn(),
      client: { refreshApiClients } as unknown as Deps["client"],
      config: {} as Deps["config"],
    } satisfies Deps;

    const result = await kubectlReconnect(deps);

    expect(refreshApiClients).toHaveBeenCalledOnce();
    expect(deps.kubectl).not.toHaveBeenCalled();
    expect(deps.helm).not.toHaveBeenCalled();
    expect(result).toEqual({
      success: true,
      message: "API clients refreshed. DNS will be re-resolved on the next request.",
    });
  });

  test("wraps a thrown error from refreshApiClients into a KubectlError", async () => {
    const deps = {
      kubectl: vi.fn(),
      helm: vi.fn(),
      client: {
        refreshApiClients: vi.fn(() => {
          throw new Error("connection reset");
        }),
      } as unknown as Deps["client"],
      config: {} as Deps["config"],
    } satisfies Deps;

    await expect(kubectlReconnect(deps)).rejects.toMatchObject({
      code: "internal",
      message: expect.stringContaining("connection reset"),
    });
  });
});
