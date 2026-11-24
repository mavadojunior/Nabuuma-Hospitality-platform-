import { randomUUID } from "node:crypto";
import Fastify from "fastify";
import { Pool } from "pg";
import { generateKeyPair, SignJWT } from "jose";
import { JoseJwtVerifier } from "../dist/infrastructure/authentication/JoseJwtVerifier.js";
import { Auth0RequestAuthenticator } from "../dist/infrastructure/authentication/Auth0RequestAuthenticator.js";
import { ExternalIdentityResolver, PgExternalIdentityRepository, mapVerifiedAuth0Payload } from "../dist/infrastructure/authentication/external-identity.js";
import { PgTransactionManager } from "../dist/infrastructure/database/transaction.js";
import { createAcademyApplicationServices } from "../dist/bootstrap.js";
import { registerAcademyRoutes } from "../dist/interfaces/http/academy-routes.js";

const databaseUrl = process.env.NABUUMA_AUTH0_DISPOSABLE_DATABASE_URL;
if (!databaseUrl) throw new Error("NABUUMA_AUTH0_DISPOSABLE_DATABASE_URL required");
const parsed = new URL(databaseUrl);
const isLoopback = ["127.0.0.1", "localhost", "::1"].includes(
  parsed.hostname,
);
const isDedicatedCiDatabase =
  parsed.port === "55434" &&
  parsed.pathname === "/nabuuma_auth0_test";
const isSharedDisposableDatabase =
  process.env.NABUUMA_DISPOSABLE_TEST_DATABASE === "1" &&
  ["55434", "55445"].includes(parsed.port) &&
  parsed.pathname === "/nabuuma_rls_test";

