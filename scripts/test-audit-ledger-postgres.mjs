import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';

const runtimeUrl = process.env.NABUUMA_TEST_DATABASE_URL;
if (!runtimeUrl) throw new Error('NABUUMA_TEST_DATABASE_URL is required');
const url = new URL(runtimeUrl);
if (!['127.0.0.1', 'localhost', '::1'].includes(url.hostname) || url.port === '55433' || url.pathname !== '/nabuuma_rls_test') {
  throw new Error('Refusing audit integration against a non-disposable database target');
}
const admin = new Pool();
const runtime = new Pool({ connectionString: runtimeUrl, max: 2 });
let assertions = 0;
const check = (condition, label) => { assert.ok(condition, label); assertions++; };
const orgA = randomUUID(), orgB = randomUUID(), userA = randomUUID(), userB = randomUUID();
const eventA = randomUUID(), eventB = randomUUID();
try {
  const catalog = await admin.query(`
    SELECT c.relkind, pg_get_partkeydef(c.oid) AS partition_key,
           c.relrowsecurity, c.relforcerowsecurity,
           (SELECT count(*) FROM pg_inherits i JOIN pg_class child ON child.oid=i.inhrelid
             WHERE i.inhparent=c.oid AND pg_get_expr(child.relpartbound,child.oid)='DEFAULT') AS default_partitions
    FROM pg_class c WHERE c.oid='nabuuma.audit_events'::regclass
  `);
  check(catalog.rows[0]?.relkind === 'p', 'audit parent is partitioned');
  check(catalog.rows[0]?.partition_key === 'RANGE (occurred_at)', 'partition key is occurred_at');
  check(catalog.rows[0]?.relrowsecurity === true, 'RLS enabled');
  check(catalog.rows[0]?.relforcerowsecurity === true, 'FORCE RLS enabled');
  check(Number(catalog.rows[0]?.default_partitions) === 1, 'exactly one default partition');

  const indexNames = await admin.query(`SELECT indexname FROM pg_indexes WHERE schemaname='nabuuma' AND tablename='audit_events'`);
  const names = new Set(indexNames.rows.map(row => row.indexname));
  for (const name of ['audit_events_pk','audit_events_actor_time_idx','audit_events_correlation_idx','audit_events_entity_time_idx','audit_events_occurred_at_brin_idx','audit_events_org_time_idx']) check(names.has(name), `canonical index ${name}`);

  const policyNames = await admin.query(`SELECT policyname FROM pg_policies WHERE schemaname='nabuuma' AND tablename='audit_events'`);
  const policies = new Set(policyNames.rows.map(row => row.policyname));
  check(policies.has('audit_events_tenant_select'), 'tenant SELECT policy exists');
  check(policies.has('audit_events_tenant_insert'), 'tenant INSERT policy exists');
  const trigger = await admin.query(`SELECT 1 FROM pg_trigger WHERE tgrelid='nabuuma.audit_events'::regclass AND tgname='trg_audit_events_immutable' AND NOT tgisinternal`);
  check(trigger.rowCount === 1, 'append-only trigger exists');

  const constraints = await admin.query(`SELECT conname, confdeltype FROM pg_constraint WHERE conrelid='nabuuma.audit_events'::regclass AND contype='f'`);
  check(constraints.rows.some(row => row.conname === 'audit_events_actor_fk' && row.confdeltype === 'r'), 'actor FK RESTRICT');
  check(constraints.rows.some(row => row.conname === 'audit_events_organisation_fk' && row.confdeltype === 'r'), 'organisation FK RESTRICT');

  await admin.query('INSERT INTO nabuuma.organisations(id,name,code,level) VALUES ($1,$2,$3,$4),($5,$6,$7,$8)', [orgA,'Audit Integration A',`AUD-${orgA.slice(0,8)}`,'TEAM',orgB,'Audit Integration B',`AUD-${orgB.slice(0,8)}`,'TEAM']);
  await admin.query('INSERT INTO nabuuma.users(id,display_name,email) VALUES ($1,$2,$3),($4,$5,$6)', [userA,'Audit Learner A',`audit-${userA}@test.invalid`,userB,'Audit Learner B',`audit-${userB}@test.invalid`]);
  await admin.query('INSERT INTO nabuuma.organisation_memberships(organisation_id,user_id,role,is_active) VALUES ($1,$2,$3,true),($4,$5,$6,true)', [orgA,userA,'LEARNER',orgB,userB,'LEARNER']);

  const future = new Date('2035-01-01T00:00:00.000Z');
  await admin.query(`INSERT INTO nabuuma.audit_events(id,organisation_id,actor_user_id,action,entity_type,entity_id,occurred_at,outcome,metadata) VALUES ($1,$2,$3,'release-test','test',$4,$5,'SUCCESS','{}'),($6,$7,$8,'release-test','test',$9,$5,'SUCCESS','{}')`, [eventA,orgA,userA,randomUUID(),future,eventB,orgB,userB,randomUUID()]);
  const defaultRows = await admin.query('SELECT count(*)::int AS count FROM nabuuma.audit_events_default WHERE id = ANY($1::uuid[])', [[eventA,eventB]]);
  check(defaultRows.rows[0].count === 2, 'out-of-range writes route to DEFAULT partition');

  const client = await runtime.connect();
  try {
    await client.query('BEGIN');
    await client.query('SET LOCAL ROLE nabuuma_app');
    await client.query("SELECT set_config('app.user_id',$1,true),set_config('app.organisation_id',$2,true)", [userA,orgA]);
    const visibleA = await client.query('SELECT id FROM nabuuma.audit_events WHERE id = ANY($1::uuid[])', [[eventA,eventB]]);
    check(visibleA.rows.length === 1 && visibleA.rows[0].id === eventA, 'Tenant A sees only Tenant A event');
    await client.query(`INSERT INTO nabuuma.audit_events(organisation_id,actor_user_id,action,entity_type,entity_id,occurred_at,outcome,metadata) VALUES ($1,$2,'tenant-insert','test',$3,now(),'SUCCESS','{}')`, [orgA,userA,randomUUID()]);
    assertions++;
    let denied = false;
    try { await client.query(`INSERT INTO nabuuma.audit_events(organisation_id,actor_user_id,action,entity_type,entity_id,occurred_at,outcome,metadata) VALUES ($1,$2,'spoof','test',$3,now(),'SUCCESS','{}')`, [orgB,userA,randomUUID()]); } catch (error) { denied = error.code === '42501'; }
    check(denied, 'cross-tenant INSERT denied');
    await client.query('ROLLBACK');

    await client.query('BEGIN');
    await client.query('SET LOCAL ROLE nabuuma_app');
    await client.query("SELECT set_config('app.user_id',$1,true),set_config('app.organisation_id',$2,true)", [userB,orgB]);
    const visibleB = await client.query('SELECT id FROM nabuuma.audit_events WHERE id = ANY($1::uuid[])', [[eventA,eventB]]);
    check(visibleB.rows.length === 1 && visibleB.rows[0].id === eventB, 'Tenant B sees only Tenant B event');
    await client.query('ROLLBACK');
  } finally { client.release(); }

  for (const operation of ['UPDATE','DELETE']) {
    let rejected = false;
    try {
      if (operation === 'UPDATE') await admin.query('UPDATE nabuuma.audit_events SET action=$1 WHERE id=$2 AND occurred_at=$3', ['mutated',eventA,future]);
      else await admin.query('DELETE FROM nabuuma.audit_events WHERE id=$1 AND occurred_at=$2', [eventA,future]);
    } catch (error) { rejected = error.code === '55000'; }
    check(rejected, `${operation} denied by append-only trigger`);
  }
  console.log(`AUDIT_POSTGRES=PASS assertions=${assertions} skipped=0`);
} finally {
  await runtime.end();
  await admin.end();
}
