/**
 * kubectl_create — ported from src/tools/kubectl-create.ts.
 *
 * Preserves the original behavior verbatim, including its two existing
 * quirks (see docs/REFACTOR-PATTERN.md contract: "don't invent new
 * behavior"):
 *   - the resource-type switch matches case-insensitively
 *     (`resourceType?.toLowerCase()`), but the `-n <namespace>` push below
 *     it compares case-sensitively against `"namespace"` — so
 *     `resourceType: "Namespace"` both creates a namespace AND gets `-n`
 *     appended, and a manifest/filename-based create (resourceType
 *     undefined) also gets `-n`.
 *   - labels are pushed as `-l <label>`, which is kubectl's selector flag,
 *     not a label-apply flag.
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { getSpawnMaxBuffer } from "../../config/max-buffer.js";
import { isRemoteTransport } from "../../security/transport.js";
import { KubectlError } from "../errors.js";
import type { Deps } from "../types.js";

export interface CreateArgs {
  // General options
  dryRun?: boolean;
  output?: string;
  validate?: boolean;

  // Create from file
  manifest?: string;
  filename?: string;

  // Resource type and common parameters
  resourceType?: string;
  name?: string;
  namespace?: string;

  // ConfigMap specific
  fromLiteral?: string[];
  fromFile?: string[];
  fromFileContent?: { key: string; content: string }[];

  // Secret specific
  secretType?: "generic" | "docker-registry" | "tls";

  // Service specific
  serviceType?: "clusterip" | "nodeport" | "loadbalancer" | "externalname";
  tcpPort?: string[];

  // Deployment specific
  image?: string;
  replicas?: number;
  port?: number;

  // Job specific
  command?: string[];

  // Additional common parameters
  labels?: string[];
  annotations?: string[];
  schedule?: string;
  suspend?: boolean;
  context?: string;
}

export interface CreateResult {
  /** Raw kubectl stdout (yaml by default, or whatever `output` requested). */
  raw: string;
}

const OPERATION = "kubectl_create";

function invalidInput(message: string): KubectlError {
  return new KubectlError(message, OPERATION, "invalid_input");
}

