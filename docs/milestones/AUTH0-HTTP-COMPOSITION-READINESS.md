# Auth0 Source Readiness: HTTP + Disposable PostgreSQL

## Evidence
- The new `scripts/test-auth0-http-postgres.mjs` test connects only to `127.0.0.1:55434/nabuuma_auth0_test` and refuses other targets.
- Synthetic RSA RS256/JWKS, Auth0 issuer/audience, Fastify Academy courses route, `Auth0RequestAuthenticator`, `ExternalIdentityResolver`, real `PgExternalIdentityRepository`, `resolve_external_identity`, real `PgTransactionManager` and tenant-scoped `PgAcademyRepository` exercised.
- A -> internal UUID, Organisation A and persisted LEARNER role verified. `SET LOCAL ROLE nabuuma_app` and transaction-local `app.user_id` / `app.organisation_id` observed through actual HTTP transaction.
- A resource visible; B resource absent. Tenant selector B, role assertion PLATFORM_ADMIN, unknown identity, Supabase issuer, wrong audience, expiry, unknown KID, invalid signature, missing subject all rejected.
- `AUTH0_HTTP_POSTGRES=PASS assertions=14 skipped=0`.

## Provider composition
- `AUTH_PROVIDER` typed as `SUPABASE | AUTH0`; default remains SUPABASE.
- Supabase constructs existing `BearerRequestAuthenticator` path.
- Auth0 constructs `Auth0RequestAuthenticator -> ExternalIdentityResolver -> PgExternalIdentityRepository`.
- Invalid selector fails closed. Both paths require issuer/audience/JWKS config. Provider-specific configuration test suite: 7 files, 72 passed, 0 failed, 0 skipped (Auth0 HTTP synthetic, resolver, verifier, bearer, transaction, migration config, provider config).

## Proposed cutover delta (NOT APPLIED)
`AUTH_PROVIDER=AUTH0`
`AUTH_JWT_ISSUER=https://dev-lhgi27ewkdcqtyek.us.auth0.com/`
`AUTH_JWT_AUDIENCE=https://api.nabuuma.com`
`AUTH_JWKS_URI=https://dev-lhgi27ewkdcqtyek.us.auth0.com/.well-known/jwks.json`

## Rollback (NOT EXECUTED)
Restore the previous authentication-provider configuration and its matching issuer/audience/JWKS values; restart canonical runtime and verify health/authenticated requests. Do not include previous private values in this document.

## Limits
This is isolated source-readiness evidence, not a live cutover. Runtime private config and approved database are unchanged. Migration 00020 real-target remains blocked by unavailable approved migration authority. Audit reconciliation/00022 deferred. EAS unavailable and not retried. No commits, pushes, tags, deployment or publication.


## Runtime composition gate — final

`createRuntime()` now delegates provider selection to `createRuntimeAuthenticator(authConfig, pool, factories)`, the composition boundary tested directly.

- SUPABASE constructs `BearerRequestAuthenticator` with the configured verifier. The test invokes the verifier and proves no identity resolver repository query is required.
- AUTH0 constructs `Auth0RequestAuthenticator`, `ExternalIdentityResolver`, and `PgExternalIdentityRepository` bound to the exact runtime pool. The test verifies the resolver SQL call and provider/subject arguments and the DB-derived internal principal.
- Provider selection is at startup. The selected verifier is the only verifier used; test proves Supabase rejection does not fall through to Auth0.
- `AUTH_PROVIDER` omitted is backward-compatible SUPABASE default, explicitly tested. JWT issuer, audience and JWKS are still required. Unknown provider/missing config fail closed.

Test evidence: runtime composition 4/4 passed; provider config 8/8 passed. Combined auth targeted suite: 6 files, 67 passed, 0 failed, 0 skipped. Latest focused config+composition: 2 files, 12 passed, 0 failed, 0 skipped. Typecheck/build/ESM/diff all PASS. Secret-pattern scan scoped to changed runtime/config/test/docs files had no matches.

`AUTH0_CUTOVER_READY = YES` means source-readiness only. `LIVE_AUTH0_CUTOVER = NOT EXECUTED`.

Proposed cutover delta (not applied): `AUTH_PROVIDER=AUTH0`, issuer `https://dev-lhgi27ewkdcqtyek.us.auth0.com/`, audience `https://api.nabuuma.com`, JWKS `https://dev-lhgi27ewkdcqtyek.us.auth0.com/.well-known/jwks.json`.

Rollback: restore previous provider/auth config from secure backup, restart canonical runtime, verify `/health/live`, `/health/ready`, and restored-provider authenticated canary.

Later live acceptance (not executed): verify Auth0 tenant and required role Action; map controlled subject; backup runtime config securely; apply provider/issuer/audience/JWKS; restart; health live/ready; real Auth0 API token accepted; unknown subject/wrong audience/old Supabase token rejected; cross-tenant request denied. Roll back immediately if any critical canary fails.

Unchanged: private runtime.env, approved DB port 55433, migration 00020 blocker, audit candidate 00022 deferred, EAS blocked. No commit/push/tag/deploy/cutover.
