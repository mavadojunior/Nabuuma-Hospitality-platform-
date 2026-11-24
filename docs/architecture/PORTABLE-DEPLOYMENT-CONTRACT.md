# Portable Deployment Contract

- Node.js 22 LTS-compatible runtime; Fastify 5; ESM/NodeNext; production dependencies from lockfile via npm ci.
- PostgreSQL 16+; current rehearsal PostgreSQL 18.2; pgcrypto; transactions, custom settings, RLS/FORCE RLS, partitioning, SECURITY DEFINER, role ownership/membership and SET ROLE.
- Provider validation: scripts/probe-postgres-provider.mjs; disposable target and explicit acknowledgement required.
- Auth0/OIDC issuer/JWKS/audience; HTTPS; validate signature, issuer, audience, algorithm and time claims.
- TLS at maintained reverse proxy; backend private; DB not publicly exposed; forwarded headers trusted only from proxy.
- Private environment injection; no credentials in image, repository, logs or clients.
- Liveness /health/live; readiness /health/ready.
- Structured logs; no tokens, connection strings or learner PII.
- Graceful SIGTERM, restart policy, bounded shutdown and health-gated deployment.
- Never auto-run migrations at container startup.
- Independent backups, retention, checksum and restore test before real data.
- Provisional planning floor: 1 vCPU/1 GB RAM for API plus proxy/OS overhead; not measured sizing.
- Provider-neutral application code; no provider SDK required for core API.
