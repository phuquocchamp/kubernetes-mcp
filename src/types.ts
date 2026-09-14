// Resource-tracking types (ResourceTracker, PortForwardTracker, WatchTracker)
// consumed by utils/kubernetes-manager.ts.
export * from "./models/resource-models.js";

// Re-export KubernetesManager for backward compatibility
export { KubernetesManager } from "./utils/kubernetes-manager.js";
