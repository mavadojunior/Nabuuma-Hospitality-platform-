import {
  describe,
  expect,
  it,
} from "vitest";
import { readFile } from "node:fs/promises";

const workflowUrl = new URL(
  "../.github/workflows/publish-release.yml",
  import.meta.url,
);

async function workflow(): Promise<string> {
  return readFile(workflowUrl, "utf8");
}

describe("release publication workflow", () => {
  it("accepts version-tag events and validates exact semantic versions", async () => {
    const content = await workflow();

    expect(content).toContain(
      '      - "v*.*.*"',
    );

    expect(content).toContain(
      "release tag must be vMAJOR.MINOR.PATCH",
    );

    expect(content).toContain(
      "^v(0|[1-9][0-9]*)",
    );
  });

  it("requires the release commit to belong to protected main", async () => {
    const content = await workflow();

    expect(content).toContain(
      "git merge-base",
    );

    expect(content).toContain(
      "--is-ancestor",
    );

    expect(content).toContain(
      "origin/main",
    );
  });

  it("publishes immutable multi-platform GHCR tags", async () => {
    const content = await workflow();

    expect(content).toContain(
      "registry: ${{ env.REGISTRY }}",
    );

    expect(content).toContain(
      "platforms: linux/amd64,linux/arm64",
    );

    expect(content).toContain(
      "type=raw,value=${{ needs.validate.outputs.version }}",
    );

    expect(content).toContain(
      "type=sha,prefix=sha-,format=long",
    );

    expect(content).toContain(
      "push: true",
    );

    expect(content).not.toContain(
      "type=raw,value=latest",
    );
  });

  it("publishes provenance and SBOM attestations", async () => {
    const content = await workflow();

    expect(content).toContain(
      "provenance: mode=max",
    );

    expect(content).toContain(
      "sbom: true",
    );

    expect(content).toContain(
      "actions/attest@v4",
    );

    expect(content).toContain(
      "subject-digest: ${{ steps.build.outputs.digest }}",
    );

    expect(content).toContain(
      "push-to-registry: true",
    );
  });

  it("grants publishing permissions only to the image job", async () => {
    const content = await workflow();

    expect(content).toContain(
      "permissions: {}",
    );

    expect(content).toContain(
      "packages: write",
    );

    expect(content).toContain(
      "id-token: write",
    );

    expect(content).toContain(
      "attestations: write",
    );
  });

  it("does not persist checkout credentials", async () => {
    const content = await workflow();

    expect(
      content.match(/persist-credentials: false/g),
    ).toHaveLength(2);
  });
});
