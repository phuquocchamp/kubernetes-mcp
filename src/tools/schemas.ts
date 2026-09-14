/**
 * Shared zod field schemas for tool inputs. Used as plain fields in a
 * registerTool inputSchema object (not wrapped in z.object()), matching
 * what the MCP SDK's registerTool expects.
 */
import { z } from "zod";

export const namespaceSchema = z.string().optional().describe('Kubernetes namespace. Defaults to "default".');

export const contextSchema = z
  .string()
  .optional()
  .describe("Kubeconfig context to use. Defaults to the current context.");

export const resourceTypeSchema = z
  .string()
  .min(1)
  .describe("Resource type, e.g. pods, deployments, services, configmaps.");

export const nameSchema = z.string().min(1).describe("Resource name.");

export const optionalNameSchema = z
  .string()
  .optional()
  .describe("Resource name. Omit to operate on/list every resource of this type.");

export const dryRunSchema = z
  .boolean()
  .optional()
  .describe("If true, validate only — do not actually execute the operation.");

export const allNamespacesSchema = z.boolean().optional().describe("If true, operate across all namespaces.");

export const labelSelectorSchema = z.string().optional().describe("Label selector, e.g. 'app=nginx'.");

export const fieldSelectorSchema = z
  .string()
  .optional()
  .describe("Field selector, e.g. 'metadata.name=my-pod'.");
