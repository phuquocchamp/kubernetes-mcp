/**
 * Centralized error classification for kubectl/helm failures.
 *
 * Every operation throws a KubectlError built by normalizeError() rather
 * than forwarding a raw thrown error's message verbatim. stderr is scanned
 * for a small set of known-safe patterns (NotFound, Forbidden, connection
 * refused, invalid input); anything else falls back to a generic message
 * naming the operation, never the raw stderr text — a kubeconfig parse
 * failure or an exec-credential-plugin error can contain a bearer token or
 * a server URL with embedded credentials, and nothing here should risk
 * surfacing that in an agent transcript (mirrors jenkins-mcp's
 * normalizeError, adapted for exec errors instead of HTTP responses).
 */

export type ErrorCode =
  | "not_found"
  | "forbidden"
  | "unreachable"
  | "timeout"
  | "invalid_input"
  | "kubectl_failed"
  | "internal";

export class KubectlError extends Error {
  readonly code: ErrorCode;
  readonly operation: string;
  readonly tryHint?: string;
  /**
   * Raw stdout/stderr the failed command produced, and its numeric exit
   * code — present only when the command actually ran and exited non-zero
   * (as opposed to a spawn/connection/timeout failure, which has none of
   * these). Most callers ignore them and use `message`; a caller like
   * exec_in_pod, where a non-zero exit is a normal outcome carrying useful
   * partial output rather than an internal failure, reads them directly
   * instead of discarding the command's output.
   */
  readonly stdout?: string;
  readonly stderr?: string;
  readonly exitCode?: number;

  constructor(
    message: string,
    operation: string,
    code: ErrorCode,
    tryHint?: string,
    stdout?: string,
    stderr?: string,
    exitCode?: number,
  ) {
    super(message);
    this.name = "KubectlError";
    this.operation = operation;
    this.code = code;
    this.tryHint = tryHint;
    this.stdout = stdout;
    this.stderr = stderr;
    this.exitCode = exitCode;
  }
}

interface ExecError {
  code?: string | number;
  killed?: boolean;
  signal?: string | null;
  stdout?: string | Buffer;
  stderr?: string | Buffer;
}

function isExecError(err: unknown): err is ExecError {
  return (
    typeof err === "object" && err !== null && ("stderr" in err || "code" in err || "killed" in err)
  );
}

/** First non-empty line of stderr, so the message stays short and scannable. */
function firstLine(text: string): string {
  return (
    text
      .split("\n")
      .find((line) => line.trim().length > 0)
      ?.trim() ?? ""
  );
}

function classify(stderr: string): { code: ErrorCode; safe: boolean } {
  if (/\bnotfound\b/i.test(stderr) || /\(NotFound\)/.test(stderr)) {
    return { code: "not_found", safe: true };
  }
  if (/\bforbidden\b/i.test(stderr) || /\(Forbidden\)/.test(stderr)) {
    return { code: "forbidden", safe: true };
  }
  if (/connection refused|no such host|dial tcp|unable to connect|EOF/i.test(stderr)) {
    return { code: "unreachable", safe: true };
  }
  if (/error validating|unknown field|invalid|unrecognized/i.test(stderr)) {
    return { code: "invalid_input", safe: true };
  }
  return { code: "kubectl_failed", safe: false };
}

/**
 * Maps a thrown exec error (or anything else) to a KubectlError.
 *
 * `operation` is a short caller-supplied label, e.g. "kubectl_get" or
 * "helm_install" — used in the message, never the argv or raw stderr when
 * the stderr didn't match a known-safe pattern.
 */
export function normalizeError(err: unknown, operation: string): KubectlError {
  if (isExecError(err)) {
    if (err.killed || err.signal === "SIGTERM" || err.code === "ETIMEDOUT") {
      return new KubectlError(
        `Timed out running "${operation}". The cluster may be slow or unreachable — ` +
          "raise the timeout, or narrow the request.",
        operation,
        "timeout",
      );
    }

    const stdoutText = Buffer.isBuffer(err.stdout)
      ? err.stdout.toString("utf8")
      : (err.stdout ?? "");
    const stderrText = Buffer.isBuffer(err.stderr)
      ? err.stderr.toString("utf8")
      : (err.stderr ?? "");
    // A numeric `code` here is the exited process's exit status — a
    // spawn-level failure (command not found, permission denied to exec at
    // all) has a string code like "ENOENT" instead, so this only fires for
    // a command that actually ran to completion.
    const exitCode = typeof err.code === "number" ? err.code : undefined;

    if (stderrText || exitCode !== undefined) {
      const { code, safe } = classify(stderrText);
      const line = firstLine(stderrText);
      const message =
        safe && line
          ? `"${operation}" failed: ${line}`
          : `"${operation}" failed (kubectl/helm reported an error). Check the resource, ` +
            "namespace and context are correct, and that you have permission.";
      return new KubectlError(
        message,
        operation,
        code,
        undefined,
        stdoutText || undefined,
        stderrText || undefined,
        exitCode,
      );
    }
  }

  return new KubectlError(
    `Could not run "${operation}". Check that kubectl/helm is installed and the cluster is reachable.`,
    operation,
    "unreachable",
  );
}
