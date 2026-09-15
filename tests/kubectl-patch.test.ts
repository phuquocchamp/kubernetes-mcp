import { expect, test, describe, beforeEach, afterEach } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { z } from "zod";

// Define the response type for easier use in tests
type KubectlResponse = {
  content: Array<{
    type: "text";
    text: string;
  }>;
};

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Helper function to retry operations that might be flaky
async function retry<T>(
  operation: () => Promise<T>,
  maxRetries: number = 2,
  delayMs: number = 1000
): Promise<T> {
  let lastError: Error | unknown;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      console.warn(
        `Attempt ${attempt}/${maxRetries} failed. Retrying in ${delayMs}ms...`
      );
      await sleep(delayMs);
    }
  }

  throw lastError;
}

describe("kubectl_patch command", () => {
  let transport: StdioClientTransport;
  let client: Client;
  const configMapName = "patch-test-cm-" + Math.random().toString(36).substring(2, 7);

  beforeEach(async () => {
    transport = new StdioClientTransport({
      command: "node",
      args: ["dist/index.js"],
      stderr: "pipe",
    });

    client = new Client(
      {
        name: "test-client",
        version: "1.0.0",
      },
      {
        capabilities: {},
      }
    );

    await client.connect(transport);
    await sleep(1000);
    
    // Create a configmap that we'll patch in the tests
    await retry(async () => {
      await client.request(
        {
          method: "tools/call",
          params: {
            name: "kubectl_create",
            arguments: {
              resourceType: "configmap",
              name: configMapName,
              namespace: "default",
              manifest: JSON.stringify({
                apiVersion: "v1",
                kind: "ConfigMap",
                metadata: {
                  name: configMapName,
                  namespace: "default"
                },
                data: {
                  key1: "value1",
                  key2: "value2"
                }
              })
            },
          },
        },
        z.any()
      );
    });
  });

  afterEach(async () => {
    try {
      // Delete the test configmap
      try {
        await client.request(
          {
            method: "tools/call",
            params: {
              name: "kubectl_delete",
              arguments: {
                resourceType: "configmap",
                name: configMapName,
                namespace: "default"
              },
            },
          },
          z.any()
        );
      } catch (e) {
        // Ignore error if configmap doesn't exist
      }
      
      await transport.close();
      await sleep(2000);
    } catch (e) {
      console.error("Error during cleanup:", e);
    }
  });

  test("kubectl_patch can modify a configmap with strategic patch", async () => {
    // Patch the configmap with strategic merge patch
    const patchResult = await client.request(
      {
        method: "tools/call",
        params: {
          name: "kubectl_patch",
          arguments: {
            resourceType: "configmap",
            name: configMapName,
            namespace: "default",
            patchType: "strategic",
            patchData: {
              data: {
                key1: "updated-value1",
                key3: "value3"
              }
            }
          },
        },
      },
      z.any()
    ) as KubectlResponse;
    
    expect(patchResult.content[0].type).toBe("text");
    expect(patchResult.content[0].text).toContain(`configmap/${configMapName} patched`);
    
    // Verify the configmap was updated
    const getResult = await client.request(
      {
        method: "tools/call",
        params: {
          name: "kubectl_get",
          arguments: {
            resourceType: "configmap",
            name: configMapName,
            namespace: "default",
            output: "json"
          },
        },
      },
      z.any()
    ) as KubectlResponse;
    
    const configMap = JSON.parse(getResult.content[0].text);
    expect(configMap.data.key1).toBe("updated-value1"); // Updated value
    expect(configMap.data.key2).toBe("value2");         // Unchanged value
    expect(configMap.data.key3).toBe("value3");         // New value
  });

  test("kubectl_patch can modify a configmap with merge patch", async () => {
    // Patch the configmap with JSON merge patch
    const patchResult = await client.request(
      {
        method: "tools/call",
        params: {
          name: "kubectl_patch",
          arguments: {
            resourceType: "configmap",
            name: configMapName,
            namespace: "default",
            patchType: "merge",
            patchData: {
              data: {
                key2: null,                 // Remove key2
                key4: "value4"              // Add key4
              }
            }
          },
        },
      },
      z.any()
    ) as KubectlResponse;
    
    expect(patchResult.content[0].type).toBe("text");
    expect(patchResult.content[0].text).toContain(`configmap/${configMapName} patched`);
    
    // Verify the configmap was updated
    const getResult = await client.request(
      {
        method: "tools/call",
        params: {
          name: "kubectl_get",
          arguments: {
            resourceType: "configmap",
            name: configMapName,
            namespace: "default",
            output: "json"
          },
        },
      },
      z.any()
    ) as KubectlResponse;
    
    const configMap = JSON.parse(getResult.content[0].text);
    expect(configMap.data.key1).toBe("value1");    // Unchanged
    expect(configMap.data.key2).toBeUndefined();   // Removed
    expect(configMap.data.key4).toBe("value4");    // Added
  });

  test("kubectl_patch works with dry-run option", async () => {
    // Patch the configmap with dry-run option
    const patchResult = await client.request(
      {
        method: "tools/call",
        params: {
          name: "kubectl_patch",
          arguments: {
            resourceType: "configmap",
            name: configMapName,
            namespace: "default",
            patchType: "strategic",
            patchData: {
              data: {
                key1: "dry-run-value" 
              }
            },
            dryRun: true
          },
        },
      },
      z.any()
    ) as KubectlResponse;
    
    expect(patchResult.content[0].type).toBe("text");
    expect(patchResult.content[0].text).toContain(`configmap/${configMapName} patched`);
    
    // Verify the configmap was NOT updated
    const getResult = await client.request(
      {
        method: "tools/call",
        params: {
          name: "kubectl_get",
          arguments: {
            resourceType: "configmap",
            name: configMapName,
            namespace: "default",
            output: "json"
          },
        },
      },
      z.any()
    ) as KubectlResponse;
    
    const configMap = JSON.parse(getResult.content[0].text);
    expect(configMap.data.key1).toBe("value1");    // Still has original value
  });

  test("kubectl_patch handles errors gracefully", async () => {
    const nonExistentResource = "non-existent-resource-" + Date.now();
    
    try {
      await client.request(
        {
          method: "tools/call",
          params: {
            name: "kubectl_patch",
            arguments: {
              resourceType: "configmap",
              name: nonExistentResource,
              namespace: "default",
              patchData: {
                data: {
                  key1: "value1"
                }
              }
            },
          },
        },
        z.any()
      );
      
      // If we get here, the test has failed
      expect(true).toBe(false); // This should not execute
    } catch (error: any) {
      // Expect an error response
      expect(error.message).toContain("Failed to patch resource");
    }
  });
}); 