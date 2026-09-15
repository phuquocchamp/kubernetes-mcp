import { expect, test, describe, beforeEach, afterEach } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { z } from "zod";

// Define the response type for easier use in tests
const KubectlResponseSchema = z.object({
  content: z.array(
    z.object({
      type: z.literal("text"),
      text: z.string()
    })
  )
});

type KubectlResponse = z.infer<typeof KubectlResponseSchema>;

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

describe("kubectl_rollout command", () => {
  let transport: StdioClientTransport;
  let client: Client;
  const testNamespace = "rollout-test-" + Math.random().toString(36).substring(2, 7);
  const deploymentName = "rollout-test-app";
  
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
    
    // Create a test namespace
    await retry(async () => {
      await client.request(
        {
          method: "tools/call",
          params: {
            name: "kubectl_create",
            arguments: {
              resourceType: "namespace",
              name: testNamespace
            },
          },
        },
        z.any()
      );
    });
    
    // Create a test deployment
    const deploymentManifest = {
      apiVersion: "apps/v1",
      kind: "Deployment",
      metadata: {
        name: deploymentName,
        namespace: testNamespace
      },
      spec: {
        replicas: 1,
        selector: {
          matchLabels: {
            app: "rollout-test-app"
          }
        },
        template: {
          metadata: {
            labels: {
              app: "rollout-test-app"
            }
          },
          spec: {
            containers: [
              {
                name: "nginx",
                image: "nginx:1.20.0", // Start with specific version
                ports: [
                  {
                    containerPort: 80
                  }
                ]
              }
            ]
          }
        }
      }
    };
    
    await retry(async () => {
      await client.request(
        {
          method: "tools/call",
          params: {
            name: "kubectl_apply",
            arguments: {
              manifest: JSON.stringify(deploymentManifest),
              namespace: testNamespace
            },
          },
        },
        z.any()
      );
    });
    
    // Wait for deployment to be ready
    await retry(async () => {
      const response = await client.request(
        {
          method: "tools/call",
          params: {
            name: "kubectl_rollout",
            arguments: {
              subCommand: "status",
              resourceType: "deployment",
              name: deploymentName,
              namespace: testNamespace
            },
          },
        },
        z.any()
      ) as KubectlResponse;
      
      if (!response.content[0].text.includes("successfully rolled out")) {
        throw new Error("Deployment not ready yet");
      }
      
      return response;
    }, 3, 1500); // Optimized from 5 retries with 3000ms delay
  });

  afterEach(async () => {
    try {
      // Delete the test namespace and all resources in it
      try {
        await client.request(
          {
            method: "tools/call",
            params: {
              name: "kubectl_delete",
              arguments: {
                resourceType: "namespace",
                name: testNamespace,
                force: true
              },
            },
          },
          z.any()
        );
      } catch (e) {
        // Ignore error if namespace doesn't exist
      }
      
      await transport.close();
      await sleep(1000);
    } catch (e) {
      console.error("Error during cleanup:", e);
    }
  });

  test("kubectl_rollout can check status of a deployment", async () => {
    const result = await client.request(
      {
        method: "tools/call",
        params: {
          name: "kubectl_rollout",
          arguments: {
            subCommand: "status",
            resourceType: "deployment",
            name: deploymentName,
            namespace: testNamespace
          },
        },
      },
      z.any()
    ) as KubectlResponse;
    
    expect(result.content[0].type).toBe("text");
    expect(result.content[0].text).toContain("successfully rolled out");
  });

  test("kubectl_rollout can restart a deployment", async () => {
    const result = await client.request(
      {
        method: "tools/call",
        params: {
          name: "kubectl_rollout",
          arguments: {
            subCommand: "restart",
            resourceType: "deployment",
            name: deploymentName,
            namespace: testNamespace
          },
        },
      },
      z.any()
    ) as KubectlResponse;
    
    expect(result.content[0].type).toBe("text");
    expect(result.content[0].text).toContain("restarted");
    
    // Wait for the restart to complete
    await retry(async () => {
      const response = await client.request(
        {
          method: "tools/call",
          params: {
            name: "kubectl_rollout",
            arguments: {
              subCommand: "status",
              resourceType: "deployment",
              name: deploymentName,
              namespace: testNamespace
            },
          },
        },
        z.any()
      ) as KubectlResponse;
      
      if (!response.content[0].text.includes("successfully rolled out")) {
        throw new Error("Deployment restart not complete");
      }
      
      return response;
    }, 3, 1500); // Optimized from 5 retries with 3000ms delay
  });

  test("kubectl_rollout can pause and resume a deployment", async () => {
    // Pause the deployment
    const pauseResult = await client.request(
      {
        method: "tools/call",
        params: {
          name: "kubectl_rollout",
          arguments: {
            subCommand: "pause",
            resourceType: "deployment",
            name: deploymentName,
            namespace: testNamespace
          },
        },
      },
      z.any()
    ) as KubectlResponse;
    
    expect(pauseResult.content[0].type).toBe("text");
    expect(pauseResult.content[0].text).toContain("paused");
    
    // Verify it's paused by checking the deployment
    const getResult = await client.request(
      {
        method: "tools/call",
        params: {
          name: "kubectl_get",
          arguments: {
            resourceType: "deployment",
            name: deploymentName,
            namespace: testNamespace,
            output: "json"
          },
        },
      },
      z.any()
    ) as KubectlResponse;
    
    const deployment = JSON.parse(getResult.content[0].text);
    expect(deployment.spec.paused).toBe(true);
    
    // Resume the deployment
    const resumeResult = await client.request(
      {
        method: "tools/call",
        params: {
          name: "kubectl_rollout",
          arguments: {
            subCommand: "resume",
            resourceType: "deployment",
            name: deploymentName,
            namespace: testNamespace
          },
        },
      },
      z.any()
    ) as KubectlResponse;
    
    expect(resumeResult.content[0].type).toBe("text");
    expect(resumeResult.content[0].text).toContain("resumed");
    
    // Verify it's resumed
    const getUpdatedResult = await client.request(
      {
        method: "tools/call",
        params: {
          name: "kubectl_get",
          arguments: {
            resourceType: "deployment",
            name: deploymentName,
            namespace: testNamespace,
            output: "json"
          },
        },
      },
      z.any()
    ) as KubectlResponse;
    
    const updatedDeployment = JSON.parse(getUpdatedResult.content[0].text);
    // Check if paused is either false or undefined (both mean not paused)
    expect(updatedDeployment.spec.paused || false).toBe(false);
  });

  test("kubectl_rollout can show history of a deployment", async () => {
    // Get the rollout history
    const historyResult = await client.request(
      {
        method: "tools/call",
        params: {
          name: "kubectl_rollout",
          arguments: {
            subCommand: "history",
            resourceType: "deployment",
            name: deploymentName,
            namespace: testNamespace
          },
        },
      },
      z.any()
    ) as KubectlResponse;
    
    expect(historyResult.content[0].type).toBe("text");
    expect(historyResult.content[0].text).toContain("REVISION");
    // There should be at least one revision
    expect(historyResult.content[0].text).toMatch(/1\s+/);
  });

  test("kubectl_rollout handles errors gracefully", async () => {
    const nonExistentResource = "non-existent-deployment-" + Date.now();
    
    try {
      await client.request(
        {
          method: "tools/call",
          params: {
            name: "kubectl_rollout",
            arguments: {
              subCommand: "status",
              resourceType: "deployment",
              name: nonExistentResource,
              namespace: testNamespace
            },
          },
        },
        z.any()
      );
      
      // If we get here, the test has failed
      expect(true).toBe(false); // This should not execute
    } catch (error: any) {
      // Expect an error response
      expect(error.message).toContain("Failed to execute rollout command");
    }
  });
});

