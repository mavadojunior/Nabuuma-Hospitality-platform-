import {
  describe,
  expect,
  it,
} from "vitest";
import { readFile } from "node:fs/promises";

const workflowUrl = new URL(
  "../.github/workflows/supply-chain-security.yml",
  import.meta.url,
);

async function workflow(): Promise<string> {
  return readFile(workflowUrl, "utf8");
}

describe("supply-chain workflow", () => {
  it("enforces dependency review on pull requests", async () => {
    const content = await workflow();

    expect(content).toContain(
      "actions/dependency-review-action@2031cfc080254a8a887f58cffee85186f0e49e48 # v4.9.0",
    );
    expect(content).toContain(
      "fail-on-severity: high",
    );
  });

  it("fails on high or critical repository vulnerabilities", async () => {
    const content = await workflow();

    expect(content).toContain(
      "aquasecurity/trivy-action@ed142fd0673e97e23eac54620cfb913e5ce36c25 # v0.36.0",
    );
    expect(content).toContain(
      "scan-type: fs",
    );
    expect(content).toContain(
      'exit-code: "1"',
    );
    expect(content).toContain(
      "severity: HIGH,CRITICAL",
    );
  });

  it("keeps repository permissions read-only", async () => {
    const content = await workflow();

    expect(content).toContain(
      "permissions:\n  contents: read",
    );
  });
});
