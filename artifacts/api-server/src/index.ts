import path from "node:path";
import dotenv from "dotenv";

const envCandidates = [
  path.resolve(process.cwd(), ".env.local"),
  path.resolve(process.cwd(), ".env"),
  path.resolve(process.cwd(), "../../.env.local"),
  path.resolve(process.cwd(), "../../.env"),
];

for (const envPath of envCandidates) {
  dotenv.config({ path: envPath, override: false });
}

async function bootstrap(): Promise<void> {
  const rawPort = process.env["PORT"];

  if (!rawPort) {
    throw new Error(
      "PORT environment variable is required but was not provided.",
    );
  }

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
