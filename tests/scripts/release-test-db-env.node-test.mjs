import {
  describe,
  it,
} from "node:test";

import assert from "node:assert/strict";

import {
  releaseTestDbEnv,
} from "../../scripts/lib-release-test-db-env.mjs";

describe(
  "release test DB environment adapter",
  () => {
    it(
      "separates the administrative and restricted runtime identities",
      () => {
        const env =
          releaseTestDbEnv(
            {
              adminDatabaseUrl:
                "postgresql://fixture-admin:admin-secret@127.0.0.1:55445/nabuuma_rls_test",
              runtimeDatabaseUrl:
                "postgresql://nabuuma_runtime:runtime-secret@127.0.0.1:55445/nabuuma_rls_test",
            },
            {},
          );

        assert.equal(
          env.NABUUMA_TEST_DATABASE_URL,
          "postgresql://nabuuma_runtime:runtime-secret@127.0.0.1:55445/nabuuma_rls_test",
        );

        assert.equal(
          env.NABUUMA_TEST_ADMIN_USER,
          "fixture-admin",
        );

        assert.equal(
          env.NABUUMA_DISPOSABLE_TEST_DATABASE,
          "1",
        );

        assert.deepEqual(
          [
            env.PGHOST,
            env.PGPORT,
            env.PGDATABASE,
            env.PGUSER,
            env.PGPASSWORD,
          ],
          [
            "127.0.0.1",
            "55445",
            "nabuuma_rls_test",
            "fixture-admin",
            "admin-secret",
          ],
        );
      },
    );

    it(
      "refuses the protected approved port for either identity",
      () => {
        assert.throws(
          () =>
            releaseTestDbEnv(
              {
                adminDatabaseUrl:
                  "postgresql://fixture-admin:admin-secret@127.0.0.1:55433/nabuuma_rls_test",
                runtimeDatabaseUrl:
                  "postgresql://nabuuma_runtime:runtime-secret@127.0.0.1:55433/nabuuma_rls_test",
              },
              {},
            ),
        );
      },
    );

    it(
      "requires both identities to target the same disposable database",
      () => {
        assert.throws(
          () =>
            releaseTestDbEnv(
              {
                adminDatabaseUrl:
                  "postgresql://fixture-admin:admin-secret@127.0.0.1:55445/nabuuma_rls_test",
                runtimeDatabaseUrl:
                  "postgresql://nabuuma_runtime:runtime-secret@127.0.0.1:55446/nabuuma_rls_test",
              },
              {},
            ),
        );

        assert.throws(
          () =>
            releaseTestDbEnv(
              {
                adminDatabaseUrl:
                  "postgresql://fixture-admin:admin-secret@127.0.0.1:55445/nabuuma_disposable_test",
                runtimeDatabaseUrl:
                  "postgresql://nabuuma_runtime:runtime-secret@127.0.0.1:55445/other_disposable_test",
              },
              {},
            ),
        );
      },
    );

    it(
      "requires the restricted runtime identity",
      () => {
        assert.throws(
          () =>
            releaseTestDbEnv(
              {
                adminDatabaseUrl:
                  "postgresql://fixture-admin:admin-secret@127.0.0.1:55445/nabuuma_rls_test",
                runtimeDatabaseUrl:
                  "postgresql://fixture-admin:runtime-secret@127.0.0.1:55445/nabuuma_rls_test",
              },
              {},
            ),
        );
      },
    );

    it(
      "refuses nabuuma_runtime as the fixture administrator",
      () => {
        assert.throws(
          () =>
            releaseTestDbEnv(
              {
                adminDatabaseUrl:
                  "postgresql://nabuuma_runtime:admin-secret@127.0.0.1:55445/nabuuma_rls_test",
                runtimeDatabaseUrl:
                  "postgresql://nabuuma_runtime:runtime-secret@127.0.0.1:55445/nabuuma_rls_test",
              },
              {},
            ),
        );
      },
    );

    it(
      "requires an ephemeral runtime credential",
      () => {
        assert.throws(
          () =>
            releaseTestDbEnv(
              {
                adminDatabaseUrl:
                  "postgresql://fixture-admin:admin-secret@127.0.0.1:55445/nabuuma_rls_test",
                runtimeDatabaseUrl:
                  "postgresql://nabuuma_runtime@127.0.0.1:55445/nabuuma_rls_test",
              },
              {},
            ),
        );
      },
    );

    it(
      "rejects malformed and protected URLs without leaking credentials",
      () => {
        assert.throws(
          () =>
            releaseTestDbEnv(
              {
                adminDatabaseUrl:
                  "invalid",
                runtimeDatabaseUrl:
                  "postgresql://nabuuma_runtime:runtime-secret@127.0.0.1:55445/nabuuma_rls_test",
              },
              {},
            ),
        );

        assert.throws(
          () =>
            releaseTestDbEnv(
              {
                adminDatabaseUrl:
                  "postgresql://secret-user:secret-pass@127.0.0.1:55433/nabuuma_rls_test",
                runtimeDatabaseUrl:
                  "postgresql://nabuuma_runtime:runtime-secret@127.0.0.1:55433/nabuuma_rls_test",
              },
              {},
            ),
          (error) =>
            error instanceof Error &&
            !error.message.includes(
              "secret-user",
            ) &&
            !error.message.includes(
              "secret-pass",
            ) &&
            !error.message.includes(
              "runtime-secret",
            ),
        );
      },
    );
  },
);
