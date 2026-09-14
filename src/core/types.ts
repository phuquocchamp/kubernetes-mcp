/**
 * Shared types for the refactored core layer.
 *
 * `Deps` is what every operation function receives: the async command
 * runners, the live KubernetesManager (kubeconfig, tracked resources,
 * port-forwards, watches, API clients), and the validated config. Operation
 * functions take (deps, args) and return typed data or throw a
 * KubectlError from core/errors.ts — they know nothing about MCP, zod, or
 * tool registration. See docs/REFACTOR-PATTERN.md for the full contract.
 */
import type { KubernetesManager } from "../types.js";
import type { Config } from "./config.js";

export interface RunOpts {
  timeoutMs?: number;
  maxBuffer?: number;
  env?: NodeJS.ProcessEnv;
}

export interface Deps {
  /** Runs `kubectl <args>` through the argv guards, async, returns stdout. Throws KubectlError. */
  kubectl(args: string[], operation: string, opts?: RunOpts): Promise<string>;
  /** Runs `helm <args>` the same way. */
  helm(args: string[], operation: string, opts?: RunOpts): Promise<string>;
  /** The live manager: kubeconfig, API clients, resource/port-forward/watch trackers. */
  client: KubernetesManager;
  config: Config;
}
