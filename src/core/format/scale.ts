import type { ScaleResult } from "../operations/scale.js";

export function formatScale(result: ScaleResult): string {
  return JSON.stringify({
    success: true,
    message: `Scaled ${result.kind} ${result.name} to ${result.replicas} replicas`,
  });
}
