import {
  describe,
  expect,
  it,
} from "vitest";
import { readFile } from "node:fs/promises";

describe("production build configuration", () => {
  it("builds only runtime source into dist", async () => {
    const content = await readFile(
      new URL("../tsconfig.build.json", import.meta.url),
      "utf8",
    );

    const config = JSON.parse(content) as {
      compilerOptions?: {
        noEmit?: boolean;
        outDir?: string;
        rootDir?: string;
      };
      include?: string[];
      exclude?: string[];
    };

    expect(config.compilerOptions).toMatchObject({
      noEmit: false,
      outDir: "dist",
      rootDir: "src",
    });

    expect(config.include).toEqual([
      "src/**/*.ts",
    ]);

    expect(config.exclude).toContain(
      "tests/**/*.ts",
    );
  });

  it("exposes deterministic build and start commands", async () => {
    const content = await readFile(
      new URL("../package.json", import.meta.url),
      "utf8",
    );

    const packageJson = JSON.parse(content) as {
      scripts?: Record<string, string>;
    };

    expect(packageJson.scripts?.build).toBe(
      "tsc -p tsconfig.build.json",
    );

    expect(packageJson.scripts?.start).toBe(
      "node dist/server.js",
    );
  });
});
