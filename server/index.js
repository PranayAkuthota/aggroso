import "dotenv/config";
import { createApp } from "./app.js";
import { prisma, initialize } from "./store.js";
if (
  process.env.NODE_ENV === "production" &&
  (!process.env.APP_ACCESS_TOKEN || !process.env.FRONTEND_ORIGIN)
)
  throw new Error("Production requires APP_ACCESS_TOKEN and FRONTEND_ORIGIN");
await initialize();
const app = createApp();
const server = app.listen(Number(process.env.PORT || 8000), "0.0.0.0", () =>
  console.info(
    JSON.stringify({
      event: "server_started",
      port: Number(process.env.PORT || 8000),
      provider: process.env.AI_PROVIDER || "mock",
    }),
  ),
);
for (const signal of ["SIGTERM", "SIGINT"])
  process.on(signal, () => {
    server.close(async () => {
      await prisma.$disconnect();
      process.exit(0);
    });
  });
