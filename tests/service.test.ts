// This test file is used to test Kubernetes Service functionalities
import { expect, test, describe, beforeEach, afterEach } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { CreateNamespaceResponseSchema } from "../src/types";
import { KubernetesManager } from "../src/types";
import { z } from "zod";
import { asResponseSchema } from "./context-helper";

// Define the proper response schema
const KubectlResponseSchema = z.object({
  content: z.array(
    z.object({
      type: z.literal("text"),
      text: z.string(),
    })
  ),
});

// Define error response schema
const ErrorResponseSchema = z.object({
  content: z.array(
    z.object({
      type: z.literal("text"),
      text: z.string(),
    })
  ),
  isError: z.boolean().optional(),
});

// Interface for service response type
interface ServiceResponse {
  serviceName: string;
  namespace: string;
  type: string;
  clusterIP: string;
  ports: Array<{
    port: number;
    targetPort: number | string;
    protocol: string;
    name: string;
    nodePort?: number;
  }>;
  status: string;
}

// Interface for list services response
interface ListServicesResponse {
  services: Array<{
    name: string;
    namespace: string;
    type: string;
    clusterIP: string;
    ports: Array<any>;
    createdAt: string;
  }>;
}

// Interface for update service response
interface UpdateServiceResponse {
  message: string;
  service: {
    name: string;
    namespace: string;
    type: string;
    clusterIP: string;
    ports: Array<any>;
  };
}

// Interface for delete service response
interface DeleteServiceResponse {
  success: boolean;
  status: string;
}

// Utility function: Sleep for a specified number of milliseconds
async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Utility function: Generate a random ID string
function generateRandomId(): string {
  return Math.random().toString(36).substring(2, 10);
}

// Utility function: Generate a random SHA string for resource naming in tests
function generateRandomSHA(): string {
  return Math.random().toString(36).substring(2, 15);
}

// Utility function: Parse JSON response
function parseServiceResponse(responseText: string): ServiceResponse | null {
  try {
    return JSON.parse(responseText);
  } catch (error) {
    console.error("Failed to parse service response:", error);
    return null;
  }
}

// Utility function: Parse list services response
function parseListServicesResponse(responseText: string): ListServicesResponse | null {
  try {
    return JSON.parse(responseText);
  } catch (error) {
    console.error("Failed to parse list services response:", error);
    return null;
  }
}

// Utility function: Parse update service response
function parseUpdateServiceResponse(responseText: string): UpdateServiceResponse | null {
  try {
    return JSON.parse(responseText);
  } catch (error) {
    console.error("Failed to parse update service response:", error);
    return null;
  }
}

// Utility function: Parse delete service response
function parseDeleteServiceResponse(responseText: string): DeleteServiceResponse | null {
  try {
    return JSON.parse(responseText);
  } catch (error) {
    console.error("Failed to parse delete service response:", error);
    return null;
  }
}

