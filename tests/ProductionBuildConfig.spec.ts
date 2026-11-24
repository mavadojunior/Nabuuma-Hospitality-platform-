import {
  describe,
  expect,
  it,
} from "vitest";
import { readFile } from "node:fs/promises";

describe("release migration gate", () => {
  it("enforces the complete canonical migration lineage", async () => {
    const workflow = await readFile(
      new URL(
        "../.github/workflows/release-gate.yml",
        import.meta.url,
      ),
      "utf8",
    );

    expect(workflow).toContain(
      "migration_count=",
    );

    expect(workflow).toContain(
      'test "$expected" -eq "$((migration_count + 1))"',
    );

    expect(workflow).toContain(
      "expected %s sequential migrations",
    );
  });

  it("enforces the isolated PostgreSQL runtime topology", async () => {
    const workflow = await readFile(
      new URL(
        "../.github/workflows/release-gate.yml",
        import.meta.url,
      ),
      "utf8",
    );

    expect(workflow).toContain(
      "POSTGRES_DB: nabuuma_rls_test",
    );

    expect(workflow).toContain(
      "- 55434:5432",
    );

    expect(workflow).toContain(
      'PGPORT: "55434"',
    );

    expect(workflow).toContain(
      "PGDATABASE: nabuuma_rls_test",
    );

    expect(workflow).toContain(
      "PGUSER: postgres",
    );

    expect(workflow).toContain(
      "RUNTIME_ROLE: nabuuma_runtime",
    );

    expect(workflow).toContain(
      "LOGIN NOINHERIT NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION",
    );

    expect(workflow).toContain(
      "postgresql://nabuuma_runtime:nabuuma_ci_runtime@127.0.0.1:55434/nabuuma_rls_test",
    );

    expect(workflow).toContain(
      "nabuuma_runtime|nabuuma_runtime|nabuuma_rls_test|f|f",
    );

    expect(workflow).not.toContain(
      "- 55432:5432",
    );

    expect(workflow).not.toContain(
      "POSTGRES_DB: nabuuma_test",
    );

    expect(workflow).not.toContain(
      "PGDATABASE: nabuuma_test",
    );
  });
});

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

  it("exposes deterministic build and canonical fail-closed startup commands", async () => {
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
      "bash scripts/start-runtime.sh",
    );

    const startup = await readFile(
      new URL("../scripts/start-runtime.sh", import.meta.url),
      "utf8",
    );

    expect(startup).toContain(
      'ENV_FILE="$HOME/.config/nabuuma/runtime.env"',
    );
    expect(startup).toContain(
      'url.port !== "55433"',
    );
    expect(startup).toContain(
      'db !== "nabuuma_rls_test"',
    );
    expect(startup).toContain(
      'user !== "nabuuma_runtime"',
    );
    expect(startup).toContain(
      '[[ ! -L "$ENV_FILE" ]]',
    );
    expect(startup).toContain(
      'runtime_mode="$(stat -c \'%a\' "$ENV_FILE")"',
    );
    expect(startup).not.toContain(
      ".env.production",
    );
    expect(startup).toContain(
      "Refusing startup:",
    );
  });
});
