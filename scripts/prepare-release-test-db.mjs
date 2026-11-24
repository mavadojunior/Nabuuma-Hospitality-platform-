import {
  randomBytes,
} from "node:crypto";

import {
  chmod,
  mkdir,
  writeFile,
} from "node:fs/promises";

import {
  dirname,
  resolve,
} from "node:path";

import {
  Pool,
} from "pg";

import {
  releaseTestDbEnv,
} from "./lib-release-test-db-env.mjs";

const runtimeRole = "nabuuma_runtime";
const applicationRole = "nabuuma_app";

function requireDisposableAdminUrl(
  rawUrl,
) {
  if (
    process.env
      .NABUUMA_DISPOSABLE_TEST_DATABASE !==
    "1"
  ) {
    throw new Error(
      "Release DB preparation requires explicit disposable-target acknowledgement.",
    );
  }

  let url;

  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error(
      "Release DB preparation admin URL is malformed.",
    );
  }

  if (
    ![
      "postgres:",
      "postgresql:",
    ].includes(url.protocol)
  ) {
    throw new Error(
      "Release DB preparation requires PostgreSQL.",
    );
  }

  const host =
    url.hostname.toLowerCase();

  const port =
    url.port || "5432";

  const database =
    decodeURIComponent(
      url.pathname.replace(/^\//, ""),
    );

  const username =
    decodeURIComponent(url.username);

  if (
    ![
      "localhost",
      "127.0.0.1",
      "::1",
    ].includes(host)
  ) {
    throw new Error(
      "Release DB preparation refuses non-local targets.",
    );
  }

  if (
    port === "55433" ||
    !/(test|disposable|drill|recovery)/i.test(
      database,
    )
  ) {
    throw new Error(
      "Release DB preparation refuses protected or non-disposable targets.",
    );
  }

  if (!username || !database) {
    throw new Error(
      "Release DB preparation requires an administrative username and database.",
    );
  }

  return {
    url,
    host,
    port,
    database,
    username,
  };
}

function runtimeDatabaseUrl(
  admin,
  password,
) {
  const runtime =
    new URL(admin.url.toString());

  runtime.username =
    runtimeRole;

  runtime.password =
    password;

  return runtime.toString();
}

function shellQuote(
  value,
) {
  return `'${value.replaceAll(
    "'",
    "'\\''",
  )}'`;
}

function serialiseEnvironment(
  env,
) {
  const names = [
    "NABUUMA_TEST_DATABASE_URL",
    "NABUUMA_AUTH0_DISPOSABLE_DATABASE_URL",
    "NABUUMA_DISPOSABLE_TEST_DATABASE",
    "NABUUMA_TEST_ADMIN_USER",
    "RUN_RLS_INTEGRATION",
    "NABUUMA_RELEASE_ARTIFACT_DIR",
    "PGHOST",
    "PGPORT",
    "PGDATABASE",
    "PGUSER",
    "PGPASSWORD",
  ];

  return `${names
    .map((name) => {
      const value =
        env[name] ?? "";

      return `${name}=${shellQuote(
        value,
      )}`;
    })
    .join("\n")}\n`;
}