export async function create(deps: Deps, input: CreateArgs): Promise<CreateResult> {
  // Check if we have enough information to proceed
  if (!input.manifest && !input.filename && !input.resourceType) {
    throw invalidInput("Either manifest, filename, or resourceType must be provided");
  }

  // If resourceType is provided, check if name is provided for most resource types
  if (input.resourceType && !input.name && input.resourceType !== "namespace") {
    throw invalidInput(`Name is required when creating a ${input.resourceType}`);
  }

  // Reject server-side filesystem reads on remote transports. Over SSE /
  // Streamable HTTP the path resolves on the MCP server host, not the
  // client, so `filename` (-f) and `fromFile` (--from-file) would let any
  // client that can reach the endpoint read arbitrary server files
  // (kubeconfig, service-account token, /proc/self/environ, etc.). See
  // GHSA-m67f-jxm9-cvx8. Clients on these transports must pass content
  // inline via `manifest` or `fromFileContent` instead.
  if (isRemoteTransport()) {
    if (input.filename) {
      throw invalidInput(
        "The 'filename' parameter reads a file from the MCP server's filesystem and is disabled on remote (SSE/Streamable HTTP) transports. Pass the file contents via 'manifest' instead.",
      );
    }
    if (input.fromFile && input.fromFile.length > 0) {
      throw invalidInput(
        "The 'fromFile' parameter reads files from the MCP server's filesystem and is disabled on remote (SSE/Streamable HTTP) transports. Pass the file contents via 'fromFileContent' instead.",
      );
    }
  }

  // Set up common parameters
  const namespace = input.namespace || "default";
  const dryRun = input.dryRun || false;
  const validate = input.validate ?? true;
  const output = input.output || "yaml";
  const context = input.context || "";

  const args: string[] = ["create"];
  const tempFiles: string[] = [];

  // Write client-provided content to a private temp file and return its
  // path. The file is tracked for cleanup after kubectl runs.
  const writeTempFile = (contents: string, label: string, ext = ""): string => {
    const tmpDir = os.tmpdir();
    const tempFile = path.join(tmpDir, `create-${label}-${Date.now()}-${tempFiles.length}${ext}`);
    fs.writeFileSync(tempFile, contents, { mode: 0o600 });
    tempFiles.push(tempFile);
    return tempFile;
  };

  // Emit `--from-file=<key>=<tempfile>` args for inline content supplied by
  // the client. Each entry's content is written to a server-side temp file
  // (never a client-controlled path), so this is safe on all transports.
  const pushFromFileContent = (entries: { key: string; content: string }[]) => {
    entries.forEach((entry) => {
      if (!entry.key) {
        throw invalidInput("Each fromFileContent entry requires a non-empty 'key'");
      }
      const tempFile = writeTempFile(entry.content ?? "", "fromfile");
      args.push(`--from-file=${entry.key}=${tempFile}`);
    });
  };

  // Process manifest content if provided (file-based creation)
  if (input.manifest || input.filename) {
    if (input.manifest) {
      // Create temporary file for the manifest
      args.push("-f", writeTempFile(input.manifest, "manifest", ".yaml"));
    } else if (input.filename) {
      args.push("-f", input.filename);
    }
  } else {
    // Process subcommand-based creation
    switch (input.resourceType?.toLowerCase()) {
      case "namespace":
        args.push("namespace", input.name!);
        break;

      case "configmap":
        args.push("configmap", input.name!);

        // Add --from-literal arguments
        if (input.fromLiteral && input.fromLiteral.length > 0) {
          input.fromLiteral.forEach((literal) => {
            args.push(`--from-literal=${literal}`);
          });
        }

        // Add --from-file arguments (server-side paths; blocked on remote
        // transports by the guard above)
        if (input.fromFile && input.fromFile.length > 0) {
          input.fromFile.forEach((file) => {
            args.push(`--from-file=${file}`);
          });
        }

        // Add inline file contents (safe on all transports)
        if (input.fromFileContent && input.fromFileContent.length > 0) {
          pushFromFileContent(input.fromFileContent);
        }
        break;

      case "secret":
        if (!input.secretType) {
          throw invalidInput("secretType is required when creating a secret");
        }

        args.push("secret", input.secretType, input.name!);

        // Add --from-literal arguments
        if (input.fromLiteral && input.fromLiteral.length > 0) {
          input.fromLiteral.forEach((literal) => {
            args.push(`--from-literal=${literal}`);
          });
        }

        // Add --from-file arguments (server-side paths; blocked on remote
        // transports by the guard above)
        if (input.fromFile && input.fromFile.length > 0) {
          input.fromFile.forEach((file) => {
            args.push(`--from-file=${file}`);
          });
        }

        // Add inline file contents (safe on all transports)
        if (input.fromFileContent && input.fromFileContent.length > 0) {
          pushFromFileContent(input.fromFileContent);
        }
        break;

      case "service": {
        const serviceType = input.serviceType ?? "clusterip";

        args.push("service", serviceType, input.name!);

        // Add --tcp arguments for ports
        if (input.tcpPort && input.tcpPort.length > 0) {
          input.tcpPort.forEach((port) => {
            args.push(`--tcp=${port}`);
          });
        }
        break;
      }

      case "cronjob":
        if (!input.image) {
          throw invalidInput("image is required when creating a cronjob");
        }

        if (!input.schedule) {
          throw invalidInput("schedule is required when creating a cronjob");
        }

        args.push("cronjob", input.name!, `--image=${input.image}`, `--schedule=${input.schedule}`);

        // Add command if specified
        if (input.command && input.command.length > 0) {
          args.push("--", ...input.command);
        }

        // Add suspend flag if specified
        if (input.suspend === true) {
          args.push(`--suspend`);
        }
        break;

      case "deployment":
        if (!input.image) {
          throw invalidInput("image is required when creating a deployment");
        }

        args.push("deployment", input.name!, `--image=${input.image}`);

        // Add replicas if specified
        if (input.replicas) {
          args.push(`--replicas=${input.replicas}`);
        }

        // Add port if specified
        if (input.port) {
          args.push(`--port=${input.port}`);
        }
        break;

      case "job":
        if (!input.image) {
          throw invalidInput("image is required when creating a job");
        }

        args.push("job", input.name!, `--image=${input.image}`);

        // Add command if specified
        if (input.command && input.command.length > 0) {
          args.push("--", ...input.command);
        }
        break;

      default:
        throw invalidInput(`Unsupported resource type: ${input.resourceType}`);
    }
  }

  // Add namespace if not creating a namespace itself
  if (input.resourceType !== "namespace") {
    args.push("-n", namespace);
  }

  // Add labels if specified
  if (input.labels && input.labels.length > 0) {
    input.labels.forEach((label) => {
      args.push("-l", label);
    });
  }

  // Add annotations if specified
  if (input.annotations && input.annotations.length > 0) {
    input.annotations.forEach((annotation) => {
      args.push(`--annotation=${annotation}`);
    });
  }

  // Add dry-run flag if requested
  if (dryRun) {
    args.push("--dry-run=client");
  }

  // Add validate flag if needed
  if (!validate) {
    args.push("--validate=false");
  }

  // Add output format
  args.push("-o", output);

  // Add context if provided
  if (context) {
    args.push("--context", context);
  }

  // Remove any temp files created for inline content.
  const cleanupTempFiles = () => {
    tempFiles.forEach((tempFile) => {
      try {
        fs.unlinkSync(tempFile);
      } catch (err) {
        console.error(`Failed to delete temporary file ${tempFile}: ${err}`);
      }
    });
  };

  try {
    const raw = await deps.kubectl(args, OPERATION, { maxBuffer: getSpawnMaxBuffer() });
    return { raw };
  } finally {
    cleanupTempFiles();
  }
}
