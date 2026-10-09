import type { Pool, PoolClient } from "pg";
import {
  createSecurityContext,
  type SecurityContext,
  type TokenClaims,
} from "../security/security";

export interface PgExecutionContext {
  readonly client: PoolClient;
  readonly security: SecurityContext;
  readonly claims: TokenClaims;
  readonly organisationId: string;
}

type SecurityInput = SecurityContext | TokenClaims;

export class PgTransactionManager {
  constructor(private readonly pool: Pool) {}

  async withTransaction<T>(
    security: SecurityInput,
    work: (context: PgExecutionContext) => Promise<T>,
  ): Promise<T> {
    const client = await this.pool.connect();
    let transactionStarted = false;

    const runtimeSecurity: SecurityContext =
      "claims" in security ? security : createSecurityContext(security, "request");

    try {
      await client.query("BEGIN");
      transactionStarted = true;
      await client.query("SET LOCAL ROLE nabuuma_app");

      await client.query(
        `
          SELECT
            set_config('app.user_id', $1, true),
            set_config('app.organisation_id', $2, true)
        `,
        [runtimeSecurity.claims.subject, runtimeSecurity.claims.organisationId],
      );

      const context: PgExecutionContext = {
        client,
        security: runtimeSecurity,
        claims: runtimeSecurity.claims,
        organisationId: runtimeSecurity.claims.organisationId,
      };

      const result = await work(context);

      await client.query("COMMIT");
      transactionStarted = false;

      return result;
    } catch (error) {
      if (transactionStarted) {
        try {
          await client.query("ROLLBACK");
        } catch {
          // Preserve the original failure. The connection is still released.
        }
      }

      throw error;
    } finally {
      client.release();
    }
  }
}
