import { spawnSync } from 'node:child_process';

const integrationUrl = process.env.NABUUMA_TEST_DATABASE_URL;
const auth0Url = process.env.NABUUMA_AUTH0_DISPOSABLE_DATABASE_URL;
if (!integrationUrl || !auth0Url || process.env.RUN_RLS_INTEGRATION !== '1') {
  throw new Error('verify:release requires isolated PostgreSQL integration URLs and RUN_RLS_INTEGRATION=1.');
}
const base = new URL(integrationUrl);
const auth0 = new URL(auth0Url);
const localHosts = new Set(['localhost','127.0.0.1','::1']);
if (!localHosts.has(base.hostname) || base.port === '55433' || !base.pathname.includes('_test')) {
  throw new Error('verify:release refuses non-disposable or port-55433 database targets.');
}
const auth0TestDatabase = auth0.port === '55434' && auth0.pathname === '/nabuuma_auth0_test';
const auth0SharedDisposable = process.env.NABUUMA_DISPOSABLE_TEST_DATABASE === '1' && auth0.port === base.port && auth0.pathname === base.pathname;
if (!localHosts.has(auth0.hostname) || !(auth0TestDatabase || auth0SharedDisposable)) {
  throw new Error('verify:release refuses non-disposable Auth0 HTTP integration target.');
}

const commands = [
  ['typecheck', ['run','typecheck']],
  ['build', ['run','build']],
  ['ESM', ['run','verify:esm-imports']],
  ['zero-skip regression', ['run','test:release:zero-skip']],
  ['external identity PostgreSQL', ['run','test:release:external-identity']],
  ['Auth0 HTTP PostgreSQL', ['run','test:release:auth0-http']],
  ['Academy learner lifecycle PostgreSQL E2E', ['run','test:release:academy-e2e']],
  ['audit ledger PostgreSQL', ['run','test:release:audit-postgres']],
];
for (const [label,args] of commands) {
  console.log(`\n=== RELEASE GATE: ${label} ===`);
  const commandEnv = label === 'Auth0 HTTP PostgreSQL'
    ? { ...process.env, NABUUMA_TEST_ADMIN_USER: process.env.NABUUMA_TEST_ADMIN_USER ?? process.env.PGUSER, NABUUMA_DISPOSABLE_TEST_DATABASE: process.env.NABUUMA_DISPOSABLE_TEST_DATABASE ?? '1' }
    : process.env;
  const result = spawnSync('npm', args, { stdio:'inherit', env:commandEnv });
  if (result.status !== 0) {
    console.error(`VERIFY_RELEASE=BLOCKED gate=${label} exit=${result.status ?? 'signal'}`);
    process.exit(result.status ?? 1);
  }
}
console.log('VERIFY_RELEASE=PASS');
