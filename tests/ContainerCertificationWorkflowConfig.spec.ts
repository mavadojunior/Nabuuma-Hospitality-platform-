import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";

const workflowUrl = new URL(
  "../.github/workflows/certify-container.yml",
  import.meta.url,
);

async function workflow(): Promise<string> {
  return readFile(workflowUrl, "utf8");
}

describe("non-publishing container certification workflow", () => {
  it("is manually triggered only", async () => {
    const content = await workflow();
    expect(content).toMatch(/^on:\n  workflow_dispatch:\s*$/m);
    expect(content).not.toMatch(/^  (push|pull_request|schedule|workflow_run|release):/m);
  });

  it("grants read-only repository permissions", async () => {
    const content = await workflow();
    expect(content).toMatch(/^permissions:\n  contents: read\s*$/m);
    expect(content).toContain("    permissions:\n      contents: read");
    expect(content).not.toMatch(/^\s+(packages|id-token|attestations):\s*write\s*$/m);
    expect(content).not.toMatch(/^\s+contents:\s*write\s*$/m);
  });

  it("pins every external action to a full SHA with a version comment", async () => {
    const content = await workflow();
    const uses = content.match(/^\s+uses:\s+[^\s#]+/gm) ?? [];
    const pinned = content.match(/^\s+uses:\s+[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+@[0-9a-f]{40}\s+#\s+v[0-9][^\s]*\s*$/gm) ?? [];
    expect(uses).toHaveLength(4);
    expect(pinned).toHaveLength(4);
    expect(content).toContain("actions/checkout@d23441a48e516b6c34aea4fa41551a30e30af803 # v6.1.0");
    expect(content).toContain("docker/setup-qemu-action@99012661954931238ded8c8b007157a8430204e1 # v4.4.0");
    expect(content).toContain("docker/setup-buildx-action@f87e5991a6d7451dcb8d9637bfbc97413f497069 # v4.4.1");
    expect(content).toContain("docker/build-push-action@c3c9e263c25d99ce0380d002d59b67737d91b0dc # v7.4.0");
  });

  it("builds and loads a local native image without pushing", async () => {
    const content = await workflow();
    expect(content).toContain("platforms: linux/amd64");
    expect(content).toMatch(/load:\s*true/);
    expect(content).toMatch(/push:\s*false/);
    expect(content).toMatch(/provenance:\s*false/);
    expect(content).toMatch(/sbom:\s*false/);
    expect(content).toContain("nabuuma-certification:\${{ github.sha }}");
    expect(content).not.toMatch(/^\s*push:\s*true\s*$/m);
  });

  it("runs the application with required hardened container controls", async () => {
    const content = await workflow();
    expect(content).toContain("--read-only");
    expect(content).toContain("--tmpfs /tmp:rw,noexec,nosuid,nodev,size=16m");
    expect(content).toContain("--cap-drop ALL");
    expect(content).toContain("--security-opt no-new-privileges:true");
    expect(content).toContain("--restart=no");
    expect(content).toContain("--memory=512m");
    expect(content).toContain("--cpus=1");
    expect(content).not.toContain("--privileged");
    expect(content).not.toContain("--network host");
  });

  it("uses bounded health probes and verifies runtime identity", async () => {
    const content = await workflow();
    expect(content).toContain("/health/live");
    expect(content).toContain("/health/ready");
    expect(content).toContain("seq 1 40");
    expect(content).toContain("seq 1 20");
    expect(content).toContain("/proc/$host_pid/status");
    expect(content).toContain("NONROOT_RUNTIME=VERIFIED");
    expect(content).toContain("READ_ONLY_ROOT_RUNTIME=VERIFIED");
    expect(content).toContain("TMPFS_RUNTIME=VERIFIED");
    expect(content).toContain(
      'docker exec "$CERT_APP_CONTAINER" /nodejs/bin/node -e',
    );
    expect(content).not.toContain(
      'docker exec "$CERT_APP_CONTAINER" node -e',
    );
  });

  it("probes SIGTERM shutdown within a bounded deadline and cleans up always", async () => {
    const content = await workflow();
    expect(content).toContain("docker kill --signal=TERM");
    expect(content).toContain("seq 1 30");
    expect(content).toContain("SIGTERM_CLEAN_SHUTDOWN=VERIFIED");
    expect(content).toContain("[DB] Database pool closed successfully");
    expect(content).toMatch(/- name: Remove only certification containers[\s\S]*?if: always\(\)/);
    expect(content).toContain("docker network rm");
    expect(content).toContain("docker image rm");
  });

  it("builds both architectures to a local OCI archive without publication", async () => {
    const content = await workflow();
    expect(content).toContain("--platform linux/amd64,linux/arm64");
    expect(content).toContain("type=oci,dest=/tmp/nabuuma-multiarch.oci.tar");
    expect(content).toContain("tar -xOf /tmp/nabuuma-multiarch.oci.tar index.json");
    expect(content).toContain("AMD64_BUILD=VERIFIED");
    expect(content).toContain("ARM64_BUILD=VERIFIED");
    expect(content).toContain("OCI_INDEX=VERIFIED");
    expect(content).not.toContain("docker push");
    expect(content).toContain(
      '"application/vnd.oci.image.index.v1+json"',
    );
    expect(content).toContain(
      'manifest_blob="blobs/sha256/${manifest_digest#sha256:}"',
    );
    expect(content).toContain("/tmp/nabuuma-platform-index.json");

  });

  it("uses only a disposable database fixture and no production credentials or protected ports", async () => {
    const content = await workflow();
    expect(content).toContain("postgres:18");
    expect(content).toContain("--network-alias postgres");
    expect(content).toContain("certification-only");
    expect(content).toContain(
      "CERT_DB_PASSWORD: nabuuma-certification-only",
    );
    expect(
      content.split(
        '--env DATABASE_URL="$CERT_DATABASE_URL"',
      ),
    ).toHaveLength(3);
    expect(
      content.split('CERT_DATABASE_URL="$('),
    ).toHaveLength(3);
    expect(
      content.split('CERT_DB_USER="certifier"'),
    ).toHaveLength(3);
    expect(
      content.split('CERT_DB_HOST="postgres"'),
    ).toHaveLength(3);
    expect(
      content.split('CERT_DB_PORT="5432"'),
    ).toHaveLength(3);
    expect(
      content.split('CERT_DB_NAME="certification"'),
    ).toHaveLength(3);
    expect(
      content.split("printf '%s%s:%s@%s:%s/%s'"),
    ).toHaveLength(3);
    expect(content).not.toMatch(/55433|55445|55446/);
    expect(content).not.toMatch(/\$\{\{\s*secrets\./i);
    expect(content).not.toMatch(/GHCR|ghcr\.io|docker\/login-action|docker login/i);
    expect(content).not.toMatch(/packages:\s*write|id-token:\s*write|attestations:\s*write/);
  });
});
