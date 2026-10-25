import {
  describe,
  expect,
  it,
} from "vitest";
import { readFile } from "node:fs/promises";

const workflowUrl = new URL(
  "../.github/workflows/verify-release.yml",
  import.meta.url,
);

async function workflow(): Promise<string> {
  return readFile(workflowUrl, "utf8");
}

describe("post-release verification workflow", () => {
  it("supports automatic and controlled manual verification", async () => {
    const content = await workflow();

    expect(content).toContain(
      "workflow_run:",
    );
    expect(content).toContain(
      "- Publish Release",
    );
    expect(content).toContain(
      "workflow_dispatch:",
    );
    expect(content).toContain(
      "release_tag:",
    );
    expect(content).toContain(
      "release_sha:",
    );
  });

  it("resolves manual and automatic identities independently", async () => {
    const content = await workflow();

    expect(content).toContain(
      "Resolve automatic release identity",
    );
    expect(content).toContain(
      "${{ github.event.workflow_run.head_branch }}",
    );
    expect(content).toContain(
      "${{ github.event.workflow_run.head_sha }}",
    );
    expect(content).toContain(
      "Resolve manual release identity",
    );
    expect(content).toContain(
      "${{ inputs.release_tag }}",
    );
    expect(content).toContain(
      "${{ inputs.release_sha }}",
    );
    expect(content).toContain(
      "Validate release identity",
    );
    expect(content).toContain(
      "grep -Eq '^[0-9a-f]{40}$'",
    );
  });

  it("requires successful automatic publication", async () => {
    const content = await workflow();

    expect(content).toContain(
      "github.event.workflow_run.conclusion == 'success'",
    );
  });

  it("verifies release identity exactly", async () => {
    const content = await workflow();

    expect(content).toContain(
      'test "$target_sha" = "$RELEASE_SHA"',
    );
    expect(content).toContain(
      "gh release view",
    );
    expect(content).toContain(
      '.isDraft',
    );
    expect(content).toContain(
      '.isPrerelease',
    );
  });

  it("requires amd64 and arm64 image manifests", async () => {
    const content = await workflow();

    expect(content).toContain(
      "docker buildx imagetools inspect",
    );
    expect(content).toContain(
      "linux/amd64",
    );
    expect(content).toContain(
      "linux/arm64",
    );
  });

  it("pins and verifies the GitHub CLI used for attestations", async () => {
    const content = await workflow();

    expect(content).toContain(
      'GH_CLI_VERSION: "2.103.2"',
    );
    expect(content).toContain(
      "gh_${GH_CLI_VERSION}_checksums.txt",
    );
    expect(content).toContain(
      "sha256sum",
    );
    expect(content).toContain(
      'test "$actual" = "$expected"',
    );
    expect(content).toContain(
      'printf \'%s\\n\' "$RUNNER_TEMP" >> "$GITHUB_PATH"',
    );
    expect(content).not.toContain(
      'minimum="2.102.0"',
    );
    expect(content).not.toContain(
      "gh version --json version",
    );
  });

  it("verifies provenance against the exact publisher", async () => {
    const content = await workflow();

    expect(content).toContain(
      "gh attestation verify",
    );
    expect(content).toContain(
      '--repo "$GITHUB_REPOSITORY"',
    );
    expect(content).toContain(
      "--signer-workflow",
    );
    expect(content).toContain(
      ".github/workflows/publish-release.yml",
    );
  });

  it("keeps verification read-only", async () => {
    const content = await workflow();

    expect(content).toContain(
      "permissions: {}",
    );
    expect(content).toContain(
      "contents: read",
    );
    expect(content).toContain(
      "packages: read",
    );
    expect(content).toContain(
      "attestations: read",
    );

    expect(content).not.toContain(
      "packages: write",
    );
    expect(content).not.toContain(
      "contents: write",
    );
  });
});