async function prepare() {
  const adminUrl =
    process.env
      .NABUUMA_RELEASE_ADMIN_DATABASE_URL;

  if (!adminUrl) {
    throw new Error(
      "NABUUMA_RELEASE_ADMIN_DATABASE_URL is required.",
    );
  }

  const admin =
    requireDisposableAdminUrl(
      adminUrl,
    );

  const password =
    randomBytes(32).toString("hex");

  const pool =
    new Pool({
      connectionString:
        admin.url.toString(),
      max: 1,
      connectionTimeoutMillis: 5000,
      idleTimeoutMillis: 1000,
    });

  try {
    const client =
      await pool.connect();

    try {
      const identity =
        await client.query(
          `
            SELECT
              current_database() AS database,
              current_user AS username,
              current_setting('port') AS port
          `,
        );

      const row =
        identity.rows[0];

      if (
        !row ||
        row.database !==
          admin.database ||
        String(row.port) !==
          admin.port
      ) {
        throw new Error(
          "Administrative database identity does not match the requested disposable target.",
        );
      }

      const roles =
        await client.query(
          `
            SELECT
              rolname,
              rolcanlogin,
              rolinherit,
              rolsuper,
              rolcreatedb,
              rolcreaterole,
              rolreplication,
              rolbypassrls
            FROM pg_catalog.pg_roles
            WHERE rolname IN (
              $1,
              $2
            )
            ORDER BY rolname
          `,
          [
            applicationRole,
            runtimeRole,
          ],
        );

      const byName =
        new Map(
          roles.rows.map(
            (role) => [
              role.rolname,
              role,
            ],
          ),
        );

      const app =
        byName.get(
          applicationRole,
        );

      const runtime =
        byName.get(runtimeRole);

      if (!app || !runtime) {
        throw new Error(
          "Canonical migrations must create nabuuma_app and bootstrap must provide nabuuma_runtime before release DB preparation.",
        );
      }

      if (
        runtime.rolsuper ||
        runtime.rolbypassrls ||
        runtime.rolinherit ||
        runtime.rolcreatedb ||
        runtime.rolcreaterole ||
        runtime.rolreplication
      ) {
        throw new Error(
          "Refusing unsafe nabuuma_runtime role state.",
        );
      }

      const passwordStatement =
        await client.query(
          `
            SELECT pg_catalog.format(
              'ALTER ROLE %I LOGIN NOINHERIT NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION PASSWORD %L',
              $1::text,
              $2::text
            ) AS statement
          `,
          [
            runtimeRole,
            password,
          ],
        );

      const statement =
        passwordStatement.rows[0]
          ?.statement;

      if (
        typeof statement !== "string" ||
        statement.length === 0
      ) {
        throw new Error(
          "Failed to construct the disposable runtime-role statement.",
        );
      }

      await client.query(statement);

      await client.query(
        `
          GRANT nabuuma_app
          TO nabuuma_runtime
        `,
      );

      const verification =
        await client.query(
          `
            SELECT
              runtime.rolcanlogin,
              runtime.rolinherit,
              runtime.rolsuper,
              runtime.rolcreatedb,
              runtime.rolcreaterole,
              runtime.rolreplication,
              runtime.rolbypassrls,
              pg_catalog.pg_has_role(
                $1,
                $2,
                'MEMBER'
              ) AS application_member
            FROM pg_catalog.pg_roles
              AS runtime
            WHERE runtime.rolname = $1
          `,
          [
            runtimeRole,
            applicationRole,
          ],
        );

      const verified =
        verification.rows[0];

      if (
        !verified ||
        !verified.rolcanlogin ||
        verified.rolinherit ||
        verified.rolsuper ||
        verified.rolcreatedb ||
        verified.rolcreaterole ||
        verified.rolreplication ||
        verified.rolbypassrls ||
        !verified.application_member
      ) {
        throw new Error(
          "Disposable runtime role did not satisfy the restricted release contract.",
        );
      }
    } finally {
      client.release();
    }
  } finally {
    await pool.end();
  }

  const runtimeUrl =
    runtimeDatabaseUrl(
      admin,
      password,
    );

  const baseEnv = {
    NABUUMA_AUTH0_DISPOSABLE_DATABASE_URL:
      runtimeUrl,

    NABUUMA_DISPOSABLE_TEST_DATABASE:
      "1",

    RUN_RLS_INTEGRATION:
      "1",

    NABUUMA_RELEASE_ARTIFACT_DIR:
      resolve(
        ".artifacts/release-test",
      ),
  };

  const releaseEnv =
    releaseTestDbEnv(
      {
        adminDatabaseUrl:
          admin.url.toString(),

        runtimeDatabaseUrl:
          runtimeUrl,
      },
      baseEnv,
    );

  const outputPath =
    resolve(
      process.env
        .NABUUMA_RELEASE_ENV_FILE ??
        ".artifacts/release-test/canonical-db.env",
    );

  await mkdir(
    dirname(outputPath),
    {
      recursive: true,
      mode: 0o700,
    },
  );

  await writeFile(
    outputPath,
    serialiseEnvironment(
      releaseEnv,
    ),
    {
      encoding: "utf8",
      mode: 0o600,
    },
  );

  await chmod(
    outputPath,
    0o600,
  );

  console.log(
    "RELEASE_TEST_DB_PREPARED",
  );

  console.log(
    `host=${admin.host}`,
  );

  console.log(
    `port=${admin.port}`,
  );

  console.log(
    `database=${admin.database}`,
  );

  console.log(
    `adminUser=${admin.username}`,
  );

  console.log(
    `runtimeUser=${runtimeRole}`,
  );

  console.log(
    `envFile=${outputPath}`,
  );
}

prepare().catch(
  (error) => {
    console.error(
      error instanceof Error
        ? error.message
        : String(error),
    );

    process.exitCode = 1;
  },
);
