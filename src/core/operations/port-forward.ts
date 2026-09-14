/**
 * port_forward / stop_port_forward — start and stop a `kubectl port-forward`
 * background process.
 *
 * Ported from src/tools/port_forward.ts. Unlike every other operation in
 * this directory, this one does NOT go through deps.kubectl: port-forward
 * is a long-running process that never exits on its own, whereas
 * deps.kubectl (core/kubectl.ts) awaits execFile to completion. So this
 * keeps the original's direct `spawn` call and runs the argv guard itself
 * (assertSafeArgv) exactly as the old tool did — deps.kubectl's guard never
 * runs for this path since deps.kubectl is never called.
 *
 * State tracking (trackPortForward/getPortForward/removePortForward) stays
 * on deps.client (the live KubernetesManager), unchanged from the original.
 */
import { spawn } from "node:child_process";
import { KubectlError } from "../errors.js";
import { assertSafeArgv } from "../security/argv.js";
import type { Deps } from "../types.js";

export interface PortForwardArgs {
  resourceType: string;
  resourceName: string;
  localPort: number;
  targetPort: number;
  namespace?: string;
}

export interface PortForwardResult {
  success: boolean;
  message: string;
  id: string;
}

export interface StopPortForwardArgs {
  id: string;
}

export interface StopPortForwardResult {
  success: boolean;
  message: string;
}

async function executePortForward(
  args: string[],
): Promise<{ success: boolean; message: string; pid: number }> {
  // port_forward uses spawn (long-running process) rather than deps.kubectl,
  // so it must run the argv guard itself. Otherwise user-supplied values
  // pushed into positional slots (e.g. resourceType) can smuggle
  // credential/target-redirecting flags such as --server.
  assertSafeArgv(args);
  return new Promise((resolve, reject) => {
    const child = spawn("kubectl", args);

    let output = "";
    let errorOutput = "";

    child.stdout.on("data", (data) => {
      output += data.toString();
      if (output.includes("Forwarding from")) {
        resolve({
          success: true,
          message: "port-forwarding was successful",
          pid: child.pid!,
        });
      }
    });

    child.stderr.on("data", (data) => {
      errorOutput += data.toString();
    });

    child.on("error", (error) => {
      reject(
        new KubectlError(
          `Failed to execute port-forward: ${error.message}`,
          "port_forward",
          "internal",
        ),
      );
    });

    child.on("close", (code) => {
      if (code !== 0) {
        reject(
          new KubectlError(
            `Port-forward process exited with code ${code}. Error: ${errorOutput}`,
            "port_forward",
            "kubectl_failed",
          ),
        );
      }
    });

    // Set a timeout to reject if we don't see the success message.
    setTimeout(() => {
      if (!output.includes("Forwarding from")) {
        reject(
          new KubectlError(
            "port-forwarding failed - no success message received",
            "port_forward",
            "timeout",
          ),
        );
      }
    }, 5000);
  });
}

export async function portForward(deps: Deps, args: PortForwardArgs): Promise<PortForwardResult> {
  const cmdArgs = ["port-forward"];
  if (args.namespace) {
    cmdArgs.push("-n", args.namespace);
  }
  cmdArgs.push(`${args.resourceType}/${args.resourceName}`);
  cmdArgs.push(`${args.localPort}:${args.targetPort}`);

  const result = await executePortForward(cmdArgs);
  const id = `${args.resourceType}-${args.resourceName}-${args.localPort}`;

  deps.client.trackPortForward({
    id,
    server: {
      stop: async () => {
        try {
          process.kill(result.pid);
        } catch (error) {
          console.error(`Failed to stop port-forward process ${result.pid}:`, error);
        }
      },
    },
    resourceType: args.resourceType,
    name: args.resourceName,
    namespace: args.namespace || "default",
    ports: [{ local: args.localPort, remote: args.targetPort }],
  });

  return { success: result.success, message: result.message, id };
}

export async function stopPortForward(
  deps: Deps,
  args: StopPortForwardArgs,
): Promise<StopPortForwardResult> {
  const tracked = deps.client.getPortForward(args.id);
  if (!tracked) {
    throw new KubectlError(
      `Port-forward with id ${args.id} not found`,
      "stop_port_forward",
      "not_found",
    );
  }

  await tracked.server.stop();
  deps.client.removePortForward(args.id);

  return { success: true, message: "port-forward stopped successfully" };
}
