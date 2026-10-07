import "dotenv/config";
import { initialize, prisma } from "./store.js";
await initialize();
console.info("Demo workspace initialized; existing data preserved.");
await prisma.$disconnect();
