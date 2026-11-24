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
      "gcr.io/distroless/nodejs22-debian13:nonroot",
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
      'CMD ["/nodejs/bin/node", "-e",',
    );
    expect(dockerfile).not.toContain(
      'CMD ["-e",',
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

  it("pins every external base image and enforces the Debian 13 Node 22 runtime contract", async () => {
    const dockerfile = await readFile(
      new URL("../Dockerfile", import.meta.url),
      "utf8",
    );

    const fromReferences = dockerfile
      .split(/\r?\n/)
      .map((line) => line.match(/^FROM\s+(\S+)/)?.[1])
      .filter((reference): reference is string =>
        reference !== undefined && reference !== "dependencies",
      );

    expect(fromReferences).toHaveLength(3);
    for (const reference of fromReferences) {
      expect(reference).toMatch(/@sha256:[0-9a-f]{64}$/);
      expect(reference).not.toMatch(/:latest(?:@|$)/);
    }

    expect(fromReferences[0]).toBe(
      "node:22-bookworm-slim@sha256:e9f565d32859f0cbfb52125eafe8be39390f24dac302dc3cdf566e8ba3ab21ee",
    );
    expect(fromReferences[1]).toBe(
      "node:22-bookworm-slim@sha256:e9f565d32859f0cbfb52125eafe8be39390f24dac302dc3cdf566e8ba3ab21ee",
    );
    expect(fromReferences[2]).toBe(
      "gcr.io/distroless/nodejs22-debian13:nonroot@sha256:f991e86a080567b6ab7c3392e36f7a0a4f9300639e526b48ee81b92d523af62e",
    );
    expect(dockerfile).not.toContain("nodejs22-debian12");
    expect(dockerfile).toContain("USER nonroot:nonroot");
    expect(dockerfile).toContain('CMD ["dist/server.js"]');
  });

});
