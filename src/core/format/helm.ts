import type {
  InstallHelmResult,
  UninstallHelmResult,
  UpgradeHelmResult,
} from "../operations/helm.js";

export function formatInstallHelmChart(result: InstallHelmResult): string {
  return JSON.stringify(result);
}

export function formatUpgradeHelmChart(result: UpgradeHelmResult): string {
  return JSON.stringify(result);
}

export function formatUninstallHelmChart(result: UninstallHelmResult): string {
  return JSON.stringify(result);
}
