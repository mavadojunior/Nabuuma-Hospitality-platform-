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

  it("fails closed unless the exact commit passed the main release gate", async () => {
    const content = await workflow();

    expect(content).toContain("Require successful main release gate for exact commit");
    expect(content).toContain("      actions: read");
    expect(content).toContain("--workflow release-gate.yml");
    expect(content).toContain('--commit "$GITHUB_SHA"');
    expect(content).toContain("--branch main");
    expect(content).toContain("--event push");
    expect(content).toContain("--status success");
    expect(content).toContain(".headSha == $sha");
    expect(content).toContain('.headBranch == "main"');
    expect(content).toContain('.event == "push"');
    expect(content).toContain('.status == "completed"');
    expect(content).toContain('.conclusion == "success"');
    expect(content).toContain("no successful main release-gate run exists for this exact commit");
  });

  it("requires a full-history fail-closed secret scan before publication", async () => {
    const content = await workflow();
    const scannerJob = content.match(/  secret-scan:\n([\s\S]*?)(?=\n  publish-image:)/)?.[1];
    const imageJob = content.match(/  publish-image:\n([\s\S]*?)(?=\n  publish-release:)/)?.[1];
    const releaseJob = content.match(/  publish-release:\n([\s\S]*)$/)?.[1];

    expect(scannerJob).toBeDefined();
    expect(scannerJob).toContain("contents: read");
    expect(scannerJob).toContain("fetch-depth: 0");
    expect(scannerJob).toContain("gitleaks/gitleaks/v8@v8.30.1");
    expect(scannerJob).toContain("command -v gitleaks");
    expect(scannerJob).toContain("gitleaks git --redact --exit-code 1 .");
    expect(scannerJob).not.toContain("continue-on-error");
    expect(scannerJob).not.toContain("|| true");
    expect(imageJob).toContain("      - validate");
    expect(imageJob).toContain("      - secret-scan");
    expect(releaseJob).toContain("      - validate");
    expect(releaseJob).toContain("      - secret-scan");
    expect(releaseJob).toContain("      - publish-image");
    expect(content.indexOf("Scan release source and Git history")).toBeLessThan(content.indexOf("Authenticate to GHCR"));
    expect(content.indexOf("Scan release source and Git history")).toBeLessThan(content.indexOf("gh release create"));
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
      "actions/attest@1e69f48acb82d1966a394da916b4c1698aa569d6 # v4.2.2",
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

  it("uses the supported QEMU action major", async () => {
    const content = await workflow();

    expect(content).toContain(
      "docker/setup-qemu-action@99012661954931238ded8c8b007157a8430204e1 # v4.4.0",
    );

    expect(content).not.toContain(
      "docker/setup-qemu-action@v3",
    );
  });

  it("does not persist checkout credentials", async () => {
    const content = await workflow();

    expect(
      content.match(/persist-credentials: false/g),
    ).toHaveLength(3);
  });

  it("publishes the GitHub Release only after the image", async () => {
    const content = await workflow();

    expect(content).toContain(
      "publish-release:",
    );

    expect(content).toContain(
      "name: Publish GitHub Release",
    );

    expect(content).toContain(
      "      - publish-image",
    );

    expect(content).toContain(
      "contents: write",
    );
  });

  it("creates release notes from the validated immutable tag", async () => {
    const content = await workflow();

    expect(content).toContain(
      'gh release create "$RELEASE_TAG"',
    );

    expect(content).toContain(
      "--verify-tag",
    );

    expect(content).toContain(
      "--generate-notes",
    );

    expect(content).toContain(
      "RELEASE_VERSION: ${{ needs.validate.outputs.version }}",
    );
  });

  it("does not create a release before image attestation", async () => {
    const content = await workflow();

    const attestation = content.indexOf(
      "Attest published image",
    );

    const release = content.indexOf(
      "publish-release:",
    );

    expect(attestation).toBeGreaterThan(-1);
    expect(release).toBeGreaterThan(attestation);
  });

  it("pins every external action in all hardened workflows to a full SHA", async () => {
    const paths = [
      "../.github/workflows/publish-release.yml",
      "../.github/workflows/release-gate.yml",
      "../.github/workflows/supply-chain-security.yml",
      "../.github/workflows/verify-release.yml",
      "../.github/workflows/certify-container.yml",
    ];
    const workflows = await Promise.all(
      paths.map((path) => readFile(new URL(path, import.meta.url), "utf8")),
    );
    const contents = workflows.join("\n");
    const usesLines = contents.match(/^[ \t]*uses:[ \t]*[^\s#]+/gm) ?? [];
    const pinned = contents.match(/^[ \t]*uses:[ \t]*([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)@([0-9a-f]{40})[ \t]+#[ \t]+(v[0-9][^\s]*)[ \t]*$/gm) ?? [];

    expect(usesLines).toHaveLength(27);
    expect(pinned).toHaveLength(27);
    expect(contents).toContain("actions/checkout@");
    expect(contents).toContain("actions/setup-go@");
    expect(contents).toContain("actions/setup-node@");
    expect(contents).toContain("actions/attest@");
    expect(contents).toContain("actions/dependency-review-action@");
    expect(contents).toContain("docker/setup-qemu-action@");
    expect(contents).toContain("docker/setup-buildx-action@");
    expect(contents).toContain("docker/login-action@");
    expect(contents).toContain("docker/metadata-action@");
    expect(contents).toContain("docker/build-push-action@");
    expect(contents).toContain("aquasecurity/trivy-action@");
    expect(contents).not.toMatch(/^[ \t]*uses:[ \t]*[^\s#]+@(v|main|master|[0-9]+\.[0-9]+\.[0-9]+)/m);
  });
});
