import { Pool, type PoolConfig } from "pg";

/**
 * Production PostgreSQL pool with explicit ownership and shutdown state.
 */
let activePool: Pool | null = null;
let poolClosePromise: Promise<void> | null = null;

function parseStrictInteger(
  value: string | undefined,
  fallback: string,
  name: string,
  minimum: number,
  maximum: number,
): number {
  const candidate = value ?? fallback;

  if (!/^[0-9]+$/.test(candidate)) {
    throw new Error(`${name} must be an integer.`);
  }

  const parsed = Number(candidate);
  if (
    !Number.isSafeInteger(parsed) ||
    parsed < minimum ||
    parsed > maximum
  ) {
    throw new Error(
      `${name} must be between ${minimum} and ${maximum}.`,
    );
  }

  return parsed;
}

/**
 * Parse and validate configuration without creating a Pool.
 * Exported to make configuration validation independently testable.
 */
export function parseDatabaseConfig(
  environment: NodeJS.ProcessEnv = process.env,
): PoolConfig {
  const databaseUrl = environment.DATABASE_URL?.trim();

  if (!databaseUrl) {
    throw new Error(
      "DATABASE_URL environment variable is required.",
    );
  }

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(databaseUrl);
  } catch {
    throw new Error("DATABASE_URL must be a valid URL.");
  }

  if (
    parsedUrl.protocol !== "postgres:" &&
    parsedUrl.protocol !== "postgresql:"
  ) {
    throw new Error(
      "DATABASE_URL must use the postgres or postgresql protocol.",
    );
  }

  const maxConnections = parseStrictInteger(
    environment.DB_MAX_CONNECTIONS,
    "20",
    "DB_MAX_CONNECTIONS",
    1,
    100,
  );
  const idleTimeoutMs = parseStrictInteger(
    environment.DB_IDLE_TIMEOUT_MS,
    "30000",
    "DB_IDLE_TIMEOUT_MS",
    1000,
    600000,
  );
  const connectionTimeoutMs = parseStrictInteger(
    environment.DB_CONNECTION_TIMEOUT_MS,
    "5000",
    "DB_CONNECTION_TIMEOUT_MS",
    1000,
    60000,
  );

  return {
    connectionString: databaseUrl,
    max: maxConnections,
    idleTimeoutMillis: idleTimeoutMs,
    connectionTimeoutMillis: connectionTimeoutMs,
    allowExitOnIdle: false,
  };
}

/**
 * Initialize the singleton pool. Initialization is synchronous; connectivity
 * must be established by the startup readiness probe.
 */
export function initializeDatabasePool(): Pool {
  if (poolClosePromise) {
    throw new Error(
      "[DB] Database pool is shutting down. Initialization is unavailable.",
    );
  }

  if (activePool) {
    console.warn(
      "[DB] Database pool already initialized. Returning active instance.",
    );
    return activePool;
  }

  const config = parseDatabaseConfig();
  const pool = new Pool(config);
  activePool = pool;

  const isDebug = process.env.NODE_ENV !== "production";

  pool.on("connect", () => {
    if (isDebug) {
      console.log("[DB] Client connected to pool");
    }
  });

  pool.on("remove", () => {
    if (isDebug) {
      console.log("[DB] Client removed from pool");
    }
  });

  pool.on("error", (err: Error) => {
    const code = "code" in err ? err.code : undefined;
    console.error("[DB] Unexpected pool error", {
      message: err.message,
      code,
    });
  });

  console.log("[DB] Database pool initialized", {
    maxConnections: config.max,
    idleTimeoutMs: config.idleTimeoutMillis,
    connectionTimeoutMs: config.connectionTimeoutMillis,
  });

  return pool;
}

export function getDatabasePool(): Pool {
  if (!activePool || poolClosePromise) {
    throw new Error(
      "[DB] Database pool is unavailable. " +
      "Initialize it before database operations.",
    );
  }

  return activePool;
}

/**
 * Close the singleton pool once. Concurrent callers share the same operation.
 * The timeout bounds the caller's wait; it does not pretend to cancel pg's
 * underlying Pool.end(). The pool remains unavailable until end() settles.
 */
export async function closeDatabasePool(): Promise<void> {
  if (poolClosePromise) {
    return poolClosePromise;
  }

  const pool = activePool;
  if (!pool) {
    console.warn("[DB] Database pool is not initialized. Skipping closure.");
    return;
  }

  console.log("[DB] Beginning graceful pool shutdown...");

  let timeout: NodeJS.Timeout | undefined;
  const endOperation = pool.end().then(() => {
    if (activePool === pool) {
      activePool = null;
    }
  });

  const deadline = new Promise<never>((_resolve, reject) => {
    timeout = setTimeout(
      () => reject(
        new Error("[DB] Pool shutdown timeout exceeded 30 seconds"),
      ),
      30000,
    );
    timeout.unref();
  });

  const closeAttempt = Promise.race([
    endOperation,
    deadline,
  ]).finally(() => {
    if (timeout) {
      clearTimeout(timeout);
    }
  });

  poolClosePromise = closeAttempt;

  // Allow a later retry only after the actual Pool.end() operation settles.
  void endOperation.then(
    () => {
      if (poolClosePromise === closeAttempt) {
        poolClosePromise = null;
      }
      console.log("[DB] Database pool closed successfully");
    },
    (error: unknown) => {
      if (poolClosePromise === closeAttempt) {
        poolClosePromise = null;
      }
      console.error("[DB] Error during pool closure", {
        message: error instanceof Error ? error.message : String(error),
      });
    },
  );

  return closeAttempt;
}

export async function verifyDatabaseHealth(): Promise<boolean> {
  try {
    const pool = getDatabasePool();
    const client = await pool.connect();

    try {
      const result = await client.query("SELECT 1 as health_check");
      return result.rowCount === 1;
    } finally {
      client.release();
    }
  } catch (error) {
    console.error("[DB] Health check failed", {
      message: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}
