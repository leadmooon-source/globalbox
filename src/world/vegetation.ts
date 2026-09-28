import {
  Biome,
  Terrain,
  type Plant,
  type BiomeId,
  type Region,
} from "./types.ts";
import { fbm, hash } from "./noise.ts";
import { ASSET_DATA, type PlantAsset } from "../environment/assets.ts";
import { createProjection } from "./config.ts";
import { mercatorInverse } from "../terrain/geography.ts";
import { shoreDistance } from "../terrain/surface.ts";
export const densities = [0, 0.95, 0.72, 0.88, 0.23, 0.015, 0.08, 0, 0.2, 0];
export function forestCover(
  x: number,
  y: number,
  biome: number,
  seed: number,
): number {
  const grouping =
    fbm(x / 170, y / 170, seed + 5) * 0.65 +
    fbm(x / 39, y / 39, seed + 17) * 0.35;
  const clearing = fbm(x / 61, y / 61, seed + 101);
  return (
    (densities[biome] ?? 0) *
    Math.max(0, (grouping - 0.22) * 2) *
    (clearing > 0.62 ? 0.08 : 1)
  );
}
export function visualTemperature(latitude: number, elevation: number): number {
  return 30 - Math.abs(latitude) * 0.55 - elevation * 24;
}
export function plantAsset(
  biome: BiomeId,
  choice: number,
  moisture: number,
  temperature: number,
): PlantAsset | undefined {
  switch (biome) {
    case Biome.Tropical:
      return choice < 0.18 ? "coconut" : "tropical";
    case Biome.Temperate:
      return choice < 0.5 ? "oak" : choice < 0.75 ? "birch" : "youngOak";
    case Biome.Taiga:
      return temperature < -7 ? "snowConifer" : "conifer";
    case Biome.Savanna:
      return "savanna";
    case Biome.Grassland:
      return choice < 0.65 ? "youngOak" : "oak";
    case Biome.Desert:
      return moisture > 0.2 ? "coconut" : undefined;
    case Biome.Mountain:
      return temperature > -12 ? "conifer" : undefined;
    default:
      return undefined;
  }
}
const equalEarth = createProjection();
export function regionLocation(
  region: Region,
  x: number,
  y: number,
): [number, number] {
  return region.mercatorLevel === undefined
    ? ((equalEarth.invert?.([x, y]) as [number, number]) ?? [0, 90])
    : mercatorInverse(
        x / (256 * 2 ** region.mercatorLevel),
        y / (256 * 2 ** region.mercatorLevel),
      );
}
export function plantBounds(p: Plant, margin = 0) {
  return {
    left: p.x - p.width / 2 - margin,
    top: p.y - p.height - margin,
    right: p.x + p.width / 2 + margin,
    bottom: p.y + 1 + margin,
  };
}
export function plantsOverlap(a: Plant, b: Plant): boolean {
  const aa = plantBounds(a, 1),
    bb = plantBounds(b, 1);
  return (
    aa.left < bb.right &&
    aa.right > bb.left &&
    aa.top < bb.bottom &&
    aa.bottom > bb.top
  );
}
/** Whole projected silhouette, shadow and gust allowance must fit on valid ground. */
export function plantFits(region: Region, p: Plant): boolean {
  const b = plantBounds(p, 1.5),
    step = region.step;
  for (
    let y = Math.floor((b.top - region.originY) / step);
    y <= Math.floor((b.bottom - region.originY) / step);
    y++
  )
    for (
      let x = Math.floor((b.left - region.originX) / step);
      x <= Math.floor((b.right - region.originX) / step);
      x++
    ) {
      if (x < 0 || y < 0 || x >= region.width || y >= region.height)
        return false;
      const i = y * region.width + x;
      if (
        region.terrain[i] !== Terrain.Land ||
        region.biomes[i] === Biome.Polar ||
        region.biomes[i] === Biome.Tundra ||
        region.elevation[i] > 0.72
      )
        return false;
    }
  return true;
}
/** Matérn thinning: a candidate loses to every overlapping higher priority candidate,
 * not just previously accepted ones. This makes shared borders independent of load order. */
