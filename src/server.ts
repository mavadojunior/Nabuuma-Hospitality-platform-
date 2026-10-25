import { createRuntime } from "./runtime.js";

async function main(): Promise<void> {
  const runtime = await createRuntime();

  let terminating = false;

  const terminate = async (
    signal: NodeJS.Signals,
  ): Promise<void> => {
    if (terminating) {
      return;
    }

    terminating = true;

    try {
      await runtime.lifecycle.shutdown();
      process.exitCode = 0;
    } catch (error) {
      console.error(
        `[runtime] ${signal} shutdown failed`,
        error,
      );
      process.exitCode = 1;
    }
  };

  process.once(
    "SIGTERM",
    () => void terminate("SIGTERM"),
  );

  process.once(
    "SIGINT",
    () => void terminate("SIGINT"),
  );

  try {
    await runtime.app.listen({
      host: runtime.config.host,
      port: runtime.config.port,
    });

    runtime.lifecycle.markReady();
  } catch (error) {
    await terminate("SIGTERM");
    throw error;
  }
}

void main().catch((error: unknown) => {
  console.error("[runtime] startup failed", error);
  process.exitCode = 1;
});
