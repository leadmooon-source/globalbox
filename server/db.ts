import { PrismaClient, Prisma } from "@prisma/client";
export const db = new PrismaClient();
export type Tx = Prisma.TransactionClient;
/** Simple JS mutex for SQLite serialization (replaces pg_advisory_xact_lock). */
let _lock: Promise<void> = Promise.resolve();
/** Serializes gameplay mutations across server instances, including geometry checks. */
export async function transact<T>(action: (tx: Tx) => Promise<T>): Promise<T> {
  let release: () => void;
  const next = new Promise<void>((r) => (release = r));
  const prev = _lock;
  _lock = next;
  await prev;
  try {
    return await db.$transaction(
      async (tx) => {
        return action(tx);
      },
      { maxWait: 10000, timeout: 20000 },
    );
  } finally {
    release!();
  }
}
export class GameError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}
export const requireValue = (
  condition: unknown,
  message: string,
  status = 400,
): void => {
  if (!condition) throw new GameError(message, status);
};