export function generatePlants(region: Region): Plant[] {
  if (region.mercatorLevel === undefined && region.step > 2) return [];
  if (region.mercatorLevel !== undefined && region.mercatorLevel < 7) return [];
  const wet = shoreDistance(region.terrain, region.width, false);
  const candidates: (Plant & { priority: number; tier: number })[] = [];
  const level = region.mercatorLevel;
  const tiers =
    level === undefined
      ? [0]
      : Array.from({ length: level - 6 }, (_, i) => i + 7);
  for (const tier of tiers) {
    const factor = level === undefined ? 1 : 2 ** (level - tier),
      pitch = 24 * factor;
    const x0 = Math.floor(region.originX / pitch),
      y0 = Math.floor(region.originY / pitch);
    const x1 = Math.ceil((region.originX + region.width * region.step) / pitch),
      y1 = Math.ceil((region.originY + region.height * region.step) / pitch);
    for (let by = y0; by < y1; by++)
      for (let bx = x0; bx < x1; bx++)
        for (let n = 0; n < 5; n++) {
          const salt = region.seed + tier * 103 + n * 37;
          const x = (bx * 24 + hash(bx, by, salt + 1) * 24) * factor,
            y = (by * 24 + hash(bx, by, salt + 2) * 24) * factor;
          const cx = Math.floor((x - region.originX) / region.step),
            cy = Math.floor((y - region.originY) / region.step);
          if (cx < 0 || cy < 0 || cx >= region.width || cy >= region.height)
            continue;
          const i = cy * region.width + cx,
            biome = region.biomes[i] as BiomeId;
          if (
            region.terrain[i] !== Terrain.Land ||
            !densities[biome] ||
            region.elevation[i] > 0.72
          )
            continue;
          const climateScale = level === undefined ? 1 : 2 ** (8 - level);
          const moisture = region.moisture[i],
            density = forestCover(
              x * climateScale,
              y * climateScale,
              biome,
              region.seed,
            );
          const elevation = region.elevation[i],
            heightFactor =
              biome === Biome.Mountain
                ? Math.max(0, (0.72 - elevation) / 0.2)
                : 1;
          if (
            hash(bx, by, salt + 3) >
            density * (0.45 + moisture * 0.8) * heightFactor
          )
            continue;
          const latitude = regionLocation(region, x, y)[1],
            temperature = visualTemperature(latitude, elevation);
          if (biome === Biome.Desert && (wet[i] > 45 || moisture < 0.2))
            continue;
          const choice = hash(bx, by, salt + 4),
            asset = plantAsset(biome, choice, moisture, temperature);
          if (!asset) continue;
          const scale = [0.21, 0.25, 0.29][
              Math.floor(hash(bx, by, salt + 5) * 3)
            ],
            art = ASSET_DATA[asset];
          const p = {
            id: `${tier}:${bx}:${by}:${n}`,
            x,
            y,
            biome,
            variant: Math.floor(choice * 4),
            asset,
            width: art.width * scale,
            height: art.height * scale,
            priority: hash(bx, by, salt + 6),
            tier,
          };
          const neighbors = [
            i - 1,
            i + 1,
            i - region.width,
            i + region.width,
          ].filter((j) => j >= 0 && j < region.terrain.length);
          if (
            neighbors.some(
              (j) => Math.abs(region.elevation[j] - elevation) > 0.09,
            ) ||
            !plantFits(region, p)
          )
            continue;
          candidates.push(p);
        }
  }
  const buckets = new Map<string, typeof candidates>();
  for (const p of candidates) {
    const k = `${Math.floor(p.x / 24)}:${Math.floor(p.y / 24)}`;
    const list = buckets.get(k) ?? [];
    list.push(p);
    buckets.set(k, list);
  }
  return candidates
    .filter((p) => {
      const bx = Math.floor(p.x / 24),
        by = Math.floor(p.y / 24);
      for (let y = by - 1; y <= by + 1; y++)
        for (let x = bx - 1; x <= bx + 1; x++)
          for (const other of buckets.get(`${x}:${y}`) ?? []) {
            if (other === p) continue;
            const precedes =
              other.tier < p.tier ||
              (other.tier === p.tier &&
                (other.priority > p.priority ||
                  (other.priority === p.priority && other.id < p.id)));
            if (precedes && plantsOverlap(p, other)) return false;
          }
      return true;
    })
    .sort((a, b) => a.y - b.y || a.x - b.x)
    .map(({ priority: _priority, tier: _tier, ...p }) => p);
}
