import { materializeTree } from "./region-nature.ts";
import { labelNature } from "../shared/nature-labels.ts";
import { weatherAt } from "../src/environment/weather.ts";
import { WORLD_EPOCH } from "../shared/nature.ts";
import { db, transact, requireValue, type Tx } from "./db.ts";
import { once } from "./commands.ts";
import { route } from "./pathfinding.ts";
import { event, bump } from "./actions.ts";
import {
  generateNature,
  growNature,
  GAME_TIME,
  type NatureState,
  type NatureTerrain,
} from "../shared/nature.ts";
export function readNature(
  t: NatureTerrain & { nature: string },
  time: number,
): NatureState {
  const n = JSON.parse(t.nature) as Partial<NatureState>;
  return n.version === 1 ? (n as NatureState) : generateNature(t, time);
}
export async function harvest(
  userId: string,
  territoryId: string,
  nodeId: string,
  requestId: string,
) {
  return transact((tx) =>
    once(
      tx,
      userId,
      requestId,
      { kind: "harvest", territoryId, nodeId },
      async () => {
        const t = await tx.territory.findUniqueOrThrow({
          where: { id: territoryId },
          include: { buildings: true, characters: true },
        });
        requireValue(
          t.ownerId === userId,
          "Adquira este território para trabalhar nele.",
          403,
        );
        const clock = await tx.worldState.findUniqueOrThrow({
            where: { id: 1 },
          }),
          nature = readNature(t, clock.gameTime),
          n = nature.nodes.find((n) => n.id === nodeId);
        requireValue(
          n?.harvestable &&
            n.quantity > 0 &&
            ["MATURE", "OLD", "AVAILABLE"].includes(n.state),
          "Este recurso não está disponível.",
          409,
        );
        requireValue(
          !nature.jobs.some((j) => j.nodeId === nodeId),
          "Já existe trabalho neste objeto.",
          409,
        );
        const profession = n!.kind === "Tree" ? "Woodcutter" : "Miner";
        const candidates = t.characters
          .filter(
            (c) =>
              c.profession === profession &&
              !nature.jobs.some((j) => j.characterId === c.id),
          )
          .map((c) => ({ c, path: route(t.grid, [c.x, c.y], [n!.x, n!.y]) }));
        const worker = candidates.find(
          ({ c, path }) =>
            path.length || Math.hypot(c.x - n!.x, c.y - n!.y) < 1.6,
        );
        requireValue(
          worker,
          "Nenhum trabalhador disponível consegue chegar ao objeto.",
          409,
        );
        nature.jobs.push({
          nodeId,
          characterId: worker!.c.id,
          phase: "APPROACH",
          startedAt: clock.gameTime,
          cargo: 0,
          resource: n!.resource,
          destination: [worker!.c.x, worker!.c.y],
        });
        await tx.character.update({
          where: { id: worker!.c.id },
          data: {
            path: JSON.stringify(worker!.path),
            job: nodeId,
            task: "Walking",
          },
        });
        await tx.territory.update({
          where: { id: territoryId },
          data: { nature: JSON.stringify(nature) },
        });
        await bump(tx);
        return { ok: true };
      },
    ),
  );
}
export async function simulateNature(
  tx: Tx,
  t: NatureTerrain & {
    nature: string;
    ownerId: string;
    characters: {
      id: string;
      x: number;
      y: number;
      path: string;
      energy: number;
    }[];
  },
  time: number,
  dt: number,
) {
  const nature = readNature(t, time);
  const weather = weatherAt(
    (t.minLon + t.maxLon) / 2,
    (t.minLat + t.maxLat) / 2,
    WORLD_EPOCH + time * 1000,
  ).state;
  if (nature.weather && nature.weather !== weather)
    await event(
      tx,
      t.id,
      "WEATHER_CHANGED",
      `Clima regional: ${labelNature(weather)}.`,
      t.ownerId,
    );
  nature.weather = weather;
  for (const _id of growNature(t, nature, time))
    await event(
      tx,
      t.id,
      "TREE_GROWN",
      "Uma nova árvore atingiu a maturidade.",
      t.ownerId,
    );
  for (const job of [...nature.jobs]) {
    const c = t.characters.find((c) => c.id === job.characterId),
      n = nature.nodes.find((n) => n.id === job.nodeId);
    if (!c || !n) {
      nature.jobs = nature.jobs.filter((j) => j !== job);
      continue;
    }
    let x = c.x,
      y = c.y,
      path = JSON.parse(c.path) as [number, number][],
      distance = Math.min(dt, 6) * 1.6;
    while (path.length && distance > 0) {
      const [px, py] = path[0],
        d = Math.hypot(px - x, py - y);
      if (d <= distance) {
        x = px;
        y = py;
        distance -= d;
        path.shift();
      } else {
        x += ((px - x) / d) * distance;
        y += ((py - y) / d) * distance;
        distance = 0;
      }
    }
    let task = path.length ? "Walking" : "Working",
      inventory: Record<string, number> = {};
    if (job.phase === "APPROACH" && !path.length) {
      job.phase = "WORK";
      job.startedAt = time;
      if (n.kind === "Tree") n.state = "DAMAGED";
    }
    if (job.phase === "WORK") {
      task = n.kind === "Tree" ? "Gathering" : "Mining";
      n.health = Math.max(
        0,
        100 * (1 - (time - job.startedAt) / GAME_TIME.work),
      );
      if (time - job.startedAt >= GAME_TIME.work) {
        job.cargo = Math.min(n.quantity, n.kind === "Tree" ? 12 : 10);
        n.quantity -= job.cargo;
        n.phaseAt = time;
        n.harvestable = n.quantity > 0;
        if (n.kind === "Tree") {
          n.state = "FALLING";
          n.fallenAt = time;
          n.respawnAt = time + GAME_TIME.regeneration;
        } else n.state = n.quantity ? "AVAILABLE" : "EXHAUSTED";
        await event(
          tx,
          t.id,
          n.kind === "Tree"
            ? "TREE_FELLED"
            : n.kind === "Rock"
              ? "ROCK_EXTRACTED"
              : "ORE_EXTRACTED",
          `${n.kind === "Tree" ? "Árvore derrubada" : "Recurso extraído"}: ${job.cargo} ${labelNature(n.resource).toLowerCase()}.`,
          t.ownerId,
          {
            nodeId: n.id,
            species: n.asset,
            position: [n.x, n.y],
            quantity: job.cargo,
            respawnAt: n.respawnAt,
            gameTime: time,
          },
        );
        job.phase = "TRANSPORT";
        job.startedAt = time;
        const warehouse = t.buildings.find((b) => b.type === "Warehouse");
        if (warehouse) {
          const target: [number, number] = [
              warehouse.x + 0.5,
              warehouse.y + 0.5,
            ],
            p = route(t.grid, [x, y], target);
          if (p.length) {
            job.destination = target;
            path = p;
          }
        }
        if (!path.length) path = route(t.grid, [x, y], job.destination);
      }
    }
    if (job.phase === "TRANSPORT") {
      task = path.length ? "Transporting" : "Storing";
      inventory = { [job.resource]: job.cargo };
      if (!path.length && time > job.startedAt) {
        const stock = await tx.resource.upsert({
          where: {
            territoryId_kind: { territoryId: t.id, kind: job.resource },
          },
          create: {
            territoryId: t.id,
            kind: job.resource,
            amount: 0,
            capacity: 600,
          },
          update: {},
        });
        const stored = Math.min(
          job.cargo,
          Math.max(0, stock.capacity - stock.amount),
        );
        await tx.resource.update({
          where: { id: stock.id },
          data: { amount: { increment: stored } },
        });
        job.cargo -= stored;
        inventory = { [job.resource]: job.cargo };
        if (!job.cargo) {
          nature.jobs = nature.jobs.filter((j) => j !== job);
          inventory = {};
          await event(
            tx,
            t.id,
            "RESOURCE_STORED",
            `${labelNature(n.resource)} entregue ao estoque.`,
            t.ownerId,
          );
        }
      }
    }
    await tx.character.update({
      where: { id: c.id },
      data: {
        x,
        y,
        path: JSON.stringify(path),
        task,
        inventory: JSON.stringify(inventory),
        job: nature.jobs.includes(job) ? n.id : null,
        energy: Math.max(5, c.energy - dt * 0.04),
      },
    });
  }
  await tx.territory.update({
    where: { id: t.id },
    data: { nature: JSON.stringify(nature) },
  });
  return nature.jobs.map((j) => j.characterId);
}
export async function advanceClock(days: number) {
  // Development inspection only: ordinary multiplayer users cannot fast-forward the world.
  requireValue(process.env.NODE_ENV !== "production", "Indisponível.", 404);
  await transact(async (tx) => {
    const s = await tx.worldState.findUniqueOrThrow({ where: { id: 1 } }),
      time = s.gameTime + days * GAME_TIME.day;
    const territories = await tx.territory.findMany({
      include: { buildings: true },
    });
    for (const t of territories) {
      const n = readNature(t, time);
      for (const _id of growNature(t, n, time))
        await event(
          tx,
          t.id,
          "TREE_GROWN",
          "Uma nova árvore atingiu a maturidade.",
          t.ownerId,
        );
      await tx.territory.update({
        where: { id: t.id },
        data: { nature: JSON.stringify(n) },
      });
    }
    await tx.worldState.update({
      where: { id: 1 },
      data: { gameTime: time, revision: { increment: 1 } },
    });
  });
  return db.worldState.findUniqueOrThrow({ where: { id: 1 } });
}

