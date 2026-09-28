import type { Plant, Region } from "../world/types.ts";
import { Biome, Terrain } from "../world/types.ts";
import {
  generatePlants,
  regionLocation,
  plantBounds,
} from "../world/vegetation.ts";
import { shoreDistance } from "../terrain/surface.ts";
import { hash } from "../world/noise.ts";
export interface NaturalObject {
  x: number;
  y: number;
  kind:
    | "grass"
    | "stump"
    | "seedling"
    | "rock"
    | "flowers"
    | "branch"
    | "bush"
    | "log"
    | "ice";
  variant: number;
}
export interface DecorativeAnimal {
  x: number;
  y: number;
  species: "cow" | "chicken";
  id: number;
}
export interface EnvironmentTile {
  id: string;
  level: number;
  projection: "mercator" | "equal-earth";
  originX: number;
  originY: number;
  step: number;
  center: [number, number];
  terrain: Uint8Array;
  shore: Uint8Array;
  flow: Uint8Array;
  plants: Plant[];
  objects: NaturalObject[];
  animals: DecorativeAnimal[];
  bytes: number;
}
/** Packed cell metadata, never a permanent entity for a wave, leaf or raindrop. */
export function buildEnvironmentTile(
  region: Region,
  id: string,
  level: number,
): EnvironmentTile {
  const terrain = new Uint8Array(256 * 256),
    shore = new Uint8Array(terrain.length),
    flow = new Uint8Array(64 * 64);
  const distances = shoreDistance(region.terrain, region.width, true),
    w = region.width;
  for (let y = 0; y < 256; y++)
    for (let x = 0; x < 256; x++) {
      const i = (y + 32) * w + x + 32,
        k = y * 256 + x,
        t = region.terrain[i];
      terrain[k] = t;
      shore[k] = Math.min(255, distances[i]);
      if (t === Terrain.River) {
        let xx = 0,
          xy = 0,
          yy = 0;
        for (let dy = -4; dy <= 4; dy++)
          for (let dx = -4; dx <= 4; dx++)
            if (region.terrain[i + dy * w + dx] === Terrain.River) {
              xx += dx * dx;
              xy += dx * dy;
              yy += dy * dy;
            }
        const angle = 0.5 * Math.atan2(2 * xy, xx - yy);
        flow[(y >> 2) * 64 + (x >> 2)] =
          (Math.round((angle / Math.PI) * 128) + 256) % 256;
      }
    }
  const originX = region.originX + 32 * region.step,
    originY = region.originY + 32 * region.step;
  const plants = generatePlants(region).map((p) => ({
    ...p,
    x: (p.x - originX) / region.step,
    y: (p.y - originY) / region.step,
    width: p.width / region.step,
    height: p.height / region.step,
  }));
  const objects: NaturalObject[] = [];
  const detail = region.mercatorLevel === undefined ? level >= 3 : level >= 9;
  if (detail)
    for (
      let by = Math.floor(originY / region.step / 9) - 1;
      by < (originY / region.step + 256) / 9;
      by++
    )
      for (
        let bx = Math.floor(originX / region.step / 9) - 1;
        bx < (originX / region.step + 256) / 9;
        bx++
      ) {
        const r = hash(bx, by, region.seed + 723);
        if (r > 0.32) continue;
        const x =
            bx * 9 -
            originX / region.step +
            Math.floor(hash(bx, by, region.seed + 724) * 9),
          y =
            by * 9 -
            originY / region.step +
            Math.floor(hash(bx, by, region.seed + 725) * 9);
        if (x < 5 || y < 7 || x > 250 || y > 250) continue;
        const i = (y + 32) * w + x + 32,
          b = region.biomes[i];
        if (b === Biome.Polar && r > 0.02) continue;
        let valid = true;
        for (let dy = -6; dy <= 2; dy++)
          for (let dx = -4; dx <= 4; dx++)
            if (region.terrain[i + dy * w + dx] !== Terrain.Land) valid = false;
        if (
          !valid ||
          plants.some((p) => {
            const a = plantBounds(p);
            return x > a.left && x < a.right && y > a.top && y < a.bottom;
          })
        )
          continue;
        const kind: NaturalObject["kind"] =
          b === Biome.Polar
            ? "ice"
            : b === Biome.Desert || b === Biome.Mountain || b === Biome.Tundra
              ? "rock"
              : b === Biome.Taiga
                ? r < 0.16
                  ? "branch"
                  : "log"
                : r < 0.008
                  ? "stump"
                  : b === Biome.Temperate && r < 0.025
                    ? "seedling"
                    : r < 0.07
                      ? "flowers"
                      : r < 0.14
                        ? "rock"
                        : r < 0.2
                          ? "bush"
                          : "grass";
        objects.push({
          x,
          y,
          kind,
          variant: Math.floor(hash(bx, by, region.seed + 726) * 4),
        });
      }
  const animals: DecorativeAnimal[] = [];
  if (region.mercatorLevel !== undefined && level >= 10)
    for (const o of objects) {
      if (animals.length >= 3) break;
      const i = (o.y + 32) * w + o.x + 32,
        b = region.biomes[i];
      if (
        ![Biome.Temperate, Biome.Grassland, Biome.Savanna].includes(
          b as 2 | 6 | 4,
        ) ||
        hash(Math.floor(originX) + o.x, Math.floor(originY) + o.y, 271920) >
          0.035
      )
        continue;
      animals.push({
        x: o.x,
        y: o.y,
        species: o.variant % 2 ? "chicken" : "cow",
        id: Math.floor(hash(o.x, o.y, region.seed) * 65536),
      });
    }
  return {
    id,
    level,
    projection: region.mercatorLevel === undefined ? "equal-earth" : "mercator",
    originX,
    originY,
    step: region.step,
    center: regionLocation(
      region,
      originX + 128 * region.step,
      originY + 128 * region.step,
    ),
    terrain,
    shore,
    flow,
    plants,
    objects,
    animals,
    bytes:
      terrain.byteLength +
      shore.byteLength +
      flow.byteLength +
      plants.length * 160 +
      objects.length * 40 +
      animals.length * 32,
  };
}
export function environmentTransfers(t: EnvironmentTile): ArrayBuffer[] {
  return [t.terrain.buffer, t.shore.buffer, t.flow.buffer] as ArrayBuffer[];
}