// Test suite: Testing Service functionality
describe("test kubernetes service", () => {
  let transport: StdioClientTransport;
  let client: Client;
  const NAMESPACE_PREFIX = "test-service";
  let testNamespace: string;

  const testServiceName = `test-service-${generateRandomSHA()}`;

  // Setup before each test
  beforeEach(async () => {
    try {
      // Initialize client transport layer, communicating with the service process via stdio
      transport = new StdioClientTransport({
        command: "node",
        args: ["dist/index.js"],
        stderr: "pipe",
      });

      // Create an instance of the MCP client
      client = new Client(
        {
          name: "test-client",
          version: "1.0.0",
        },
        {
          capabilities: {},
        }
      );

      // Connect to the service
      await client.connect(transport);
      // Wait for the connection to be established
      await sleep(1000);

      // Create a unique test namespace to isolate the test environment
      testNamespace = `${NAMESPACE_PREFIX}-${generateRandomId()}`;
      console.log(`Creating test namespace: ${testNamespace}`);

      // Call API to create the namespace using kubectl_create
      await client.request(
        {
          method: "tools/call",
          params: {
            name: "kubectl_create",
            arguments: {
              resourceType: "namespace",
              name: testNamespace,
            },
          },
        },
        asResponseSchema(KubectlResponseSchema)
      );

      // Wait for the namespace to be fully created
      await sleep(2000);
    } catch (error: any) {
      console.error("Error in beforeEach:", error);
      throw error;
    }
  });

  // Cleanup after each test
  afterEach(async () => {
    try {
      // Clean up the test namespace by using kubectl_delete
      console.log(`Cleaning up test namespace: ${testNamespace}`);
      
      await client.request(
        {
          method: "tools/call",
          params: {
            name: "kubectl_delete",
            arguments: {
              resourceType: "namespace",
              name: testNamespace,
            },
          },
        },
        asResponseSchema(KubectlResponseSchema)
      );

      // Close the client connection
      await transport.close();
      await sleep(1000);
    } catch (e) {
      console.error("Error during cleanup:", e);
    }
  });

  // Test case 1: Create ClusterIP service
  test("create ClusterIP service", async () => {
    // Define test data
    const testPorts = [{ port: 80, targetPort: 8080, protocol: "TCP", name: "http" }];
    const testSelector = { app: "test-app", tier: "backend" };
    
    // Create the service manifest
    const serviceManifest = {
      apiVersion: "v1",
      kind: "Service",
      metadata: {
        name: testServiceName,
        namespace: testNamespace,
      },
      spec: {
        selector: testSelector,
        ports: testPorts.map(p => ({
          port: p.port,
          targetPort: p.targetPort,
          protocol: p.protocol,
          name: p.name
        })),
        type: "ClusterIP"
      }
    };
    
    // Create the service using kubectl_create
    const response = await client.request(
      {
        method: "tools/call",
        params: {
          name: "kubectl_create",
          arguments: {
            resourceType: "service",
            name: testServiceName,
            namespace: testNamespace,
            manifest: JSON.stringify(serviceManifest)
          }
        }
      },
      asResponseSchema(KubectlResponseSchema)
    );

    // Verify the service was created successfully
    expect(response.content[0].text).toContain(testServiceName);

    // Wait for service to be created
    await sleep(1000);

    // Get the created service using kubectl_get and verify
    const getResponse = await client.request(
      {
        method: "tools/call",
        params: {
          name: "kubectl_get",
          arguments: {
            resourceType: "service",
            name: testServiceName,
            namespace: testNamespace,
            output: "json",
          },
        },
      },
      asResponseSchema(KubectlResponseSchema)
    );

    const serviceData = JSON.parse(getResponse.content[0].text);
    expect(serviceData.metadata.name).toBe(testServiceName);
    expect(serviceData.metadata.namespace).toBe(testNamespace);
    expect(serviceData.spec.type).toBe("ClusterIP");
    expect(serviceData.spec.ports[0].port).toBe(80);
    expect(serviceData.spec.ports[0].targetPort).toBe(8080);
    expect(serviceData.spec.ports[0].protocol).toBe("TCP");

    // Clean up the created service
    await client.request(
      {
        method: "tools/call",
        params: {
          name: "kubectl_delete",
          arguments: {
            resourceType: "service",
            name: testServiceName,
            namespace: testNamespace,
          },
        },
      },
      asResponseSchema(KubectlResponseSchema)
    );
  }, 30000); // 30 second timeout

  // Test case 2: List services
  test("list services", async () => {
    // Create multiple test services
    const service1Name = `service1-${generateRandomSHA()}`;
    const service2Name = `service2-${generateRandomSHA()}`;
    
    const serviceManifest1 = {
      apiVersion: "v1",
      kind: "Service",
      metadata: {
        name: service1Name,
        namespace: testNamespace,
      },
      spec: {
        selector: { app: "app1" },
        ports: [{ port: 80, targetPort: 8080, protocol: "TCP", name: "http" }],
        type: "ClusterIP"
      }
    };

    const serviceManifest2 = {
      apiVersion: "v1",
      kind: "Service",
      metadata: {
        name: service2Name,
        namespace: testNamespace,
      },
      spec: {
        selector: { app: "app2" },
        ports: [{ port: 81, targetPort: 8181, protocol: "TCP", name: "http" }],
        type: "NodePort"
      }
    };

    // Create both services
    await client.request(
      {
        method: "tools/call",
        params: {
          name: "kubectl_create",
          arguments: {
            resourceType: "service",
            name: service1Name,
            namespace: testNamespace,
            manifest: JSON.stringify(serviceManifest1)
          }
        }
      },
      asResponseSchema(KubectlResponseSchema)
    );

    await client.request(
      {
        method: "tools/call",
        params: {
          name: "kubectl_create",
          arguments: {
            resourceType: "service",
            name: service2Name,
            namespace: testNamespace,
            manifest: JSON.stringify(serviceManifest2)
          }
        }
      },
      asResponseSchema(KubectlResponseSchema)
    );

    // Wait for services to be created
    await sleep(2000);

    // List all services in the namespace
    const listResponse = await client.request(
      {
        method: "tools/call",
        params: {
          name: "kubectl_get",
          arguments: {
            resourceType: "services",
            namespace: testNamespace,
            output: "json",
          },
        },
      },
      asResponseSchema(KubectlResponseSchema)
    );

    const listResponseText = listResponse.content[0].text;
    console.log("Service list response:", listResponseText);
    
    // Parse and verify the response
    let servicesList: any;
    try {
      servicesList = JSON.parse(listResponseText);
    } catch (e) {
      // If it's not JSON, check that both service names are present
      expect(listResponseText).toContain(service1Name);
      expect(listResponseText).toContain(service2Name);
      return;
    }
    
    // Check if it's a Kubernetes API response with items array
    if (servicesList.items) {
      expect(servicesList.items.length).toBeGreaterThanOrEqual(2);
      const serviceNames = servicesList.items.map((item: any) => item.name || item.metadata?.name);
      expect(serviceNames).toContain(service1Name);
      expect(serviceNames).toContain(service2Name);
    } else {
      // If it's a different format, just check that both services are mentioned
      expect(listResponseText).toContain(service1Name);
      expect(listResponseText).toContain(service2Name);
    }

    // Clean up
    await client.request(
      {
        method: "tools/call",
        params: {
          name: "kubectl_delete",
          arguments: {
            resourceType: "service",
            name: service1Name,
            namespace: testNamespace,
          },
        },
      },
      asResponseSchema(KubectlResponseSchema)
    );

    await client.request(
      {
        method: "tools/call",
        params: {
          name: "kubectl_delete",
          arguments: {
            resourceType: "service",
            name: service2Name,
            namespace: testNamespace,
          },
        },
      },
      asResponseSchema(KubectlResponseSchema)
    );
  }, 40000); // 40 second timeout

  // Test case 3: Describe service
  test("describe service", async () => {
    // Create a test service
    const serviceManifest = {
      apiVersion: "v1",
      kind: "Service",
      metadata: {
        name: testServiceName,
        namespace: testNamespace,
        labels: { app: "test-app", version: "v1" }
      },
      spec: {
        selector: { app: "test-app" },
        ports: [{ port: 80, targetPort: 8080, protocol: "TCP", name: "http" }],
        type: "ClusterIP"
      }
    };

    await client.request(
      {
        method: "tools/call",
        params: {
          name: "kubectl_create",
          arguments: {
            resourceType: "service",
            name: testServiceName,
            namespace: testNamespace,
            manifest: JSON.stringify(serviceManifest)
          }
        }
      },
      asResponseSchema(KubectlResponseSchema)
    );

    await sleep(2000);

    // Describe the service
    const describeResponse = await client.request(
      {
        method: "tools/call",
        params: {
          name: "kubectl_describe",
          arguments: {
            resourceType: "service",
            name: testServiceName,
            namespace: testNamespace,
          },
        },
      },
      asResponseSchema(KubectlResponseSchema)
    );

    const describeText = describeResponse.content[0].text;
    console.log("Service describe response:", describeText);

    // Verify the describe output contains expected information
    expect(describeText).toContain(testServiceName);
    expect(describeText).toContain(testNamespace);
    expect(describeText).toContain("ClusterIP");
    expect(describeText).toContain("80/TCP");

    // Clean up
    await client.request(
      {
        method: "tools/call",
        params: {
          name: "kubectl_delete",
          arguments: {
            resourceType: "service",
            name: testServiceName,
            namespace: testNamespace,
          },
        },
      },
      asResponseSchema(KubectlResponseSchema)
    );
  }, 30000); // 30 second timeout

  // Test case 4: Update service
  test("update service", async () => {
    // Create initial service
    const initialManifest = {
      apiVersion: "v1",
      kind: "Service",
      metadata: {
        name: testServiceName,
        namespace: testNamespace,
      },
      spec: {
        selector: { app: "test-app" },
        ports: [{ port: 80, targetPort: 8080, protocol: "TCP", name: "http" }],
        type: "ClusterIP"
      }
    };

    await client.request(
      {
        method: "tools/call",
        params: {
          name: "kubectl_create",
          arguments: {
            resourceType: "service",
            name: testServiceName,
            namespace: testNamespace,
            manifest: JSON.stringify(initialManifest)
          }
        }
      },
      asResponseSchema(KubectlResponseSchema)
    );

    await sleep(2000);

    // Update the service using kubectl_patch
    const patchData = {
      spec: {
        ports: [
          { port: 80, targetPort: 8080, protocol: "TCP", name: "http" },
          { port: 443, targetPort: 8443, protocol: "TCP", name: "https" }
        ]
      }
    };

    const patchResponse = await client.request(
      {
        method: "tools/call",
        params: {
          name: "kubectl_patch",
          arguments: {
            resourceType: "service",
            name: testServiceName,
            namespace: testNamespace,
            patchData: patchData,
            patchType: "merge"
          }
        }
      },
      asResponseSchema(KubectlResponseSchema)
    );

    expect(patchResponse.content[0].text).toContain("patched");

    await sleep(2000);

    // Verify the update
    const getResponse = await client.request(
      {
        method: "tools/call",
        params: {
          name: "kubectl_get",
          arguments: {
            resourceType: "service",
            name: testServiceName,
            namespace: testNamespace,
            output: "json",
          },
        },
      },
      asResponseSchema(KubectlResponseSchema)
    );

    const serviceData = JSON.parse(getResponse.content[0].text);
    expect(serviceData.spec.ports).toHaveLength(2);
    expect(serviceData.spec.ports.some((p: any) => p.port === 443)).toBe(true);

    // Clean up
    await client.request(
      {
        method: "tools/call",
        params: {
          name: "kubectl_delete",
          arguments: {
            resourceType: "service",
            name: testServiceName,
            namespace: testNamespace,
          },
        },
      },
      asResponseSchema(KubectlResponseSchema)
    );
  }, 40000); // 40 second timeout

  // Test case 5: Delete service
  test("delete service", async () => {
    // Create a service to delete
    const serviceManifest = {
      apiVersion: "v1",
      kind: "Service",
      metadata: {
        name: testServiceName,
        namespace: testNamespace,
      },
      spec: {
        selector: { app: "test-app" },
        ports: [{ port: 80, targetPort: 8080, protocol: "TCP", name: "http" }],
        type: "ClusterIP"
      }
    };

    await client.request(
      {
        method: "tools/call",
        params: {
          name: "kubectl_create",
          arguments: {
            resourceType: "service",
            name: testServiceName,
            namespace: testNamespace,
            manifest: JSON.stringify(serviceManifest)
          }
        }
      },
      asResponseSchema(KubectlResponseSchema)
    );

    await sleep(2000);

    // Verify service exists
    const getBeforeResponse = await client.request(
      {
        method: "tools/call",
        params: {
          name: "kubectl_get",
          arguments: {
            resourceType: "service",
            name: testServiceName,
            namespace: testNamespace,
            output: "json",
          },
        },
      },
      asResponseSchema(KubectlResponseSchema)
    );

    const beforeData = JSON.parse(getBeforeResponse.content[0].text);
    expect(beforeData.metadata.name).toBe(testServiceName);

    // Delete the service
    const deleteResponse = await client.request(
      {
        method: "tools/call",
        params: {
          name: "kubectl_delete",
          arguments: {
            resourceType: "service",
            name: testServiceName,
            namespace: testNamespace,
          },
        },
      },
      asResponseSchema(KubectlResponseSchema)
    );

    expect(deleteResponse.content[0].text).toContain(`service "${testServiceName}" deleted`);

    await sleep(2000);

    // Verify service is deleted
    let serviceDeleted = false;
    let getAfterDeleteResponse: any;
    try {
      getAfterDeleteResponse = await client.request(
        {
          method: "tools/call",
          params: {
            name: "kubectl_get",
            arguments: {
              resourceType: "service",
              name: testServiceName,
              namespace: testNamespace,
              output: "json",
            },
          },
        },
        asResponseSchema(KubectlResponseSchema)
      );
      
      // If we get here, check if the response indicates the service doesn't exist
      const responseText = getAfterDeleteResponse.content[0].text;
      if (responseText.includes("not found") || responseText.includes("NotFound")) {
        serviceDeleted = true;
      }
    } catch (e: any) {
      serviceDeleted = true;
      expect(e.message).toContain("not found");
    }

    // If neither exception nor "not found" response, the test should fail
    expect(serviceDeleted).toBe(true);
  }, 35000); // 35 second timeout

  // Test case 6: Create NodePort service
  test("create NodePort service", async () => {
    const nodePortServiceName = `nodeport-service-${generateRandomSHA()}`;
    
    const serviceManifest = {
      apiVersion: "v1",
      kind: "Service",
      metadata: {
        name: nodePortServiceName,
        namespace: testNamespace,
      },
      spec: {
        selector: { app: "nodeport-app" },
        ports: [{ port: 80, targetPort: 8080, protocol: "TCP", name: "http" }],
        type: "NodePort"
      }
    };

    const response = await client.request(
      {
        method: "tools/call",
        params: {
          name: "kubectl_create",
          arguments: {
            resourceType: "service",
            name: nodePortServiceName,
            namespace: testNamespace,
            manifest: JSON.stringify(serviceManifest)
          }
        }
      },
      asResponseSchema(KubectlResponseSchema)
    );

    expect(response.content[0].text).toContain(nodePortServiceName);

    await sleep(2000);

    // Verify the service
    const getResponse = await client.request(
      {
        method: "tools/call",
        params: {
          name: "kubectl_get",
          arguments: {
            resourceType: "service",
            name: nodePortServiceName,
            namespace: testNamespace,
            output: "json",
          },
        },
      },
      asResponseSchema(KubectlResponseSchema)
    );

    const serviceData = JSON.parse(getResponse.content[0].text);
    expect(serviceData.spec.type).toBe("NodePort");
    expect(serviceData.spec.ports[0].nodePort).toBeDefined();
    expect(serviceData.spec.ports[0].nodePort).toBeGreaterThan(30000);

    // Clean up
    await client.request(
      {
        method: "tools/call",
        params: {
          name: "kubectl_delete",
          arguments: {
            resourceType: "service",
            name: nodePortServiceName,
            namespace: testNamespace,
          },
        },
      },
      asResponseSchema(KubectlResponseSchema)
    );
  }, 30000); // 30 second timeout

  // Test case 7: Create LoadBalancer service (SKIPPED - requires cloud provider)
  test("create LoadBalancer service", async () => {
    const lbServiceName = `lb-service-${generateRandomSHA()}`;
    
    const serviceManifest = {
      apiVersion: "v1",
      kind: "Service",
      metadata: {
        name: lbServiceName,
        namespace: testNamespace,
      },
      spec: {
        selector: { app: "lb-app" },
        ports: [{ port: 80, targetPort: 8080, protocol: "TCP", name: "http" }],
        type: "LoadBalancer"
      }
    };

    const response = await client.request(
      {
        method: "tools/call",
        params: {
          name: "kubectl_create",
          arguments: {
            resourceType: "service",
            name: lbServiceName,
            namespace: testNamespace,
            manifest: JSON.stringify(serviceManifest)
          }
        }
      },
      asResponseSchema(KubectlResponseSchema)
    );

    expect(response.content[0].text).toContain(lbServiceName);

    await sleep(2000);

    // Verify the service
    const getResponse = await client.request(
      {
        method: "tools/call",
        params: {
          name: "kubectl_get",
          arguments: {
            resourceType: "service",
            name: lbServiceName,
            namespace: testNamespace,
            output: "json",
          },
        },
      },
      asResponseSchema(KubectlResponseSchema)
    );

    const serviceData = JSON.parse(getResponse.content[0].text);
    expect(serviceData.spec.type).toBe("LoadBalancer");

    // Clean up
    await client.request(
      {
        method: "tools/call",
        params: {
          name: "kubectl_delete",
          arguments: {
            resourceType: "service",
            name: lbServiceName,
            namespace: testNamespace,
          },
        },
      },
      asResponseSchema(KubectlResponseSchema)
    );
  }, 25000); // 25 second timeout

  // Test case 8: Create ClusterIP service with existing name should fail
  test("create ClusterIP service with existing name should fail", async () => {
    // Define test data
    const testPorts = [{ port: 80, targetPort: 8080, protocol: "TCP", name: "http" }];
    const testSelector = { app: "test-app", tier: "backend" };
    
    // Create the service manifest
    const serviceManifest = {
      apiVersion: "v1",
      kind: "Service",
      metadata: {
        name: testServiceName,
        namespace: testNamespace,
      },
      spec: {
        selector: testSelector,
        ports: testPorts.map(p => ({
          port: p.port,
          targetPort: p.targetPort,
          protocol: p.protocol,
          name: p.name
        })),
        type: "ClusterIP"
      }
    };

    await client.request(
      {
        method: "tools/call",
        params: {
          name: "kubectl_create",
          arguments: {
            resourceType: "service",
            name: testServiceName,
            namespace: testNamespace,
            manifest: JSON.stringify(serviceManifest)
          }
        }
      },
      asResponseSchema(KubectlResponseSchema)
    );

    // Wait for the first service to be created
    await sleep(1000);

    // Attempt to create a second service with the same name
    const serviceManifest2 = {
      apiVersion: "v1",
      kind: "Service",
      metadata: {
        name: testServiceName,
        namespace: testNamespace,
      },
      spec: {
        selector: { app: "another-app" },
        ports: [{ port: 81, targetPort: 8181, protocol: "TCP", name: "http" }],
        type: "ClusterIP"
      }
    };

    let errorOccurred = false;
    let errorMessage = "";
    try {
      await client.request(
        {
          method: "tools/call",
          params: {
            name: "kubectl_create",
            arguments: {
              resourceType: "service",
              name: testServiceName,
              manifest: JSON.stringify(serviceManifest2),
              namespace: testNamespace,
            }
          }
        },
        asResponseSchema(KubectlResponseSchema)
      );
    } catch (e: any) {
      errorOccurred = true;
      errorMessage = e.message;
    }
    
    expect(errorOccurred).toBe(true);
    expect(errorMessage).toContain("already exists");

    // Clean up the created service
    await client.request(
      {
        method: "tools/call",
        params: {
          name: "kubectl_delete",
          arguments: {
            resourceType: "service",
            name: testServiceName,
            namespace: testNamespace,
          },
        },
      },
      asResponseSchema(KubectlResponseSchema)
    );
  }, 30000); // 30 second timeout

  // Test case 9: Delete non-existent service should return not_found status
  test("delete non-existent service should return not_found status", async () => {
    const nonExistentServiceName = `non-existent-service-${generateRandomSHA()}`;

    // Attempt to delete a non-existent service
    let deleteResponse: any;
    let errorOccurred = false;
    
    try {
      deleteResponse = await client.request(
        {
          method: "tools/call",
          params: {
            name: "kubectl_delete",
            arguments: {
              resourceType: "service",
              name: nonExistentServiceName,
              namespace: testNamespace,
            },
          },
        },
        asResponseSchema(KubectlResponseSchema)
      );
    } catch (e: any) {
      errorOccurred = true;
      // Check if the error message contains not found information
      expect(e.message).toContain("not found");
    }

    // If no exception was thrown, check if it's an error response
    if (!errorOccurred && deleteResponse) {
      // Check if the response indicates not found
      const responseText = deleteResponse.content[0].text;
      expect(responseText).toContain("not found");
    }
  }, 15000); // 15 second timeout

  // Test case 10: kubectl_get service with output 'name' returns resource name
  test("kubectl_get service with output 'name' returns resource name", async () => {
    // Define test data
    const testPorts = [{ port: 80, targetPort: 8080, protocol: "TCP", name: "http" }];
    const testSelector = { app: "test-app-name", tier: "backend" };

    // Create the service
    const serviceName = `service-name-test-${generateRandomSHA()}`;
    const serviceManifest = {
      apiVersion: "v1",
      kind: "Service",
      metadata: {
        name: serviceName,
        namespace: testNamespace,
      },
      spec: {
        selector: testSelector,
        ports: testPorts.map(p => ({
          port: p.port,
          targetPort: p.targetPort,
          protocol: p.protocol,
          name: p.name
        })),
        type: "ClusterIP"
      }
    };

    await client.request(
      {
        method: "tools/call",
        params: {
          name: "kubectl_create",
          arguments: {
            resourceType: "service",
            name: serviceName,
            namespace: testNamespace,
            manifest: JSON.stringify(serviceManifest)
          }
        }
      },
      asResponseSchema(KubectlResponseSchema)
    );

    await sleep(1000);

    // Use kubectl_get with output 'name'
    const response = await client.request(
      {
        method: "tools/call",
        params: {
          name: "kubectl_get",
          arguments: {
            resourceType: "service",
            name: serviceName,
            namespace: testNamespace,
            output: "name",
          },
        },
      },
      asResponseSchema(KubectlResponseSchema)
    );

    // The output format for 'name' should be just 'service/serviceName'
    expect(response.content[0].text.trim()).toBe(`service/${serviceName}`);

    // Cleanup
    await client.request(
      {
        method: "tools/call",
        params: {
          name: "kubectl_delete",
          arguments: {
            resourceType: "service",
            name: serviceName,
            namespace: testNamespace,
          },
        },
      },
      asResponseSchema(KubectlResponseSchema)
    );
    await sleep(1000);
  }, 20000); // 20 second timeout
});