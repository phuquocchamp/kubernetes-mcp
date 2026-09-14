import { McpError } from "@modelcontextprotocol/sdk/types.js";
import { describe, expect, test, vi } from "vitest";
import { getSpawnMaxBuffer } from "../../../config/max-buffer.js";
import { KubectlError } from "../../../core/errors.js";
import { logs } from "../../../core/operations/logs.js";
import type { Deps } from "../../../core/types.js";

function fakeDeps(kubectlImpl: (args: string[]) => string | Promise<string>): {
  deps: Deps;
  kubectl: ReturnType<typeof vi.fn>;
} {
  const kubectl = vi.fn().mockImplementation(async (args: string[]) => kubectlImpl(args));
  const helm = vi.fn();
  const deps = {
    kubectl,
    helm,
    client: {} as Deps["client"],
    config: {} as Deps["config"],
  } as Deps;
  return { deps, kubectl };
}

describe("logs operation", () => {
  test("builds argv for a plain pod, defaulting namespace", async () => {
    const { deps, kubectl } = fakeDeps(() => "pod log output");

    const result = await logs(deps, { resourceType: "pod", name: "my-pod" });

    expect(kubectl).toHaveBeenCalledWith(["-n", "default", "logs", "my-pod"], "kubectl_logs", {
      maxBuffer: getSpawnMaxBuffer(),
    });
    expect(result).toEqual({ kind: "pod", name: "my-pod", logs: "pod log output" });
  });

  test("adds container, tail, since, timestamps, previous, follow and context flags for a pod", async () => {
    const { deps, kubectl } = fakeDeps(() => "logs");

    await logs(deps, {
      resourceType: "pod",
      name: "my-pod",
      namespace: "kube-system",
      container: "app",
      tail: 50,
      since: "5m",
      sinceTime: "2024-01-01T00:00:00Z",
      timestamps: true,
      previous: true,
      follow: true,
      context: "prod",
    });

    expect(kubectl).toHaveBeenCalledWith(
      [
        "-n",
        "kube-system",
        "logs",
        "my-pod",
        "-c",
        "app",
        "--tail=50",
        "--since=5m",
        "--since-time=2024-01-01T00:00:00Z",
        "--timestamps",
        "--previous",
        "--follow",
        "--context",
        "prod",
      ],
      "kubectl_logs",
      { maxBuffer: getSpawnMaxBuffer() },
    );
  });

  test("resolves a deployment's selector then fans out to matching pods", async () => {
    const { deps, kubectl } = fakeDeps((args) => {
      if (args.includes("deployment")) return JSON.stringify({ app: "web" });
      if (args[3] === "pods") return "web-1 web-2";
      return `logs for ${args[3]}`;
    });

    const result = await logs(deps, {
      resourceType: "deployment",
      name: "web",
      namespace: "default",
    });

    expect(kubectl).toHaveBeenCalledWith(
      ["-n", "default", "get", "deployment", "web", "-o", "jsonpath={.spec.selector.matchLabels}"],
      "kubectl_logs",
      { maxBuffer: getSpawnMaxBuffer() },
    );
    expect(kubectl).toHaveBeenCalledWith(
      [
        "-n",
        "default",
        "get",
        "pods",
        "--selector=app=web",
        "-o",
        "jsonpath={.items[*].metadata.name}",
      ],
      "kubectl_logs",
      { maxBuffer: getSpawnMaxBuffer() },
    );
    expect(result).toEqual({
      kind: "selector",
      selector: "app=web",
      namespace: "default",
      logs: { "web-1": "logs for web-1", "web-2": "logs for web-2" },
    });
  });

  test("uses a job-name selector for a job", async () => {
    const { deps, kubectl } = fakeDeps((args) => {
      if (args[3] === "pods") return "job-pod-1";
      return "job pod logs";
    });

    const result = await logs(deps, { resourceType: "job", name: "my-job", namespace: "default" });

    expect(kubectl).toHaveBeenCalledWith(
      [
        "-n",
        "default",
        "get",
        "pods",
        "--selector=job-name=my-job",
        "-o",
        "jsonpath={.items[*].metadata.name}",
      ],
      "kubectl_logs",
      { maxBuffer: getSpawnMaxBuffer() },
    );
    expect(result).toEqual({
      kind: "selector",
      selector: "job-name=my-job",
      namespace: "default",
      logs: { "job-pod-1": "job pod logs" },
    });
  });

  test("returns a message when a label selector matches no pods", async () => {
    const { deps } = fakeDeps(() => "");

    const result = await logs(deps, {
      resourceType: "job",
      name: "empty-job",
      namespace: "default",
    });

    expect(result).toEqual({
      kind: "message",
      message: 'No pods found with label selector "job-name=empty-job" in namespace default',
    });
  });

  test("finds jobs for a cronjob and collects per-job pod logs", async () => {
    const { deps, kubectl } = fakeDeps((args) => {
      if (args[3] === "jobs") return "job-a job-b";
      if (args[3] === "pods" && args[4] === "--selector=job-name=job-a") return "pod-a";
      if (args[3] === "pods" && args[4] === "--selector=job-name=job-b") return "pod-b";
      return `logs for ${args[3]}`;
    });

    const result = await logs(deps, {
      resourceType: "cronjob",
      name: "my-cron",
      namespace: "default",
    });

    expect(kubectl).toHaveBeenCalledWith(
      [
        "-n",
        "default",
        "get",
        "jobs",
        "--selector=job-name=my-cron",
        "-o",
        "jsonpath={.items[*].metadata.name}",
      ],
      "kubectl_logs",
      { maxBuffer: getSpawnMaxBuffer() },
    );
    expect(result).toEqual({
      kind: "cronjob",
      cronjob: "my-cron",
      namespace: "default",
      jobs: { "job-a": { "pod-a": "logs for pod-a" }, "job-b": { "pod-b": "logs for pod-b" } },
    });
  });

  test("returns a message when a cronjob has no jobs", async () => {
    const { deps } = fakeDeps(() => "");

    const result = await logs(deps, {
      resourceType: "cronjob",
      name: "idle-cron",
      namespace: "default",
    });

    expect(result).toEqual({
      kind: "message",
      message: "No jobs found for cronjob idle-cron in namespace default",
    });
  });

  test("falls back to an explicit labelSelector when resourceType is unrecognized", async () => {
    const { deps, kubectl } = fakeDeps((args) => {
      if (args[3] === "pods") return "pod-x";
      return "selector logs";
    });

    const result = await logs(deps, {
      resourceType: "statefulset" as never,
      name: "unused",
      labelSelector: "app=custom",
    });

    expect(kubectl).toHaveBeenCalledWith(
      [
        "-n",
        "default",
        "get",
        "pods",
        "--selector=app=custom",
        "-o",
        "jsonpath={.items[*].metadata.name}",
      ],
      "kubectl_logs",
      { maxBuffer: getSpawnMaxBuffer() },
    );
    expect(result).toEqual({
      kind: "selector",
      selector: "app=custom",
      namespace: "default",
      logs: { "pod-x": "selector logs" },
    });
  });

  test("records the error per-pod instead of failing the whole selector fan-out", async () => {
    const { deps } = fakeDeps((args) => {
      if (args[3] === "pods") return "good-pod bad-pod";
      if (args[3] === "bad-pod") throw new Error("boom");
      return "good logs";
    });

    const result = await logs(deps, { resourceType: "job", name: "my-job" });

    expect(result).toEqual({
      kind: "selector",
      selector: "job-name=my-job",
      namespace: "default",
      logs: { "good-pod": "good logs", "bad-pod": "Error: boom" },
    });
  });

  test("throws for an unsupported resource type with no labelSelector", async () => {
    const { deps, kubectl } = fakeDeps(() => "");

    await expect(logs(deps, { resourceType: "unsupported" as never, name: "x" })).rejects.toThrow(
      KubectlError,
    );
    expect(kubectl).not.toHaveBeenCalled();
  });

  test("rejects a flag-like name", async () => {
    const { deps, kubectl } = fakeDeps(() => "");

    await expect(
      logs(deps, { resourceType: "pod", name: "--kubeconfig=/tmp/evil" }),
    ).rejects.toThrow(McpError);
    expect(kubectl).not.toHaveBeenCalled();
  });
});
