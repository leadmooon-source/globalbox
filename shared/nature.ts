import { hash, noise } from "../src/world/noise.ts";
import { climateAt } from "../src/world/climate.ts";
import type { NatureAssetId } from "./nature-assets.ts";
export type TreeState =
  | "SEEDLING"
  | "YOUNG"
  | "MATURE"
  | "OLD"
  | "DAMAGED"
  | "FALLING"
  | "FALLEN"
  | "DECOMPOSING"
  | "RESPAWNING";
export type NodeState = TreeState | "AVAILABLE" | "EXHAUSTED";
export type AnimationState =
  "IDLE" | "WALK" | "WORK" | "INTERACT" | "FALL" | "HARVEST" | "MINE" | "BUILD";
export const WORLD_EPOCH = Date.UTC(2026, 0, 1);
export const GAME_TIME = {
  day: 1440,
  week: 10080,
  season: 129600,
  year: 518400,
  rate: 1,
  work: 6,
  fall: 3,
  stump: 1440,
  regeneration: 4320,
  seedling: 1440,
  young: 2880,
} as const;
export class GameClock {
  time: number;
  rate: number;
  constructor(time = 0, rate: number = GAME_TIME.rate) {
    this.time = time;
    this.rate = rate;
  }
  advance(realSeconds: number) {
    if (!Number.isFinite(realSeconds) || realSeconds < 0)
      throw Error("Invalid elapsed time");
    this.time += realSeconds * this.rate;
    return this.time;
  }
}
export interface NatureNode {
  id: string;
  sourceId?: string;
  pixelHeight?: number;
  width?: number;
  height?: number;
  asset: NatureAssetId;
  kind: "Tree" | "Rock" | "Ore" | "Crystal";
  resource: string;
  x: number;
  y: number;
  biome: number;
  altitude: number;
  age: number;
  health: number;
  growth: number;
  state: NodeState;
  plantedAt: number;
  fallenAt: number | null;
  respawnAt: number | null;
  quantity: number;
  harvestable: boolean;
  phaseAt: number;
  generation: number;
}
export interface NatureJob {
  nodeId: string;
  characterId: string;
  phase: "APPROACH" | "WORK" | "TRANSPORT";
  startedAt: number;
  cargo: number;
  resource: string;
  destination: [number, number];
}
export interface NatureState {
  version: 1;
  weather?: string;
  nodes: NatureNode[];
  jobs: NatureJob[];
}
export interface NatureTerrain {
  id: string;
  grid: string;
  minLon: number;
  maxLon: number;
  minLat: number;
  maxLat: number;
  buildings: { x: number; y: number; type: string }[];
}
export function vegetationRegion(density: number) {
  return density > 0.7
    ? "DENSE_FOREST"
    : density > 0.45
      ? "FOREST"
      : density > 0.25
        ? "WOODLAND"
        : density > 0.1
          ? "SCATTERED"
          : density > 0
            ? "GRASSLAND"
            : "BARREN";
}
export function nodeFits(
  t: NatureTerrain,
  x: number,
  y: number,
  nodes: NatureNode[],
  ignore?: string,
  tree = true,
): boolean {
  const self = nodes.find((n) => n.id === ignore),
    width = self?.width ?? 2.4,
    height = self?.height ?? 3;
  if (x < width / 2 + 1 || y < height + 1 || x > 63 - width / 2 || y > 62)
    return false;
  for (let yy = Math.floor(y - height); yy <= Math.ceil(y + 0.5); yy++)
    for (
      let xx = Math.floor(x - width / 2);
      xx <= Math.ceil(x + width / 2);
      xx++
    )
      if (!(tree ? "fg" : "fgsm").includes(t.grid[yy * 64 + xx] ?? "0"))
        return false;
  return (
    !nodes.some(
      (n) =>
        n.id !== ignore &&
        n.state !== "EXHAUSTED" &&
        x - width / 2 < n.x + (n.width ?? 2.4) / 2 + 0.3 &&
        x + width / 2 > n.x - (n.width ?? 2.4) / 2 - 0.3 &&
        y - height < n.y + 0.5 &&
        y + 0.5 > n.y - (n.height ?? 3),
    ) &&
    !t.buildings.some(
      (b) => Math.abs(b.x + 1 - x) < 4 && Math.abs(b.y + 1 - y) < 4,
    )
  );
}
/** Instantiated once for acquired regions. No frame-time global entity allocation. */
export function generateNature(t: NatureTerrain, time: number): NatureState {
  const nodes: NatureNode[] = [];
  const seed = Math.floor((t.minLon + 180) * 10000 + (t.minLat + 90) * 137);
  for (let y = 4; y < 61; y++)
    for (let x = 2; x < 62; x++) {
      const r = hash(x, y, seed + 611),
        px = x + 0.2 + hash(x, y, seed + 2) * 0.6,
        py = y + 0.2 + hash(x, y, seed + 3) * 0.6;
      const lon = t.minLon + (px / 64) * (t.maxLon - t.minLon),
        lat = t.maxLat - (py / 64) * (t.maxLat - t.minLat),
        c = climateAt(lon, lat);
      const density =
        ([0, 0.82, 0.55, 0.65, 0.17, 0.005, 0.08, 0, 0.12, 0][c.biome] ?? 0) *
        Math.max(0, (noise(x / 11, y / 11, seed) - 0.25) * 2);
      let asset: NatureAssetId | undefined,
        kind: NatureNode["kind"] = "Tree",
        resource = "Wood";
      if (r < density && c.elevation < 0.72) {
        asset =
          c.biome === 1
            ? "tropical"
            : c.biome === 3 || c.biome === 8
              ? "conifer"
              : c.biome === 4
                ? "savanna"
                : c.biome === 5
                  ? "coconut"
                  : c.biome === 2 && r < 0.09
                    ? "birch"
                    : "oak";
      } else if (r > 0.972) {
        kind = "Rock";
        resource = "Stone";
        asset = c.biome === 5 ? "sandstone" : "stone";
        if (c.biome === 8 && r > 0.989) {
          kind = "Ore";
          asset =
            r > 0.998
              ? "crystal"
              : r > 0.996
                ? "copper"
                : r > 0.993
                  ? "iron"
                  : "coal";
          resource =
            asset === "crystal"
              ? "Crystal"
              : asset === "coal"
                ? "Coal"
                : asset === "copper"
                  ? "Copper"
                  : "Iron";
          if (asset === "crystal") kind = "Crystal";
        }
      }
      if (
        !asset ||
        c.biome === 9 ||
        c.biome === 7 ||
        !nodeFits(t, px, py, nodes, undefined, kind === "Tree")
      )
        continue;
      nodes.push({
        id: `${t.id}:${x}:${y}`,
        asset,
        kind,
        resource,
        x: px,
        y: py,
        biome: c.biome,
        altitude: c.elevation * 4000,
        age: 42,
        health: 100,
        growth: 1,
        state: kind === "Tree" ? "MATURE" : "AVAILABLE",
        plantedAt: time - 42 * GAME_TIME.day,
        fallenAt: null,
        respawnAt: null,
        quantity: kind === "Tree" ? 12 : 40,
        harvestable: true,
        phaseAt: time,
        generation: 0,
      });
    }
  return { version: 1, nodes, jobs: [] };
}
export function growNature(
  t: NatureTerrain,
  state: NatureState,
  time: number,
): string[] {
  const grown: string[] = [];
  for (const n of state.nodes) {
    n.age = Math.max(0, (time - n.plantedAt) / GAME_TIME.day);
    if (n.kind === "Tree" && n.state === "MATURE" && n.age > 180)
      n.state = "OLD";
    if (n.kind !== "Tree" || n.fallenAt === null) continue;
    if (n.state === "FALLING" && time >= n.phaseAt + GAME_TIME.fall) {
      n.state = "FALLEN";
      n.phaseAt = n.fallenAt + GAME_TIME.fall;
    }
    if (n.state === "FALLEN" && time >= n.fallenAt + GAME_TIME.stump)
      n.state = "DECOMPOSING";
    if (n.state === "DECOMPOSING" && time >= (n.respawnAt ?? Infinity))
      n.state = "RESPAWNING";
    if (n.state === "RESPAWNING") {
      for (let i = 0; i < 96; i++) {
        const angle = hash(i, n.generation, n.x * 71) * Math.PI * 2,
          distance = 1 + hash(i, n.generation, 491) * 7,
          x = n.x + Math.cos(angle) * distance,
          y = n.y + Math.sin(angle) * distance;
        if (nodeFits(t, x, y, state.nodes, n.id)) {
          n.x = x;
          n.y = y;
          n.state = "SEEDLING";
          n.plantedAt = time;
          n.phaseAt = time;
          n.health = 100;
          n.growth = 0.2;
          n.generation++;
          break;
        }
      }
    }
    if (n.state === "SEEDLING" && time >= n.plantedAt + GAME_TIME.seedling) {
      n.state = "YOUNG";
      n.growth = 0.5;
    }
    if (
      n.state === "YOUNG" &&
      time >= n.plantedAt + GAME_TIME.seedling + GAME_TIME.young
    ) {
      n.state = "MATURE";
      n.growth = 1;
      n.quantity = 12;
      n.harvestable = true;
      n.fallenAt = null;
      n.respawnAt = null;
      grown.push(n.id);
    }
  }
  return grown;
}
