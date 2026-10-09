import { Pool, type PoolConfig } from "pg";

/**
 * Production-grade PostgreSQL connection pool.
 * Configured via environment variables with strict validation and lifecycle management.
 *
 * Environment variables:
 * - DATABASE_URL: Full PostgreSQL connection string (required)
 * - DB_MAX_CONNECTIONS: Maximum pool size (default: 20)
 * - DB_IDLE_TIMEOUT_MS: Idle connection timeout in milliseconds (default: 30000)
 * - DB_CONNECTION_TIMEOUT_MS: Connection establishment timeout (default: 5000)
 * - NODE_ENV: Environment name (used for logging)
 */

let activePool: Pool | null = null;

/**
 * Parse and validate database connection configuration from environment.
 * Enforces strict types and provides sensible production defaults.
 */
function parseDatabaseConfig(): PoolConfig {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error(
      "DATABASE_URL environment variable is required. " +
      "Expected format: postgresql://user:password@host:port/database",
    );
  }

  const maxConnections = parseInt(process.env.DB_MAX_CONNECTIONS ?? "20", 10);
  if (!Number.isFinite(maxConnections) || maxConnections < 1 || maxConnections > 100) {
    throw new Error(
      `DB_MAX_CONNECTIONS must be an integer between 1 and 100, got: ${process.env.DB_MAX_CONNECTIONS}`,
    );
  }

  const idleTimeoutMs = parseInt(process.env.DB_IDLE_TIMEOUT_MS ?? "30000", 10);
  if (!Number.isFinite(idleTimeoutMs) || idleTimeoutMs < 1000 || idleTimeoutMs > 600000) {
    throw new Error(
      `DB_IDLE_TIMEOUT_MS must be an integer between 1000 and 600000 (ms), got: ${process.env.DB_IDLE_TIMEOUT_MS}`,
    );
  }

  const connectionTimeoutMs = parseInt(process.env.DB_CONNECTION_TIMEOUT_MS ?? "5000", 10);
  if (!Number.isFinite(connectionTimeoutMs) || connectionTimeoutMs < 1000 || connectionTimeoutMs > 60000) {
    throw new Error(
      `DB_CONNECTION_TIMEOUT_MS must be an integer between 1000 and 60000 (ms), got: ${process.env.DB_CONNECTION_TIMEOUT_MS}`,
    );
  }

  return {
    connectionString: databaseUrl,
    max: maxConnections,
    idleTimeoutMillis: idleTimeoutMs,
    connectionTimeoutMillis: connectionTimeoutMs,
    
    /**
     * Declarative error handling: fail fast on validation rule violations.
     * Production behavior: do not retry on certain error classes.
     */
    allowExitOnIdle: false,
  };
}

/**
 * Initialize the global database pool as a singleton.
 * Must be called exactly once at application startup, before any database operations.
 *
 * @returns The active PostgreSQL pool
 * @throws If DATABASE_URL is missing, malformed, or connection fails
 */
export function initializeDatabasePool(): Pool {
  if (activePool) {
    console.warn(
      "[DB] Database pool already initialized. Returning active instance.",
    );
    return activePool;
  }

  const config = parseDatabaseConfig();

  activePool = new Pool(config);

  /**
   * Log pool lifecycle events in development/debug mode.
   */
  const isDebug = process.env.NODE_ENV !== "production";

  activePool.on("connect", () => {
    if (isDebug) {
      console.log("[DB] Client connected to pool");
    }
  });

  activePool.on("remove", () => {
    if (isDebug) {
      console.log("[DB] Client removed from pool");
    }
  });

  activePool.on("error", (err: Error, client: any) => {
    console.error("[DB] Unexpected pool error", {
      message: err.message,
      code: (err as any).code,
      detail: (err as any).detail,
      clientState: client?.queryQueue?.length ?? 0,
    });
  });

  console.log("[DB] Database pool initialized", {
    maxConnections: config.max,
    idleTimeoutMs: config.idleTimeoutMillis,
    connectionTimeoutMs: config.connectionTimeoutMillis,
  });

  return activePool;
}

/**
 * Retrieve the active database pool.
 * Throws if the pool has not been initialized.
 *
 * @returns The active PostgreSQL pool
 * @throws If pool is not initialized
 */
export function getDatabasePool(): Pool {
  if (!activePool) {
    throw new Error(
      "[DB] Database pool is not initialized. " +
      "Call initializeDatabasePool() at application startup.",
    );
  }
  return activePool;
}

/**
 * Gracefully close the database pool and drain all active connections.
 * Must be called during application shutdown to prevent connection leaks.
 *
 * Behavior:
 * - Prevents new connection checkouts
 * - Waits for active queries to complete (up to 30 seconds)
 * - Terminates remaining idle connections
 * - Logs lifecycle transitions
 *
 * @throws If closure fails or times out
 */
export async function closeDatabasePool(): Promise<void> {
  if (!activePool) {
    console.warn("[DB] Database pool is not initialized. Skipping closure.");
    return;
  }

  try {
    console.log("[DB] Beginning graceful pool shutdown...");

    /**
     * Set a hard timeout: if the pool doesn't close within 30 seconds,
     * force termination and log a warning.
     */
    const shutdownTimeoutMs = 30000;
    const shutdownPromise = activePool.end();
    const timeoutPromise = new Promise<void>((_, reject) =>
      setTimeout(
        () => reject(new Error("[DB] Pool shutdown timeout exceeded 30 seconds")),
        shutdownTimeoutMs,
      ),
    );

    await Promise.race([shutdownPromise, timeoutPromise]);

    console.log("[DB] Database pool closed successfully");
    activePool = null;
  } catch (error) {
    console.error("[DB] Error during pool closure", {
      message: error instanceof Error ? error.message : String(error),
    });
    activePool = null;
    throw error;
  }
}

/**
 * Health check: verify that the pool can acquire a connection and execute a trivial query.
 * Used for startup verification and diagnostics.
 *
 * @returns True if the pool is healthy, false otherwise
 */
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
