import { spawnSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
const directory = await mkdtemp(join(tmpdir(), "globalbox-test-"));
try {
  const env = {
    ...process.env,
    DATABASE_URL: "file:" + join(directory, "test.db"),
    GT_TEST_SCHEMA: directory,
  };
  const setup = spawnSync(
    process.execPath,
    ["node_modules/prisma/build/index.js", "db", "push", "--skip-generate"],
    { env, stdio: "inherit" },
  );
  if (setup.status !== 0) throw Error("Isolated SQLite setup failed");
  const result = spawnSync(
    process.execPath,
    [
      "--experimental-strip-types",
      "--test",
      "--test-concurrency=1",
      "tests/game.integration.ts",
    ],
    { env, stdio: "inherit" },
  );
  process.exitCode = result.status ?? 1;
} finally {
  await rm(directory, { recursive: true, force: true });
}
