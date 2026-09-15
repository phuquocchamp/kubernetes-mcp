import { describe, expect, it } from "vitest";
import { validateConfig } from "../../core/config.js";

describe("validateConfig — ALLOWED_NAMESPACES", () => {
  it("defaults to null (no restriction) when unset", () => {
    const result = validateConfig({});
    expect(result.success).toBe(true);
    expect(result.data?.allowedNamespaces).toBeNull();
  });

  it("parses a comma-separated list, trimming whitespace", () => {
    const result = validateConfig({ ALLOWED_NAMESPACES: "staging, prod ,default" });
    expect(result.success).toBe(true);
    expect(result.data?.allowedNamespaces).toEqual(["staging", "prod", "default"]);
  });

  it("drops empty entries from a trailing/double comma", () => {
    const result = validateConfig({ ALLOWED_NAMESPACES: "staging,,prod," });
    expect(result.success).toBe(true);
    expect(result.data?.allowedNamespaces).toEqual(["staging", "prod"]);
  });

  it("treats an empty string the same as unset", () => {
    const result = validateConfig({ ALLOWED_NAMESPACES: "" });
    expect(result.success).toBe(true);
    expect(result.data?.allowedNamespaces).toBeNull();
  });
});
