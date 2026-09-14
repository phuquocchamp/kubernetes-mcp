import { describe, expect, test } from "vitest";
import { maskSecretsData, resourceReferencesSecret } from "../../../core/security/secrets.js";

/**
 * Unit coverage for the secret-masking guard. The pre-refactor
 * tests/kubectl-get-secrets.test.ts only exercised this end-to-end against a
 * live cluster (creating real Secret objects) — it never ran without one, in
 * this environment or otherwise. These test the pure masking logic directly,
 * which is faster and needs no cluster.
 */
describe("resourceReferencesSecret", () => {
  test("recognizes plain forms", () => {
    expect(resourceReferencesSecret("secret")).toBe(true);
    expect(resourceReferencesSecret("secrets")).toBe(true);
  });

  test("recognizes resource/name form", () => {
    expect(resourceReferencesSecret("secret/my-secret")).toBe(true);
  });

  test("recognizes group-qualified forms", () => {
    expect(resourceReferencesSecret("secrets.v1.")).toBe(true);
    expect(resourceReferencesSecret("secret.example.com/my-secret")).toBe(true);
  });

  test("recognizes a Secret inside a comma-separated list", () => {
    expect(resourceReferencesSecret("configmap,secret")).toBe(true);
  });

  test("does not flag non-Secret resource types", () => {
    expect(resourceReferencesSecret("configmap")).toBe(false);
    expect(resourceReferencesSecret("pods")).toBe(false);
    expect(resourceReferencesSecret("configmap,deployment")).toBe(false);
  });
});

describe("maskSecretsData (json)", () => {
  test("masks every leaf of a single Secret's data and stringData", () => {
    const secret = {
      kind: "Secret",
      metadata: { name: "db-creds" },
      data: { password: "cGFzc3dvcmQ=", username: "YWRtaW4=" },
      stringData: { note: "plain text secret" },
    };
    const masked = JSON.parse(maskSecretsData(JSON.stringify(secret), "json"));

    expect(masked.metadata.name).toBe("db-creds");
    expect(masked.data.password).toBe("***");
    expect(masked.data.username).toBe("***");
    expect(masked.stringData.note).toBe("***");
  });

  test("masks every item in a SecretList even without a per-item kind", () => {
    const list = {
      kind: "SecretList",
      items: [
        { metadata: { name: "a" }, data: { k: "v1" } },
        { metadata: { name: "b" }, data: { k: "v2" } },
      ],
    };
    const masked = JSON.parse(maskSecretsData(JSON.stringify(list), "json"));

    expect(masked.items[0].data.k).toBe("***");
    expect(masked.items[1].data.k).toBe("***");
    expect(masked.items[0].metadata.name).toBe("a");
  });

  test("masks a Secret nested inside a heterogeneous List, leaves ConfigMaps alone", () => {
    const mixed = {
      kind: "List",
      items: [
        { kind: "ConfigMap", metadata: { name: "cfg" }, data: { key: "not-secret" } },
        { kind: "Secret", metadata: { name: "sec" }, data: { key: "hidden" } },
      ],
    };
    const masked = JSON.parse(maskSecretsData(JSON.stringify(mixed), "json"));

    expect(masked.items[0].data.key).toBe("not-secret");
    expect(masked.items[1].data.key).toBe("***");
  });

  test("returns the input unchanged if it is not valid JSON", () => {
    const raw = "not json at all";
    expect(maskSecretsData(raw, "json")).toBe(raw);
  });
});

describe("maskSecretsData (yaml)", () => {
  test("masks a Secret's data in YAML output", () => {
    const yaml = [
      "kind: Secret",
      "metadata:",
      "  name: db-creds",
      "data:",
      "  password: cGFzcw==",
    ].join("\n");
    const masked = maskSecretsData(yaml, "yaml");

    expect(masked).toContain("password: '***'");
    expect(masked).not.toContain("cGFzcw==");
    expect(masked).toContain("name: db-creds");
  });
});