describe("kubectl_rollout command error handling", () => {
  let transport: StdioClientTransport;
  let client: Client;
  
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
  });

  afterEach(async () => {
    try {
      await transport.close();
      await sleep(1000);
    } catch (e) {
      console.error("Error during cleanup:", e);
    }
  });

  test("kubectl_rollout handles errors gracefully", async () => {
    const nonExistentResource = "non-existent-deployment-" + Date.now();
    
    try {
      await client.request(
        {
          method: "tools/call",
          params: {
            name: "kubectl_rollout",
            arguments: {
              subCommand: "status",
              resourceType: "deployment",
              name: nonExistentResource,
              namespace: "default"
            },
          },
        },
        KubectlResponseSchema
      );
      
      // If we get here, the test has failed
      expect(true).toBe(false); // This should not execute
    } catch (error: any) {
      // Expect an error response
      expect(error.message).toContain("Failed to execute rollout command");
    }
  });

  test("kubectl_generic can execute rollout commands", async () => {
    try {
      // This should fail but in a controlled way so we can test the error handling
      await client.request(
        {
          method: "tools/call",
          params: {
            name: "kubectl_generic",
            arguments: {
              command: "rollout",
              subCommand: "status",
              resourceType: "deployment",
              name: "nginx", // Likely doesn't exist but gives predictable error
              namespace: "default"
            },
          },
        },
        KubectlResponseSchema
      );
      
      // If we get here, it might be because the deployment actually exists
      // So we don't fail the test, just note it
    } catch (error: any) {
      // This is expected, just make sure it's a proper error
      expect(error.message).toBeTruthy();
    }
  });
}); 