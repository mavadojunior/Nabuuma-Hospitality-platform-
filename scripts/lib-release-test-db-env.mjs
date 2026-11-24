const protectedPorts = new Set(["55433"]);

const localHosts = new Set([
  "localhost",
  "127.0.0.1",
  "::1",
]);

function parseDisposableUrl(
  rawUrl,
  label,
) {
  let url;

  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error(
      `${label} is malformed.`,
    );
  }

  if (
    ![
      "postgres:",
      "postgresql:",
    ].includes(url.protocol)
  ) {
    throw new Error(
      `${label} must use PostgreSQL scheme.`,
    );
  }

  const hostname =
    url.hostname.toLowerCase();

  const port =
    url.port || "5432";

  const database =
    decodeURIComponent(
      url.pathname.replace(/^\//, ""),
    );

  const username =
    decodeURIComponent(url.username);

  const password =
    decodeURIComponent(url.password);

  if (!localHosts.has(hostname)) {
    throw new Error(
      `${label} refuses non-local target.`,
    );
  }

  if (
    protectedPorts.has(port) ||
    !/(test|disposable|drill|recovery)/i.test(
      database,
    )
  ) {
    throw new Error(
      `${label} refuses protected or non-disposable target.`,
    );
  }

  if (!username || !database) {
    throw new Error(
      `${label} requires username and database.`,
    );
  }

  return {
    rawUrl: url.toString(),
    hostname,
    port,
    database,
    username,
    password,
  };
}

export function releaseTestDbEnv(
  {
    adminDatabaseUrl,
    runtimeDatabaseUrl,
  },
  baseEnv = process.env,
) {
  const admin =
    parseDisposableUrl(
      adminDatabaseUrl,
      "Canonical release admin database URL",
    );

  const runtime =
    parseDisposableUrl(
      runtimeDatabaseUrl,
      "Canonical release runtime database URL",
    );

  if (
    admin.hostname !== runtime.hostname ||
    admin.port !== runtime.port ||
    admin.database !== runtime.database
  ) {
    throw new Error(
      "Release admin and runtime database URLs must target the same disposable database.",
    );
  }

  if (
    runtime.username !==
    "nabuuma_runtime"
  ) {
    throw new Error(
      "Canonical release runtime database URL must use nabuuma_runtime.",
    );
  }

  if (
    admin.username ===
    "nabuuma_runtime"
  ) {
    throw new Error(
      "Canonical release admin database URL must not use nabuuma_runtime.",
    );
  }

  if (!runtime.password) {
    throw new Error(
      "Canonical release runtime database URL requires an ephemeral runtime credential.",
    );
  }

  return {
    ...baseEnv,

    NABUUMA_TEST_DATABASE_URL:
      runtime.rawUrl,

    NABUUMA_TEST_ADMIN_USER:
      admin.username,

    NABUUMA_DISPOSABLE_TEST_DATABASE:
      "1",

    PGHOST:
      admin.hostname,

    PGPORT:
      admin.port,

    PGDATABASE:
      admin.database,

    PGUSER:
      admin.username,

    PGPASSWORD:
      admin.password,
  };
}
