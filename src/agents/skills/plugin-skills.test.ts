import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { OpenClawConfig } from "../../config/config.js";
import { createTrackedTempDirs } from "../../test-utils/tracked-temp-dirs.js";
const { collectPluginSkillDirsFromRegistry } = await import("./plugin-skills.js");

const tempDirs = createTrackedTempDirs();

type MockResolvedExtensionRegistry = {
  diagnostics: unknown[];
  extensions: Array<{
    extension: {
      id: string;
      name?: string;
      kind?: string;
      origin?: "workspace" | "bundled" | "global" | "config";
      rootDir?: string;
      manifest: {
        id: string;
        configSchema: Record<string, unknown>;
        skills?: string[];
      };
      staticMetadata: {
        configSchema: Record<string, unknown>;
        package: { entries: string[] };
      };
      contributions: unknown[];
    };
    manifestPath: string;
  }>;
};

function buildRegistry(params: {
  acpxRoot: string;
  helperRoot: string;
}): MockResolvedExtensionRegistry {
  return {
    diagnostics: [],
    extensions: [
      {
        extension: {
          id: "acpx",
          name: "ACPX Runtime",
          manifest: {
            id: "acpx",
            configSchema: {},
            skills: ["./skills"],
          },
          origin: "config",
          rootDir: params.acpxRoot,
          staticMetadata: {
            configSchema: {},
            package: { entries: ["index.ts"] },
          },
          contributions: [],
        },
        manifestPath: path.join(params.acpxRoot, "openclaw.plugin.json"),
      },
      {
        extension: {
          id: "helper",
          name: "Helper",
          manifest: {
            id: "helper",
            configSchema: {},
            skills: ["./skills"],
          },
          origin: "config",
          rootDir: params.helperRoot,
          staticMetadata: {
            configSchema: {},
            package: { entries: ["index.ts"] },
          },
          contributions: [],
        },
        manifestPath: path.join(params.helperRoot, "openclaw.plugin.json"),
      },
    ],
  };
}

function createSinglePluginRegistry(params: {
  pluginRoot: string;
  skills: string[];
}): MockResolvedExtensionRegistry {
  return {
    diagnostics: [],
    extensions: [
      {
        extension: {
          id: "helper",
          name: "Helper",
          manifest: {
            id: "helper",
            configSchema: {},
            skills: params.skills,
          },
          origin: "config",
          rootDir: params.pluginRoot,
          staticMetadata: {
            configSchema: {},
            package: { entries: ["index.ts"] },
          },
          contributions: [],
        },
        manifestPath: path.join(params.pluginRoot, "openclaw.plugin.json"),
      },
    ],
  };
}

async function setupAcpxAndHelperRegistry() {
  const acpxRoot = await tempDirs.make("openclaw-acpx-plugin-");
  const helperRoot = await tempDirs.make("openclaw-helper-plugin-");
  await fs.mkdir(path.join(acpxRoot, "skills"), { recursive: true });
  await fs.mkdir(path.join(helperRoot, "skills"), { recursive: true });
  return { registry: buildRegistry({ acpxRoot, helperRoot }), acpxRoot, helperRoot };
}

async function setupPluginOutsideSkills() {
  const pluginRoot = await tempDirs.make("openclaw-plugin-");
  const outsideDir = await tempDirs.make("openclaw-outside-");
  const outsideSkills = path.join(outsideDir, "skills");
  return { pluginRoot, outsideSkills };
}

afterEach(async () => {
  await tempDirs.cleanup();
});

describe("resolvePluginSkillDirs", () => {
  it.each([
    {
      name: "keeps acpx plugin skills when ACP is enabled",
      acpEnabled: true,
      expectedDirs: ({ acpxRoot, helperRoot }: { acpxRoot: string; helperRoot: string }) => [
        path.resolve(acpxRoot, "skills"),
        path.resolve(helperRoot, "skills"),
      ],
    },
    {
      name: "skips acpx plugin skills when ACP is disabled",
      acpEnabled: false,
      expectedDirs: ({ helperRoot }: { acpxRoot: string; helperRoot: string }) => [
        path.resolve(helperRoot, "skills"),
      ],
    },
  ])("$name", async ({ acpEnabled, expectedDirs }) => {
    const { registry, acpxRoot, helperRoot } = await setupAcpxAndHelperRegistry();

    const dirs = collectPluginSkillDirsFromRegistry({
      registry,
      config: {
        acp: { enabled: acpEnabled },
      } as OpenClawConfig,
    });

    expect(dirs).toEqual(expectedDirs({ acpxRoot, helperRoot }));
  });

  it("rejects plugin skill paths that escape the plugin root", async () => {
    const { pluginRoot, outsideSkills } = await setupPluginOutsideSkills();
    await fs.mkdir(path.join(pluginRoot, "skills"), { recursive: true });
    await fs.mkdir(outsideSkills, { recursive: true });
    const escapePath = path.relative(pluginRoot, outsideSkills);

    const registry = createSinglePluginRegistry({
      pluginRoot,
      skills: ["./skills", escapePath],
    });

    const dirs = collectPluginSkillDirsFromRegistry({
      registry,
      config: {} as OpenClawConfig,
    });

    expect(dirs).toEqual([path.resolve(pluginRoot, "skills")]);
  });

  it("rejects plugin skill symlinks that resolve outside plugin root", async () => {
    const { pluginRoot, outsideSkills } = await setupPluginOutsideSkills();
    const linkPath = path.join(pluginRoot, "skills-link");
    await fs.mkdir(outsideSkills, { recursive: true });
    await fs.symlink(
      outsideSkills,
      linkPath,
      process.platform === "win32" ? ("junction" as const) : ("dir" as const),
    );

    const registry = createSinglePluginRegistry({
      pluginRoot,
      skills: ["./skills-link"],
    });

    const dirs = collectPluginSkillDirsFromRegistry({
      registry,
      config: {} as OpenClawConfig,
    });

    expect(dirs).toEqual([]);
  });
});
