import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { PgExternalIdentityRepository, ExternalIdentityResolver } from '../dist/infrastructure/authentication/external-identity.js';
import { PgTransactionManager } from '../dist/infrastructure/database/transaction.js';
const admin = new Pool();
const runtimeUrl = process.env.NABUUMA_TEST_DATABASE_URL;
if (!runtimeUrl) throw new Error('NABUUMA_TEST_DATABASE_URL is required');
const runtime = new Pool({ connectionString: runtimeUrl });
const [orgA, orgB, userA, userMulti, userInactive, userUnsupported] = Array.from({length:6},()=>randomUUID());
const subject = 'auth0|identity-integration-'+randomUUID();
const altSubject = 'auth0|identity-integration-alt-'+randomUUID();
const subjectMulti = 'auth0|identity-integration-multi-'+randomUUID();
const opaqueSubject = 'opaque|punctuation! '+randomUUID();
const courseA=randomUUID(),courseB=randomUUID();
const repo=new PgExternalIdentityRepository(runtime),resolver=new ExternalIdentityResolver(repo),manager=new PgTransactionManager(runtime);
let fixtureCreated=false,assertions=0;
const assert=(condition,label)=>{if(!condition)throw new Error('FAILED: '+label);assertions++;};
try {
 fixtureCreated=true;
 await admin.query('INSERT INTO nabuuma.organisations(id,name,code,level) VALUES ($1,$2,$3,$4),($5,$6,$7,$8)',[orgA,'Identity Integration A','IT-'+orgA,'VENUE',orgB,'Identity Integration B','IT-'+orgB,'VENUE']);
 await admin.query('INSERT INTO nabuuma.users(id,display_name,email) VALUES ($1,$2,$3),($4,$5,$6),($7,$8,$9),($10,$11,$12)',[userA,'Identity A',userA+'@identity-test.invalid',userMulti,'Identity Multi',userMulti+'@identity-test.invalid',userInactive,'Identity Inactive',userInactive+'@identity-test.invalid',userUnsupported,'Identity Unsupported',userUnsupported+'@identity-test.invalid']);
 await admin.query('INSERT INTO nabuuma.organisation_memberships(organisation_id,user_id,role,is_active) VALUES ($1,$2,$3,true),($4,$5,$6,true),($7,$5,$8,true),($1,$9,$3,false),($1,$10,$11,true)',[orgA,userA,'LEARNER',orgA,userMulti,'MANAGER',orgB,'ASSESSOR',userInactive,userUnsupported,'CONTENT_EDITOR']);
 await admin.query('INSERT INTO nabuuma.external_identities(provider,external_subject,user_id) VALUES ($1,$2,$3),($1,$4,$3),($5,$6,$7),($1,$8,$3),($1,$9,$10),($1,$11,$7),($1,$12,$13)', ['AUTH0',subject,userA,altSubject,'SUPABASE',subject,userMulti,opaqueSubject,'auth0|inactive-fixture',userInactive,subjectMulti,'auth0|unsupported-fixture',userUnsupported]);
 await admin.query('INSERT INTO nabuuma.academy_courses(id,organisation_id,stable_key,version,title,description,is_published,created_by_id) VALUES ($1,$2,$3,1,$4,$5,true,$6),($7,$8,$9,1,$10,$11,true,$12)',[courseA,orgA,'identity-'+courseA,'Identity Tenant A','',userA,courseB,orgB,'identity-'+courseB,'Identity Tenant B','',userMulti]);
 fixtureCreated=true;
 const one=await repo.resolveIdentity('AUTH0',subject);
 assert(one?.userId===userA&&one.membership.organisationId===orgA&&one.membership.persistenceRole==='LEARNER','one row maps internal user, tenant and DB role');
 assert(await repo.resolveIdentity('AUTH0','unknown-'+randomUUID())===null,'unknown subject yields null');
 assert(await repo.resolveIdentity('AUTH0','auth0|inactive-fixture')===null,'inactive membership rejected');
 assert(await repo.resolveIdentity('AUTH0',subject,orgB)===null,'nonmember tenant selection denied');
 assert(await repo.resolveIdentity('AUTH0',subject,orgA)!==null,'explicit member tenant resolves');
 assert((await repo.resolveIdentity('AUTH0',altSubject))?.userId===userA,'two provider subjects map to one internal user');
 assert((await repo.resolveIdentity('SUPABASE',subject,orgB))?.userId===userMulti,'provider-qualified subject resolves independently with explicit tenant');
 assert(await repo.resolveIdentity('AUTH0',opaqueSubject)!==null,'opaque punctuation/non-UUID subject resolves');
 assert(await repo.resolveIdentity('AUTH0','auth0|unsupported-fixture')!==null,'persisted unsupported role is returned by database');
 let unsupportedRoleDenied=false;try{await resolver.resolve({provider:'AUTH0',externalSubject:'auth0|unsupported-fixture'});}catch{unsupportedRoleDenied=true;}assert(unsupportedRoleDenied,'unsupported persisted role rejected by application mapping');
 assert(await repo.resolveIdentity('AUTH0',subjectMulti,null)===null,'multi-membership with null org rejects ambiguous selection');
 assert((await repo.resolveIdentity('AUTH0',subjectMulti,orgA))?.membership.organisationId===orgA,'ambiguous user explicitly selects tenant A');
 assert((await repo.resolveIdentity('AUTH0',subjectMulti,orgB))?.membership.organisationId===orgB,'ambiguous user explicitly selects tenant B');
 let duplicateRejected=false;try{await admin.query('INSERT INTO nabuuma.external_identities(provider,external_subject,user_id) VALUES ($1,$2,$3)',['AUTH0',subject,userMulti]);}catch(error){duplicateRejected=error.code==='23505';}
 assert(duplicateRejected,'duplicate provider-qualified subject rejected');
 let blankRejected=false;try{await admin.query('INSERT INTO nabuuma.external_identities(provider,external_subject,user_id) VALUES ($1,$2,$3)',['AUTH0','   ',userA]);}catch(error){blankRejected=error.code==='23514';}assert(blankRejected,'whitespace-only subject rejected');
 let lengthRejected=false;try{await admin.query('INSERT INTO nabuuma.external_identities(provider,external_subject,user_id) VALUES ($1,$2,$3)',['AUTH0','x'.repeat(256),userA]);}catch(error){lengthRejected=error.code==='23514';}assert(lengthRejected,'overlength subject rejected');
 const resolved=await resolver.resolve({provider:'AUTH0',externalSubject:subject});
 assert(resolved.subject===userA&&resolved.organisationId===orgA&&resolved.roles[0]==='LEARNER','principal carries internal UUID and DB role');
 let tenantDenied=false;try{await resolver.resolve({provider:'AUTH0',externalSubject:subject,requestedOrganisationId:orgB});}catch{tenantDenied=true;}
 assert(tenantDenied,'resolver rejects tenant mismatch');
 let roleDenied=false;try{await resolver.resolve({provider:'AUTH0',externalSubject:subject,assertedRoles:['PLATFORM_ADMIN']});}catch{roleDenied=true;}
 assert(roleDenied,'asserted role disagreement fails closed');
 let directDenied=false;try{await runtime.query('SELECT * FROM nabuuma.external_identities');}catch(error){directDenied=error.code==='42501';}assert(directDenied,'runtime direct identity SELECT denied');
 let setRoleDenied=false;try{await runtime.query('SET ROLE nabuuma_auth_owner');}catch(error){setRoleDenied=error.code==='42501';}assert(setRoleDenied,'runtime SET ROLE resolver owner denied');
 let membershipDenied=false;try{await runtime.query('SELECT * FROM nabuuma.organisation_memberships');}catch(error){membershipDenied=error.code==='42501';}assert(membershipDenied,'runtime direct membership SELECT denied');
 await manager.withTransaction(resolved,async context=>{
  const settings=(await context.client.query("SELECT current_setting('app.user_id') user_id,current_setting('app.organisation_id') org_id,current_user role")).rows[0];
  assert(settings.user_id===userA&&settings.org_id===orgA&&settings.role==='nabuuma_app','transaction uses internal UUID and organisation');
  const catalog=(await context.client.query("SELECT current_setting('app.user_id') user_id")).rows[0];assert(catalog.user_id===userA,'internal subject remains UUID in transaction context');
  const tenantRows=await context.client.query('SELECT id FROM nabuuma.academy_courses WHERE id IN ($1,$2)',[courseA,courseB]);
  assert(tenantRows.rows.length===1&&tenantRows.rows[0].id===courseA,'tenant RLS prevents cross-organisation course visibility');
 });
 const postCommit=await runtime.connect();try{const row=(await postCommit.query("SELECT current_setting('app.user_id',true) user_id,current_setting('app.organisation_id',true) org_id")).rows[0];assert(!row.user_id&&!row.org_id,'transaction context cleared after commit');}finally{postCommit.release();}
 let rollback=false;try{await manager.withTransaction(resolved,async context=>{const id=(await context.client.query("SELECT current_setting('app.user_id') user_id")).rows[0].user_id;assert(id===userA,'rollback transaction context set');throw new Error('rollback sentinel');});}catch(error){rollback=error.message==='rollback sentinel';}
 assert(rollback,'rollback path executed');
 const client=await runtime.connect();try{const row=(await client.query("SELECT current_setting('app.user_id',true) user_id,current_setting('app.organisation_id',true) org_id")).rows[0];assert(!row.user_id&&!row.org_id,'transaction context does not leak after rollback');}finally{client.release();}
 console.log('POSTGRES_EXTERNAL_IDENTITY_INTEGRATION=PASS assertions='+assertions);
}finally{
 if(fixtureCreated){await admin.query('DELETE FROM nabuuma.external_identities WHERE user_id=ANY($1::uuid[])',[[userA,userMulti,userInactive,userUnsupported]]).catch(()=>{});await admin.query('DELETE FROM nabuuma.academy_courses WHERE id=ANY($1::uuid[])',[[courseA,courseB]]).catch(()=>{});await admin.query('DELETE FROM nabuuma.organisation_memberships WHERE user_id=ANY($1::uuid[])',[[userA,userMulti,userInactive,userUnsupported]]).catch(()=>{});await admin.query('DELETE FROM nabuuma.users WHERE id=ANY($1::uuid[])',[[userA,userMulti,userInactive,userUnsupported]]).catch(()=>{});await admin.query('DELETE FROM nabuuma.organisations WHERE id=ANY($1::uuid[])',[[orgA,orgB]]).catch(()=>{});}
 await runtime.end();await admin.end();
}