if (
  !isLoopback ||
  (!isDedicatedCiDatabase && !isSharedDisposableDatabase)
) {
  throw new Error(
    "Refusing non-disposable Auth0 integration database target",
  );
}
const admin = new Pool({ host: process.env.PGHOST ?? "127.0.0.1", port: Number(process.env.PGPORT ?? parsed.port), database: process.env.PGDATABASE ?? parsed.pathname.slice(1), user: process.env.NABUUMA_TEST_ADMIN_USER ?? process.env.PGUSER, password: process.env.PGPASSWORD });
const runtime = new Pool({ connectionString: databaseUrl, max: 3 });
const orgA=randomUUID(),orgB=randomUUID(),userA=randomUUID(),userB=randomUUID(),courseA=randomUUID(),courseB=randomUUID();
const subjectA="auth0|http-user-a",subjectB="auth0|http-user-b";
const issuer="https://dev-lhgi27ewkdcqtyek.us.auth0.com/",audience="https://api.nabuuma.com",namespace="https://api.nabuuma.com";
let created=false, assertions=0;
const assert=(condition,label)=>{if(!condition)throw new Error("FAILED: "+label);assertions++;};
const keys=await generateKeyPair("RS256"),kid="auth0-http-disposable-kid";
const verifier=new JoseJwtVerifier({issuer,audience,jwksUri:"https://synthetic.invalid/jwks",algorithms:["RS256"]},async header=>header.kid===kid?keys.publicKey:(()=>{throw new Error("unknown kid")})());
const resolver=new ExternalIdentityResolver(new PgExternalIdentityRepository(runtime));
const authenticator=new Auth0RequestAuthenticator(verifier,resolver);
const baseManager=new PgTransactionManager(runtime);
let observedContext;
const transactionManager={withTransaction(claims,work){return baseManager.withTransaction(claims,async context=>{const row=(await context.client.query("SELECT current_setting('app.user_id') user_id,current_setting('app.organisation_id') org_id,current_user db_role")).rows[0];observedContext=row;return work(context);});}};
const services=createAcademyApplicationServices(transactionManager);
const app=Fastify({logger:false});
await registerAcademyRoutes(app,{services,authenticator});
const now=()=>Math.floor(Date.now()/1000);
async function token(sub=subjectA,claims={}){return new SignJWT(claims).setProtectedHeader({alg:"RS256",kid}).setIssuer(issuer).setAudience(audience).setSubject(sub).setIssuedAt(now()).setExpirationTime(now()+120).sign(keys.privateKey);}
async function request(jwt){return app.inject({method:"GET",url:"/api/v1/academy/courses",headers:{authorization:"Bearer "+jwt}});}
try{
 created=true;
 await admin.query("INSERT INTO nabuuma.organisations(id,name,code,level) VALUES ($1,$2,$3,'VENUE'),($4,$5,$6,'VENUE')",[orgA,"Auth0 HTTP A","A-"+orgA,orgB,"Auth0 HTTP B","B-"+orgB]);
 await admin.query("INSERT INTO nabuuma.users(id,display_name,email) VALUES ($1,$2,$3),($4,$5,$6)",[userA,"HTTP User A",userA+"@auth0-test.invalid",userB,"HTTP User B",userB+"@auth0-test.invalid"]);
 await admin.query("INSERT INTO nabuuma.organisation_memberships(organisation_id,user_id,role,is_active) VALUES ($1,$2,'LEARNER',true),($3,$4,'LEARNER',true)",[orgA,userA,orgB,userB]);
 await admin.query("INSERT INTO nabuuma.external_identities(provider,external_subject,user_id) VALUES ('AUTH0',$1,$2),('AUTH0',$3,$4)",[subjectA,userA,subjectB,userB]);
 await admin.query("INSERT INTO nabuuma.academy_courses(id,organisation_id,stable_key,version,title,description,is_published,created_by_id) VALUES ($1,$2,$3,1,$4,'',true,$5),($6,$7,$8,1,$9,'',true,$10)",[courseA,orgA,"auth0-"+courseA,"HTTP Tenant A",userA,courseB,orgB,"auth0-"+courseB,"HTTP Tenant B",userB]);
 const validToken=await token(subjectA,{[namespace+"/roles"]:["LEARNER"]});
 const verifiedPayload=await verifier.verifyPayload(validToken);
 assert(verifiedPayload.subject===subjectA,"synthetic JWT cryptographic verification succeeds");
 const fixtureCount=await admin.query("SELECT count(*)::int AS identity_count,(SELECT count(*) FROM nabuuma.organisation_memberships WHERE user_id=$2 AND is_active) AS membership_count FROM nabuuma.external_identities WHERE provider='AUTH0' AND external_subject=$1",[subjectA,userA]);
 assert(fixtureCount.rows[0].identity_count===1&&Number(fixtureCount.rows[0].membership_count)===1,"synthetic external identity and active membership fixtures exist");
 const directAdmin=await admin.query("SELECT * FROM nabuuma.resolve_external_identity('AUTH0',$1,NULL)",[subjectA]);
 assert(directAdmin.rows.length===1,"administrative resolver returns fixture mapping");
 const directIdentity=await new PgExternalIdentityRepository(runtime).resolveIdentity("AUTH0",subjectA);
 assert(directIdentity?.userId===userA&&directIdentity.membership.organisationId===orgA,"runtime resolver returns fixture mapping");
 const resolvedPrincipal=await resolver.resolve(mapVerifiedAuth0Payload(verifiedPayload.rawClaims));
 assert(resolvedPrincipal.subject===userA&&resolvedPrincipal.organisationId===orgA,"PostgreSQL external identity resolver returns authoritative internal identity");
 const good=await app.inject({method:"GET",url:"/api/v1/academy/courses",headers:{authorization:"Bearer "+validToken}});
 if(good.statusCode!==200) console.error("AUTH0_HTTP_CANARY_RESPONSE",good.statusCode,good.json());
 assert(good.statusCode===200,"Auth0 JWT -> Fastify -> PostgreSQL -> Academy route succeeds");
 const data=good.json().data;
 assert(data.some(c=>c.id===courseA),"Organisation A resource visible over HTTP");
 assert(!data.some(c=>c.id===courseB),"Organisation B resource hidden by RLS over HTTP");
 assert(observedContext.user_id===userA&&observedContext.org_id===orgA&&observedContext.db_role==="nabuuma_app","transaction context internal UUID + tenant + app role verified");
 assert(!String(observedContext.user_id).includes("auth0|"),"opaque external subject never enters app.user_id");
 const cross=await request(await token(subjectA,{[namespace+"/organisation_id"]:orgB,[namespace+"/roles"]:["LEARNER"]}));
 assert(cross.statusCode===401,"cross-tenant selector fails closed at HTTP");
 const elevated=await request(await token(subjectA,{[namespace+"/roles"]:["PLATFORM_ADMIN"]}));
 assert(elevated.statusCode===401,"signed role elevation rejected against DB role at HTTP");
 const unknown=await request(await token("auth0|unknown-http-user"));
 assert(unknown.statusCode===401,"unknown external identity rejected at HTTP");
 const wrongIssuer=await request(await new SignJWT({}).setProtectedHeader({alg:"RS256",kid}).setIssuer("https://mzfkamgfvxypakfkjdfs.supabase.co/auth/v1").setAudience(audience).setSubject(subjectA).setIssuedAt(now()).setExpirationTime(now()+120).sign(keys.privateKey));
 assert(wrongIssuer.statusCode===401,"target Auth0 verifier rejects Supabase issuer");
 const wrongAudience=await request(await new SignJWT({}).setProtectedHeader({alg:"RS256",kid}).setIssuer(issuer).setAudience("wrong-api").setSubject(subjectA).setIssuedAt(now()).setExpirationTime(now()+120).sign(keys.privateKey));
 assert(wrongAudience.statusCode===401,"wrong audience rejected");
 const expired=await request(await new SignJWT({}).setProtectedHeader({alg:"RS256",kid}).setIssuer(issuer).setAudience(audience).setSubject(subjectA).setIssuedAt(now()-200).setExpirationTime(now()-100).sign(keys.privateKey));
 assert(expired.statusCode===401,"expired token rejected");
 const unknownKid=await request(await new SignJWT({}).setProtectedHeader({alg:"RS256",kid:"unknown-kid"}).setIssuer(issuer).setAudience(audience).setSubject(subjectA).setIssuedAt(now()).setExpirationTime(now()+120).sign(keys.privateKey));
 assert(unknownKid.statusCode===401,"unknown KID rejected");
 const attacker=await generateKeyPair("RS256");
 const badSignature=await request(await new SignJWT({}).setProtectedHeader({alg:"RS256",kid}).setIssuer(issuer).setAudience(audience).setSubject(subjectA).setIssuedAt(now()).setExpirationTime(now()+120).sign(attacker.privateKey));
 assert(badSignature.statusCode===401,"invalid signature rejected");
 const missingSub=await request(await new SignJWT({}).setProtectedHeader({alg:"RS256",kid}).setIssuer(issuer).setAudience(audience).setIssuedAt(now()).setExpirationTime(now()+120).sign(keys.privateKey));
 assert(missingSub.statusCode===401,"missing subject rejected");
 console.log("AUTH0_HTTP_POSTGRES=PASS assertions="+assertions+" skipped=0");
}catch(e){console.error("AUTH0_HTTP_POSTGRES=FAIL assertions="+assertions);throw e;}
finally{
 await app.close();
 if(created){await admin.query("DELETE FROM nabuuma.external_identities WHERE user_id=ANY($1::uuid[])",[[userA,userB]]).catch(()=>{});await admin.query("DELETE FROM nabuuma.academy_courses WHERE id=ANY($1::uuid[])",[[courseA,courseB]]).catch(()=>{});await admin.query("DELETE FROM nabuuma.organisation_memberships WHERE user_id=ANY($1::uuid[])",[[userA,userB]]).catch(()=>{});await admin.query("DELETE FROM nabuuma.users WHERE id=ANY($1::uuid[])",[[userA,userB]]).catch(()=>{});await admin.query("DELETE FROM nabuuma.organisations WHERE id=ANY($1::uuid[])",[[orgA,orgB]]).catch(()=>{});}
 await runtime.end();await admin.end();
}
