import type { Pool } from "pg";

export interface CustomAccessTokenEvent {
  readonly user_id: string;
  readonly authentication_method: string;
  readonly claims: Readonly<Record<string, unknown>>;
}

export interface CustomAccessTokenResult {
  readonly claims: Readonly<Record<string, unknown>>;
}

interface CustomAccessTokenRow {
  readonly result: unknown;
}

export class AccessTokenClaimResolutionError extends Error {
  public constructor() {
    super("Access-token claims could not be resolved.");
    this.name = "AccessTokenClaimResolutionError";
  }
}

function isRecord(
  value: unknown,
): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value)
  );
}

export class PgAccessTokenClaimsResolver {
  public constructor(private readonly pool: Pool) {}

  public async resolve(
    event: CustomAccessTokenEvent,
  ): Promise<CustomAccessTokenResult> {
    const client = await this.pool.connect();

    try {
      const result =
        await client.query<CustomAccessTokenRow>(
          `
            SELECT
              nabuuma.custom_access_token_hook(
                $1::jsonb
              ) AS result
          `,
          [JSON.stringify(event)],
        );

      const payload = result.rows[0]?.result;

      if (
        !isRecord(payload) ||
        !isRecord(payload.claims)
      ) {
        throw new AccessTokenClaimResolutionError();
      }

      return {
        claims: payload.claims,
      };
    } finally {
      client.release();
    }
  }
}
