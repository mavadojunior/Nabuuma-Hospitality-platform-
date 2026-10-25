import {
  describe,
  expect,
  it,
} from "vitest";
import { readFile } from "node:fs/promises";

describe("production container configuration", () => {
  it("uses deterministic multi-stage dependency installation", async () => {
    const dockerfile = await readFile(
      new URL("../Dockerfile", import.meta.url),
      "utf8",
    );

    expect(dockerfile).toContain(
      "npm ci",
    );
    expect(dockerfile).toContain(
      "npm ci --omit=dev",
    );
    expect(dockerfile).toContain(
      "npm run build",
    );
  });

  it("runs compiled code as a non-root distroless user", async () => {
    const dockerfile = await readFile(
      new URL("../Dockerfile", import.meta.url),
      "utf8",
    );

    expect(dockerfile).toContain(
      "gcr.io/distroless/nodejs22-debian12:nonroot",
    );
    expect(dockerfile).toContain(
      "USER nonroot:nonroot",
    );
    expect(dockerfile).toContain(
      "STOPSIGNAL SIGTERM",
    );
    expect(dockerfile).toContain(
      "HEALTHCHECK --interval=30s",
    );
    expect(dockerfile).toContain(
      "http://127.0.0.1:3000/health/live",
    );
    expect(dockerfile).toContain(
      'CMD ["dist/server.js"]',
    );
    expect(dockerfile).not.toContain(
      "COPY . .",
    );
  });

  it("excludes secrets, tests and local build state", async () => {
    const dockerignore = await readFile(
      new URL("../.dockerignore", import.meta.url),
      "utf8",
    );

    for (const required of [
      ".git",
      "node_modules",
      "dist",
      "tests",
      ".env",
      ".env.*",
    ]) {
      expect(dockerignore).toContain(required);
    }
  });
});
