/**
 * Async kubectl/helm runner — the single spawn point for the converted
 * operations in core/operations/*.ts.
 *
 * Every call goes through the same argv guards the legacy
 * execFileSyncSafe() used (assertSafeArgv always; assertNoRemoteFileReads
 * when running over a remote transport), then execFile ASYNCHRONOUSLY so a
 * slow kubectl/helm invocation never blocks the event loop or stalls other
 * concurrent tool calls on the HTTP transport (S5 in the analysis).
 * Failures are normalized through core/errors.ts — callers never see a raw
 * thrown error or its message.
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { isRemoteTransport } from "../security/transport.js";
import { normalizeError } from "./errors.js";
import { assertNoRemoteFileReads, assertSafeArgv } from "./security/argv.js";
import type { RunOpts } from "./types.js";

const execFileAsync = promisify(execFile);

const DEFAULT_TIMEOUT_MS = 60_000;
const DEFAULT_MAX_BUFFER = 10 * 1024 * 1024;

async function run(command: string, args: string[], operation: string, opts: RunOpts = {}): Promise<string> {
  assertSafeArgv(args);
  if (isRemoteTransport()) assertNoRemoteFileReads(args);

  try {
    const { stdout } = await execFileAsync(command, args, {
      encoding: "utf8",
      timeout: opts.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      maxBuffer: opts.maxBuffer ?? DEFAULT_MAX_BUFFER,
      env: opts.env ?? { ...process.env, KUBECONFIG: process.env.KUBECONFIG },
    });
    return stdout;
  } catch (err) {
    throw normalizeError(err, operation);
  }
}

/** Runs kubectl. `operation` is a short label (e.g. "kubectl_get") used only in error messages. */
export function runKubectl(args: string[], operation: string, opts?: RunOpts): Promise<string> {
  return run("kubectl", args, operation, opts);
}

/** Runs helm, same contract as runKubectl. */
export function runHelm(args: string[], operation: string, opts?: RunOpts): Promise<string> {
  return run("helm", args, operation, opts);
}
