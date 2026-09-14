import { McpError } from "@modelcontextprotocol/sdk/types.js";
import { beforeEach, describe, expect, test, vi } from "vitest";
import {
  installHelmChart,
  uninstallHelmChart,
  upgradeHelmChart,
} from "../../../core/operations/helm.js";
import type { Deps } from "../../../core/types.js";

function fakeDeps(): Deps {
  return {
    kubectl: vi.fn(async () => ""),
    helm: vi.fn(async () => ""),
    client: {} as Deps["client"],
    config: {} as Deps["config"],
  };
}

describe("installHelmChart", () => {
  let deps: Deps;

  beforeEach(() => {
    deps = fakeDeps();
  });

  test("builds standard install argv with --create-namespace by default", async () => {
    const result = await installHelmChart(deps, {
      name: "my-release",
      chart: "bitnami/nginx",
      namespace: "web",
    });

    expect(deps.helm).toHaveBeenCalledWith(
      ["install", "my-release", "bitnami/nginx", "--namespace", "web", "--create-namespace"],
      "install_helm_chart",
      expect.objectContaining({ timeoutMs: 300_000 }),
    );
    expect(result).toEqual({
      status: "installed",
      message: "Helm chart 'my-release' installed successfully in namespace 'web'",
    });
  });

  test("defaults namespace to 'default' and omits --create-namespace when disabled", async () => {
    await installHelmChart(deps, {
      name: "my-release",
      chart: "bitnami/nginx",
      createNamespace: false,
    });

    expect(deps.helm).toHaveBeenCalledWith(
      ["install", "my-release", "bitnami/nginx", "--namespace", "default"],
      "install_helm_chart",
      expect.any(Object),
    );
  });

  test("adds the helm repo before installing when repo is given", async () => {
    await installHelmChart(deps, {
      name: "my-release",
      chart: "bitnami/nginx",
      namespace: "web",
      repo: "https://charts.bitnami.com/bitnami",
    });

    expect(deps.helm).toHaveBeenNthCalledWith(
      1,
      ["repo", "add", "bitnami", "https://charts.bitnami.com/bitnami"],
      "install_helm_chart",
      expect.any(Object),
    );
    expect(deps.helm).toHaveBeenNthCalledWith(
      2,
      ["repo", "update"],
      "install_helm_chart",
      expect.any(Object),
    );
    expect(deps.helm).toHaveBeenNthCalledWith(
      3,
      ["install", "my-release", "bitnami/nginx", "--namespace", "web", "--create-namespace"],
      "install_helm_chart",
      expect.any(Object),
    );
  });

  test("uses template mode (helm template | kubectl apply) when useTemplate is set", async () => {
    (deps.helm as ReturnType<typeof vi.fn>).mockResolvedValueOnce("apiVersion: v1\nkind: Pod\n");

    const result = await installHelmChart(deps, {
      name: "my-release",
      chart: "./charts/mychart",
      namespace: "web",
      useTemplate: true,
    });

    expect(deps.kubectl).toHaveBeenNthCalledWith(
      1,
      ["create", "namespace", "web"],
      "install_helm_chart",
    );
    expect(deps.helm).toHaveBeenCalledWith(
      ["template", "my-release", "./charts/mychart", "--namespace", "web"],
      "install_helm_chart",
      expect.any(Object),
    );
    expect(deps.kubectl).toHaveBeenNthCalledWith(
      2,
      ["apply", "-f", expect.stringMatching(/helm-template-.*\.yaml$/)],
      "install_helm_chart",
    );
    expect(result.status).toBe("installed");
    expect(result.steps).toEqual(
      expect.arrayContaining([
        "Generating YAML using helm template",
        "Applying YAML using kubectl",
      ]),
    );
  });

  test("template mode tolerates namespace already existing", async () => {
    (deps.kubectl as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error('namespaces "web" already exists'),
    );

    const result = await installHelmChart(deps, {
      name: "my-release",
      chart: "./charts/mychart",
      namespace: "web",
      useTemplate: true,
    });

    expect(result.status).toBe("installed");
    expect(result.steps).toEqual(
      expect.arrayContaining(["Namespace web already exists or could not be created"]),
    );
  });

  test("rejects a flag-shaped release name before spawning helm", async () => {
    await expect(
      installHelmChart(deps, {
        name: "--post-renderer=/tmp/payload.sh",
        chart: "bitnami/nginx",
        namespace: "web",
      }),
    ).rejects.toThrow(McpError);
    expect(deps.helm).not.toHaveBeenCalled();
    expect(deps.kubectl).not.toHaveBeenCalled();
  });

  test("rejects a flag-shaped chart, namespace and repo", async () => {
    await expect(
      installHelmChart(deps, { name: "my-release", chart: "--evil", namespace: "web" }),
    ).rejects.toThrow(/chart/);
    await expect(
      installHelmChart(deps, { name: "my-release", chart: "bitnami/nginx", namespace: "--evil" }),
    ).rejects.toThrow(/namespace/);
    await expect(
      installHelmChart(deps, {
        name: "my-release",
        chart: "bitnami/nginx",
        namespace: "web",
        repo: "--evil",
      }),
    ).rejects.toThrow(/repo/);
  });
});

describe("upgradeHelmChart", () => {
  let deps: Deps;

  beforeEach(() => {
    deps = fakeDeps();
  });

  test("builds upgrade argv with a values file", async () => {
    const result = await upgradeHelmChart(deps, {
      name: "my-release",
      chart: "bitnami/nginx",
      namespace: "web",
      valuesFile: "/home/user/values.yaml",
    });

    expect(deps.helm).toHaveBeenCalledWith(
      [
        "upgrade",
        "my-release",
        "bitnami/nginx",
        "--namespace",
        "web",
        "-f",
        "/home/user/values.yaml",
      ],
      "upgrade_helm_chart",
      expect.any(Object),
    );
    expect(result).toEqual({
      status: "upgraded",
      message: "Helm chart 'my-release' upgraded successfully in namespace 'web'",
    });
  });

  test("rejects a flag-shaped release name", async () => {
    await expect(
      upgradeHelmChart(deps, { name: "--evil", chart: "bitnami/nginx", namespace: "web" }),
    ).rejects.toThrow(McpError);
    expect(deps.helm).not.toHaveBeenCalled();
  });
});

describe("uninstallHelmChart", () => {
  let deps: Deps;

  beforeEach(() => {
    deps = fakeDeps();
  });

  test("builds uninstall argv, defaulting namespace to 'default'", async () => {
    const result = await uninstallHelmChart(deps, { name: "my-release" });

    expect(deps.helm).toHaveBeenCalledWith(
      ["uninstall", "my-release", "--namespace", "default"],
      "uninstall_helm_chart",
      expect.objectContaining({ timeoutMs: 300_000 }),
    );
    expect(result).toEqual({
      status: "uninstalled",
      message: "Helm chart 'my-release' uninstalled successfully from namespace 'default'",
    });
  });

  test("rejects a flag-shaped release name or namespace", async () => {
    await expect(uninstallHelmChart(deps, { name: "--evil", namespace: "web" })).rejects.toThrow(
      McpError,
    );
    await expect(
      uninstallHelmChart(deps, { name: "my-release", namespace: "--evil" }),
    ).rejects.toThrow(McpError);
    expect(deps.helm).not.toHaveBeenCalled();
  });
});
