/**
 * Secret-masking guard for kubectl_get. Moved verbatim from the old
 * src/tools/kubectl-get.ts during integration — logic unchanged.
 */
import * as yaml from "js-yaml";

/**
 * Determine whether a (already lower-cased) resourceType string references
 * Kubernetes Secrets in any of the syntaxes kubectl accepts. This backs the
 * masking decision, so it must recognize every way a caller could name a
 * Secret without tripping the naive "=== 'secret'" check:
 *   - plain:            "secret", "secrets"
 *   - resource/name:    "secret/my-secret"
 *   - group-qualified:  "secrets.v1.", "secret.example.com/my-secret"
 *   - comma-separated:  "secret,configmap"
 *
 * @param {string} resourceType - The lower-cased resourceType argument.
 * @returns {boolean} True if any referenced resource is a Secret.
 */
export function resourceReferencesSecret(resourceType: string): boolean {
  return resourceType
    .split(",")
    .map((part) => {
      // Drop the "/name" portion of a resource/name reference, then the
      // ".group"/".version" suffix of a group-qualified reference.
      const resource = part.trim().split("/")[0].split(".")[0];
      return resource.toLowerCase();
    })
    .some((resource) => resource === "secret" || resource === "secrets");
}

// Mask the leaf values of a single Secret object's `data` (and write-only
// `stringData`) fields, leaving metadata and every other field intact.
function maskSecretObject(secret: any): any {
  const result: any = {};
  for (const key in secret) {
    if (
      (key === "data" || key === "stringData") &&
      typeof secret[key] === "object" &&
      secret[key] !== null
    ) {
      result[key] = maskAllLeafValues(secret[key]);
    } else {
      result[key] = maskDataValues(secret[key]);
    }
  }
  return result;
}

/**
 * Recursively traverses a parsed kubectl response and masks the `data` values
 * of Kubernetes Secrets only. Masking is scoped by object kind rather than by
 * the presence of a "data" key, so that Secret values are always masked (even
 * inside a mixed `List` returned by e.g. `kubectl get secret,configmap`) while
 * non-Secret resources such as ConfigMaps keep their data.
 *
 * @param {any} obj - The object to traverse. Can be an array, object, or primitive value.
 * @returns {any} A new object with masked values in Secret 'data' sections.
 */
function maskDataValues(obj: any): any {
  if (obj == null) {
    return obj;
  }

  if (Array.isArray(obj)) {
    return obj.map((item) => maskDataValues(item));
  }

  if (typeof obj === "object") {
    const kind = typeof obj.kind === "string" ? obj.kind.toLowerCase() : undefined;

    // A single Secret object.
    if (kind === "secret") {
      return maskSecretObject(obj);
    }

    // A SecretList: every item is a Secret, even when kubectl omits the
    // per-item `kind` field in list output, so mask them unconditionally.
    if (kind === "secretlist" && Array.isArray(obj.items)) {
      return {
        ...obj,
        items: obj.items.map((item: any) => maskSecretObject(item)),
      };
    }

    // Any other object (including a heterogeneous "List"): recurse so nested
    // Secret objects are still masked without touching non-Secret data.
    const result: any = {};
    for (const key in obj) {
      result[key] = maskDataValues(obj[key]);
    }
    return result;
  }

  return obj;
}

/**
 * Recursively masks all leaf values (non-object, non-array values) in an object structure.
 *
 * @param {any} obj - The input object or value to process.
 * @returns {any} A new object or value with all leaf values replaced by a mask.
 */
function maskAllLeafValues(obj: any): any {
  const maskValue = "***";

  if (obj == null) {
    return obj;
  }

  if (Array.isArray(obj)) {
    return obj.map((item) => maskAllLeafValues(item));
  }

  if (typeof obj === "object") {
    const result: any = {};
    for (const key in obj) {
      result[key] = maskAllLeafValues(obj[key]);
    }
    return result;
  }

  // This is a leaf value (string, number, boolean) - mask it
  return maskValue;
}

/**
 * Masks sensitive data in Kubernetes secrets by parsing the raw output and replacing
 * all leaf values in the "data" section with a placeholder value ("***").
 *
 * @param {string} output - The raw output from a `kubectl` command, containing secrets data.
 * @param {string} format - The format of the output, either "json" or "yaml".
 * @returns {string} - The masked output in the same format as the input.
 */
export function maskSecretsData(output: string, format: string): string {
  try {
    if (format === "json") {
      const parsed = JSON.parse(output);
      const masked = maskDataValues(parsed);
      return JSON.stringify(masked, null, 2);
    } else if (format === "yaml") {
      // Parse YAML to JSON, mask, then convert back to YAML
      const parsed = yaml.load(output);
      const masked = maskDataValues(parsed);
      return yaml.dump(masked, {
        indent: 2,
        lineWidth: -1, // Don't wrap lines
        noRefs: true, // Don't use references
      });
    }
  } catch (error) {
    console.error("Failed to parse secrets output for masking:", error);
  }

  return output;
}