export async function inspectTree(
  userId: string,
  territoryId: string,
  input: {
    sourceId: string;
    lon: number;
    lat: number;
    level: number;
    requestId: string;
  },
) {
  return transact((tx) =>
    once(
      tx,
      userId,
      input.requestId,
      { kind: "inspectTree", territoryId, ...input },
      async () => {
        const t = await tx.territory.findUniqueOrThrow({
          where: { id: territoryId },
          include: { geometry: true, buildings: true },
        });
        requireValue(
          t.ownerId === userId,
          "Este território pertence a outro jogador.",
          403,
        );
        const time = (
            await tx.worldState.findUniqueOrThrow({ where: { id: 1 } })
          ).gameTime,
          nature = readNature(t, time),
          existing = nature.nodes.find((n) => n.sourceId === input.sourceId);
        if (existing) return existing;
        requireValue(
          nature.nodes.length < 4096,
          "Limite de objetos ativos neste território atingido.",
          409,
        );
        const n = materializeTree(t, time, input);
        requireValue(n, "Este local não permite trabalho na árvore.", 409);
        nature.nodes.push(n!);
        await tx.territory.update({
          where: { id: t.id },
          data: { nature: JSON.stringify(nature) },
        });
        await bump(tx);
        return n!;
      },
    ),
  );
}
