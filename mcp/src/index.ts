import { buildApp } from "./http/server.js";
import { config } from "./config.js";
import { logger } from "./logging.js";
import { SERVER_NAME, VERSION } from "./version.js";

const app = buildApp();

const server = app.listen(config.port, config.host, () => {
  logger.info(
    {
      name: SERVER_NAME,
      version: VERSION,
      host: config.host,
      port: config.port,
      backend: config.backendUrl,
      origins: [...config.allowedOrigins],
    },
    "mcp server listening",
  );
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    logger.info({ signal }, "shutting down");
    server.close(() => process.exit(0));
  });
}
