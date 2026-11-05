import {
  afterAll,
  beforeAll,
  describe,
  expect,
  it,
} from "vitest";
import {
  Pool,
  type PoolClient,
} from "pg";

import {
  PgTransactionManager,
} from "../src/infrastructure/database/transaction.js";
import type {
  TokenClaims,
} from "../src/infrastructure/security/security.js";

interface SessionState {
  readonly backend_pid: number;
  readonly current_role: string;
  readonly user_id: string | null;
  readonly organisation_id: string | null;
}

const databaseUrl =
  process.env.NABUUMA_TEST_DATABASE_URL;

const allowedDatabases = new Set([
  "nabuuma_test",
  "nabuuma_rls_test",
]);

const claims = {
  subject:
    "11111111-1111-4111-8111-111111111111",
  organisationId:
    "22222222-2222-4222-8222-222222222222",
} as TokenClaims;

function validateDatabaseUrl(value: string): void {
  const url = new URL(value);
  const host =
    url.hostname.replace(/^\[|\]$/g, "");
  const database = decodeURIComponent(
    url.pathname.replace(/^\//, ""),
  );

  if (
    !["postgres:", "postgresql:"].includes(
      url.protocol,
    )
  ) {
    throw new Error(
      "Test database URL must use PostgreSQL.",
    );
  }

  if (
    ![
      "localhost",
      "127.0.0.1",
      "::1",
    ].includes(host)
  ) {
    throw new Error(
      "Integration tests may connect only to localhost.",
    );
  }

  if (url.port !== "55433") {
    throw new Error(
      "Integration tests require PostgreSQL port 55433.",
    );
  }

  if (!allowedDatabases.has(database)) {
    throw new Error(
      "Database is not on the integration-test allowlist.",
    );
  }
}

async function sessionState(
  client: Pool | PoolClient,
): Promise<SessionState> {
  const result = await client.query<SessionState>(
    `
      SELECT
        pg_backend_pid()::integer AS backend_pid,
        current_user AS current_role,
        NULLIF(
          current_setting('app.user_id', true),
          ''
        ) AS user_id,
        NULLIF(
          current_setting(
            'app.organisation_id',
            true
          ),
          ''
        ) AS organisation_id
    `,
  );

  const state = result.rows[0];

  if (!state) {
    throw new Error(
      "PostgreSQL session state was not returned.",
    );
  }

  return state;
}

const suite = describe.skipIf(!databaseUrl)(
  "PgTransactionManager pool isolation",
  () => {
    let pool: Pool;
    let manager: PgTransactionManager;
    let loginRole: string;

    beforeAll(async () => {
      if (!databaseUrl) {
        throw new Error(
          "Test database URL is missing.",
        );
      }

      validateDatabaseUrl(databaseUrl);

      /*
       * max: 1 forces commit and rollback checks to reuse
       * the same physical PostgreSQL connection.
       */
      pool = new Pool({
        connectionString: databaseUrl,
        max: 1,
        connectionTimeoutMillis: 5000,
        idleTimeoutMillis: 1000,
      });

      manager = new PgTransactionManager(pool);

      const initial = await sessionState(pool);
      loginRole = initial.current_role;
    });

    afterAll(async () => {
      await pool?.end();
    });

    it("clears transaction-local role and RLS context after commit on a reused max: 1 connection", async () => {
      const transactionState =
        await manager.withTransaction(
          claims,
          async ({ client }) =>
            sessionState(client),
        );

      expect(
        transactionState.current_role,
      ).toBe("nabuuma_app");
      expect(transactionState.user_id).toBe(
        claims.subject,
      );
      expect(
        transactionState.organisation_id,
      ).toBe(claims.organisationId);

      const reusedState =
        await sessionState(pool);

      expect(reusedState.backend_pid).toBe(
        transactionState.backend_pid,
      );
      expect(reusedState.current_role).toBe(
        loginRole,
      );
      expect(reusedState.user_id).toBeNull();
      expect(
        reusedState.organisation_id,
      ).toBeNull();
    });

    it("clears transaction-local role and RLS context after rollback on a reused max: 1 connection", async () => {
      const failure = new Error(
        "force transaction rollback",
      );

      let transactionState:
        | SessionState
        | undefined;

      await expect(
        manager.withTransaction(
          claims,
          async ({ client }) => {
            transactionState =
              await sessionState(client);

            throw failure;
          },
        ),
      ).rejects.toBe(failure);

      expect(transactionState).toBeDefined();
      expect(
        transactionState?.current_role,
      ).toBe("nabuuma_app");
      expect(transactionState?.user_id).toBe(
        claims.subject,
      );
      expect(
        transactionState?.organisation_id,
      ).toBe(claims.organisationId);

      const reusedState =
        await sessionState(pool);

      expect(reusedState.backend_pid).toBe(
        transactionState?.backend_pid,
      );
      expect(reusedState.current_role).toBe(
        loginRole,
      );
      expect(reusedState.user_id).toBeNull();
      expect(
        reusedState.organisation_id,
      ).toBeNull();
    });
  },
);

void suite;
