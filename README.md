# Nabuuma-Hospitality-platform-
Competency-driven hospitality learning platform for technical knowledge, practical training, measurement, assessment, and professional development.

## Project Status

![Node.js](https://img.shields.io/badge/Node.js-Native_ESM-339933?logo=nodedotjs&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-Strict-3178C6?logo=typescript&logoColor=white)
![Fastify](https://img.shields.io/badge/Fastify-5-000000?logo=fastify&logoColor=white)
![PostgreSQL RLS](https://img.shields.io/badge/PostgreSQL-RLS-4169E1?logo=postgresql&logoColor=white)
![JWT Authentication](https://img.shields.io/badge/Auth-JWT-6C47FF?logo=jsonwebtokens&logoColor=white)
![MCP](https://img.shields.io/badge/MCP-Streamable_HTTP-6B46C1)
![Security Tests](https://img.shields.io/badge/Security_Tests-212_Passing-2EA44F)
![Skipped Tests](https://img.shields.io/badge/Release_Skips-0-2EA44F)
![Native ESM](https://img.shields.io/badge/Native_ESM-Verified-2EA44F)
![Tenant Isolation](https://img.shields.io/badge/Tenant_Isolation-RLS_Enforced-2EA44F)

### Verified Release Evidence

- **DB-enabled release security suite:** 212 passed, 0 failed, 0 skipped
- **Database integrations:** DB-enabled release suite verified with 212 passed, 0 failed, 0 skipped
- **MCP HTTP transport:** 10/10 passing
- **MCP JWT authentication:** 8/8 passing
- **Focused MCP validation:** 16/16 passing
- **TypeScript strict typecheck:** PASS
- **Production build:** PASS
- **Native Node.js ESM:** 69 modules / 92 relative imports verified
- **PostgreSQL RLS:** restricted non-owner execution verified
- **Pool isolation:** COMMIT and ROLLBACK context cleanup verified
- **Restricted TCP runtime:** PASS
- **`GET /health/live`:** HTTP 200
- **`GET /health/ready`:** HTTP 200
- **Unauthenticated `POST /mcp`:** HTTP 401
- **Malformed bearer `POST /mcp`:** HTTP 401
- **Graceful shutdown:** first-SIGTERM exit 0, database pool drained, process reaped; active keep-alive socket drain not separately asserted
- **Positive MCP identity:** hermetic RS256 JWT to MCP to PostgreSQL/RLS path verified 5/5; live external IdP bearer unavailable
