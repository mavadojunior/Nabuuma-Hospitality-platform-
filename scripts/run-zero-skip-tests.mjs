import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

if (process.env.RUN_RLS_INTEGRATION !== '1' || !process.env.NABUUMA_TEST_DATABASE_URL) {
  throw new Error('Release suite requires RUN_RLS_INTEGRATION=1 and a disposable NABUUMA_TEST_DATABASE_URL.');
}
const databaseUrl = new URL(process.env.NABUUMA_TEST_DATABASE_URL);
if (!['localhost','127.0.0.1','::1'].includes(databaseUrl.hostname) || databaseUrl.port === '55433' || !databaseUrl.pathname.includes('_test')) {
  throw new Error('Release suite refuses non-disposable or port-55433 database targets.');
}
const artifactDir = process.env.NABUUMA_RELEASE_ARTIFACT_DIR ?? join(process.cwd(), '.artifacts', 'release-test');
mkdirSync(artifactDir, { recursive: true, mode: 0o700 });
const reportPath = join(artifactDir, 'latest-vitest.json');
const stdoutPath = join(artifactDir, 'latest-stdout.log');
const stderrPath = join(artifactDir, 'latest-stderr.log');
const result = spawnSync('npm', ['run','test:security','--','--testTimeout=20000','--maxWorkers=1','--reporter=json',`--outputFile=${reportPath}`], { env: process.env, encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 });
writeFileSync(stdoutPath, result.stdout ?? '', { mode: 0o600 });
writeFileSync(stderrPath, result.stderr ?? '', { mode: 0o600 });
if (result.stdout) process.stdout.write(result.stdout);
if (result.stderr) process.stderr.write(result.stderr);
let report;
try { report = JSON.parse(readFileSync(reportPath, 'utf8')); }
catch (error) {
  const diagnostic = { status: 'FAILED', exitCode: result.status, reportParseError: String(error), reportPath, stdoutPath, stderrPath };
  writeFileSync(join(artifactDir, 'latest-summary.json'), JSON.stringify(diagnostic, null, 2) + '\n', { mode: 0o600 });
  console.error(`RELEASE_TEST_GATE=FAILED report unavailable; diagnostics retained at ${artifactDir}`);
  process.exit(result.status ?? 1);
}
const assertionResults = (report.testResults ?? []).flatMap(file => file.assertionResults ?? []);
const skipped = Number(report.numPendingTests ?? assertionResults.filter(test => ['pending','skipped','todo'].includes(test.status)).length);
const failed = Number(report.numFailedTests ?? assertionResults.filter(test => test.status === 'failed').length);
const passed = Number(report.numPassedTests ?? assertionResults.filter(test => test.status === 'passed').length);
const summary = { status: result.status === 0 && failed === 0 && skipped === 0 ? 'VERIFIED' : 'FAILED', exitCode: result.status, passed, failed, skipped, failedTests: assertionResults.filter(test => test.status === 'failed').map(test => ({ name: test.fullName ?? test.title, file: test.file ?? null })), testFiles: (report.testResults ?? []).map(file => ({ file: file.name, passed: file.assertionResults?.filter(test => test.status === 'passed').length ?? 0, failed: file.assertionResults?.filter(test => test.status === 'failed').length ?? 0, skipped: file.assertionResults?.filter(test => ['pending','skipped','todo'].includes(test.status)).length ?? 0 })), reportPath, stdoutPath, stderrPath };
writeFileSync(join(artifactDir, 'latest-summary.json'), JSON.stringify(summary, null, 2) + '\n', { mode: 0o600 });
console.log(`RELEASE_TEST_GATE=${summary.status} passed=${passed} failed=${failed} skipped=${skipped} diagnostics=${artifactDir}`);
if (summary.status !== 'VERIFIED') process.exit(result.status || 1);
