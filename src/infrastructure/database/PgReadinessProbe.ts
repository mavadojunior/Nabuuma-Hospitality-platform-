import type { Pool } from "pg";
import type {
  ReadinessProbe,
} from "../../interfaces/http/health-routes";

export class PgReadinessProbe implements ReadinessProbe {
  constructor(private readonly pool: Pool) {}

  async isReady(): Promise<boolean> {
    let client;

    try {
      client = await this.pool.connect();

      const result = await client.query<{
        ready: number;
      }>("SELECT 1 AS ready");

      return result.rows[0]?.ready === 1;
    } catch {
      return false;
    } finally {
      client?.release();
    }
  }
}
