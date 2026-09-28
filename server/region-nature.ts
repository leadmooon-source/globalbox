import { climateAt } from "../src/world/climate.ts";
import { createCanvas, Path2D as NativePath } from "@napi-rs/canvas";
import { readFileSync } from "node:fs";
import { booleanPointInPolygon } from "@turf/turf";
import type { Polygon, MultiPolygon } from "geojson";
import {
  prepareVectors,
  rasterRegion,
  mercatorPoint,
  mercatorInverse,
  type TerrainVectors,
} from "../src/terrain/geography.ts";
import { generatePlants } from "../src/world/vegetation.ts";
import {
  generateNature,
  nodeFits,
  type NatureTerrain,
  type NatureNode,
} from "../shared/nature.ts";
import { NATURE_ASSETS, type NatureAssetId } from "../shared/nature-assets.ts";
let vectors: TerrainVectors | undefined;
export function regionVectors() {
  vectors ??= Object.fromEntries(
    ["land", "lakes", "rivers"].map((k) => [
      k,
      prepareVectors(
        JSON.parse(
          readFileSync(
            new URL(
              `../data/geography/${k === "rivers" ? "rivers_lake_centerlines" : k}.json`,
              import.meta.url,
            ),
            "utf8",
          ),
        ),
        (s) => new NativePath(s) as unknown as Path2D,
      ),
    ]),
  ) as unknown as TerrainVectors;
  return vectors;
}
/** Identical Natural Earth raster and candidate generator to the browser workers. */
export function generateWorldNature(
  t: NatureTerrain & { geometry: { polygon: string } | null },
  time: number,
) {
  const state = generateNature(t, time);
  state.nodes = state.nodes.filter((n) => n.kind !== "Tree");
  if (!t.geometry) return state;
  const a = mercatorPoint(t.minLon, t.maxLat),
    b = mercatorPoint(t.maxLon, t.minLat),
    span = Math.max(b[0] - a[0], b[1] - a[1]);
  const level = Math.max(7, Math.min(20, Math.floor(Math.log2(3 / span)))),
    scale = 256 * 2 ** level;
  const geometry = JSON.parse(t.geometry.polygon) as Polygon | MultiPolygon,
    trees: NatureNode[] = [],
    seen = new Set<string>();
  for (
    let y = Math.floor(a[1] * 2 ** level);
    y <= Math.floor(b[1] * 2 ** level);
    y++
  )
    for (
      let x = Math.floor(a[0] * 2 ** level);
      x <= Math.floor(b[0] * 2 ** level);
      x++
    ) {
      const region = rasterRegion(
        { z: level, x, y },
        regionVectors(),
        (w, h) => createCanvas(w, h) as unknown as OffscreenCanvas,
      );
      for (const p of generatePlants(region)) {
        if (seen.has(p.id) || !(p.asset in NATURE_ASSETS)) continue;
        seen.add(p.id);
        const [lon, lat] = mercatorInverse(p.x / scale, p.y / scale);
        if (!booleanPointInPolygon([lon, lat], geometry)) continue;
        const gx = ((lon - t.minLon) / (t.maxLon - t.minLon)) * 64,
          gy = ((t.maxLat - lat) / (t.maxLat - t.minLat)) * 64;
        // The territorial navigation grid adds a conservative footprint and river margin.
        if (!nodeFits(t, gx, gy, [], undefined)) continue;
        const width = (p.width / (scale * (b[0] - a[0]))) * 64,
          height = (p.height / (scale * (b[1] - a[1]))) * 64;
        trees.push({
          id: `${t.id}:${p.id}`,
          sourceId: p.id,
          pixelHeight: p.height,
          width,
          height,
          asset: p.asset as NatureAssetId,
          kind: "Tree",
          resource: "Wood",
          x: gx,
          y: gy,
          biome: p.biome,
          altitude: climateAt(lon, lat).elevation * 4000,
          age: 42,
          health: 100,
          growth: 1,
          state: "MATURE",
          plantedAt: time - 60480,
          fallenAt: null,
          respawnAt: null,
          quantity: 12,
          harvestable: true,
          phaseAt: time,
          generation: 0,
        });
      }
    }
  state.nodes = [
    ...trees,
    ...state.nodes.filter(
      (n) =>
        !trees.some(
          (p) =>
            Math.abs(p.x - n.x) < (p.width ?? 2) / 2 + 1 &&
            Math.abs(p.y - n.y) < (p.height ?? 3) + 1,
        ),
    ),
  ];
  return state;
}

export function materializeTree(
  t: NatureTerrain & { geometry: { polygon: string } | null },
  time: number,
  input: { sourceId: string; lon: number; lat: number; level: number },
) {
  const pos = mercatorPoint(input.lon, input.lat),
    scale = 256 * 2 ** input.level;
  const r = rasterRegion(
    {
      z: input.level,
      x: Math.floor(pos[0] * 2 ** input.level),
      y: Math.floor(pos[1] * 2 ** input.level),
    },
    regionVectors(),
    (w, h) => createCanvas(w, h) as unknown as OffscreenCanvas,
  );
  const p = generatePlants(r).find((p) => p.id === input.sourceId);
  if (!p || !(p.asset in NATURE_ASSETS) || !t.geometry) return undefined;
  const [lon, lat] = mercatorInverse(p.x / scale, p.y / scale);
  if (
    Math.abs(lon - input.lon) > 1e-6 ||
    Math.abs(lat - input.lat) > 1e-6 ||
    !booleanPointInPolygon([lon, lat], JSON.parse(t.geometry.polygon))
  )
    return undefined;
  const x = ((lon - t.minLon) / (t.maxLon - t.minLon)) * 64,
    y = ((t.maxLat - lat) / (t.maxLat - t.minLat)) * 64;
  if (!nodeFits(t, x, y, [])) return undefined;
  const a = mercatorPoint(t.minLon, t.maxLat),
    b = mercatorPoint(t.maxLon, t.minLat);
  return {
    id: `${t.id}:${p.id}`,
    sourceId: p.id,
    pixelHeight: p.height,
    width: (p.width / (scale * (b[0] - a[0]))) * 64,
    height: (p.height / (scale * (b[1] - a[1]))) * 64,
    asset: p.asset as NatureAssetId,
    kind: "Tree",
    resource: "Wood",
    x,
    y,
    biome: p.biome,
    altitude: climateAt(lon, lat).elevation * 4000,
    age: 42,
    health: 100,
    growth: 1,
    state: "MATURE",
    plantedAt: time - 60480,
    fallenAt: null,
    respawnAt: null,
    quantity: 12,
    harvestable: true,
    phaseAt: time,
    generation: 0,
  } satisfies NatureNode;
}
