import path from "node:path";
import dotenv from "dotenv";
import { fileURLToPath } from "node:url";

const runtimeDirectory = path.dirname(fileURLToPath(import.meta.url));

const envCandidates = [
  path.resolve(process.cwd(), ".env.local"),
  path.resolve(process.cwd(), ".env"),
  path.resolve(process.cwd(), "artifacts/api-server/.env.local"),
  path.resolve(process.cwd(), "artifacts/api-server/.env"),
  path.resolve(runtimeDirectory, "../.env.local"),
  path.resolve(runtimeDirectory, "../.env"),
  path.resolve(process.cwd(), "../../.env.local"),
  path.resolve(process.cwd(), "../../.env"),
];

for (const envPath of envCandidates) {
  dotenv.config({ path: envPath, override: false });
}

// Sentry must be initialised after env vars are loaded but before any app code
import { initSentry } from "./lib/sentry";
initSentry();

async function bootstrap(): Promise<void> {
  const configuredApiUrl = process.env["VITE_API_SERVER_URL"];
  let configuredApiPort = "";
  if (configuredApiUrl) {
    try { configuredApiPort = new URL(configuredApiUrl).port; } catch { /* validated below when PORT is used */ }
  }
  const rawPort = process.env["PORT"] || configuredApiPort || "5000";

  const port = Number(rawPort);

  if (Number.isNaN(port) || port <= 0) {
    throw new Error(`Invalid PORT value: "${rawPort}"`);
  }

  const [{ default: app }, { logger }] = await Promise.all([
    import("./app"),
    import("./lib/logger"),
  ]);

  app.listen(port, (err) => {
    if (err) {
      logger.error({ err }, "Error listening on port");
      process.exit(1);
    }

    logger.info({ port }, "Server listening");
  });
}

void bootstrap();
