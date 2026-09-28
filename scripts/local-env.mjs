import { existsSync, writeFileSync } from "node:fs";

if (existsSync(".env.local")) {
  console.log("Existing .env.local retained.");
  process.exit(0);
}

// Prisma resolves this path relative to prisma/schema.prisma.
// Keep new installations separate from the historical checked-in dev.db.
writeFileSync(
  ".env.local",
  "DATABASE_URL=file:./sandbox.local.db\nREDIS_URL=\nPORT=3001\nTICK_MS=3000\nCOOKIE_SECURE=false\n",
  { mode: 0o600, flag: "wx" },
);
console.log("Private SQLite configuration created. Redis is optional.");
