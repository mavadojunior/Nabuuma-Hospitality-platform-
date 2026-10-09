import type { Pool, PoolClient } from "pg";
import type { TokenClaims } from "../security/security";

export interface PgExecutionContext {
  readonly client: PoolClient;
  readonly claims: TokenClaims;
  readonly organisationId: string;
}

export class PgTransactionManager {
  constructor(private readonly pool: Pool) {}

  async withTransaction<T>(
    claims: TokenClaims,
    work: (context: PgExecutionContext) => Promise<T>,
  ): Promise<T> {
    const client = await this.pool.connect();
    let transactionStarted = false;

    try {
      await client.query("BEGIN");
      transactionStarted = true;
      await client.query("SET LOCAL ROLE nabuuma_app");

      /*
       * The RLS helper functions in 00001_init_competency_telemetry.sql
       * read app.user_id and app.organisation_id.
       *
       * set_config(..., true) is transaction-local, so these values cannot
       * leak to the next tenant/user using the pooled connection.
       */
      await client.query(
        `
          SELECT
            set_config('app.user_id', $1, true),
            set_config('app.organisation_id', $2, true)
        `,
        [claims.subject, claims.organisationId],
      );

      const context: PgExecutionContext = {
        client,
        claims,
        organisationId: claims.organisationId,
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
