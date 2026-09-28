import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { createCanvas, loadImage } from "@napi-rs/canvas";
import { Biome, Terrain, type Region } from "../src/world/types.ts";
import {
  generatePlants,
  plantFits,
  plantsOverlap,
  plantAsset,
} from "../src/world/vegetation.ts";
import { ASSET_DATA } from "../src/environment/asset-data.ts";
import { weatherAt, EnvironmentClock } from "../src/environment/weather.ts";
import { buildEnvironmentTile } from "../src/environment/tile.ts";
import {
  EnvironmentRenderer,
  type EnvironmentView,
} from "../src/environment/renderer.ts";
function region(
  biome: number = Biome.Tropical,
  ox = 83000,
  oy = 68000,
  level = 9,
): Region {
  const width = 320;
  return {
    width,
    height: width,
    originX: ox,
    originY: oy,
    step: 1,
    seed: 271828,
    mercatorLevel: level,
    terrain: new Uint8Array(width * width).fill(Terrain.Land),
    biomes: new Uint8Array(width * width).fill(biome),
    elevation: new Float32Array(width * width).fill(0.12),
    moisture: new Float32Array(width * width).fill(0.8),
    coastDistance: new Uint16Array(width * width),
  };
}
test("official sprites match pinned sources, crops, pivots and valid biome assignments", async () => {
  const manifest = JSON.parse(
    readFileSync("public/world-life/source.json", "utf8"),
  );
  const extracted = JSON.parse(
    readFileSync("data/world-pack/source.json", "utf8"),
  );
  const digest = (path: string) =>
    createHash("sha256").update(readFileSync(path)).digest("hex");
  assert.equal(digest(extracted.archive), extracted.sha256);
  for (const entry of extracted.files)
    assert.equal(digest(`data/world-pack/${entry.file}`), entry.sha256);
  for (const [id, art] of Object.entries(ASSET_DATA)) {
    const entry = manifest.sprites[id],
      im = await loadImage(`public/world-life/${id}.png`),
      source = await loadImage(entry.source);
    assert.equal(im.width, art.width);
    assert.equal(im.height, art.height);
    assert.equal(digest(`public/world-life/${id}.png`), entry.sha256);
    assert.equal(digest(entry.source), entry.sourceSha256);
    assert.ok(
      entry.crop[0] + entry.crop[2] <= source.width &&
        entry.crop[1] + entry.crop[3] <= source.height,
    );
    assert.ok(entry.pivot[0] < im.width && entry.pivot[1] < im.height);
    assert.ok(
      !art.biomes.some(
        (b) => Number(b) === Biome.Polar || Number(b) === Biome.Tundra,
      ),
    );
  }
  assert.equal(plantAsset(Biome.Savanna, 0.5, 0.4, 25), "savanna");
  assert.equal(plantAsset(Biome.Taiga, 0.5, 0.5, 0), "conifer");
  assert.equal(plantAsset(Biome.Desert, 0.5, 0.01, 30), undefined);
});
test("vegetation respects complete footprints, river/lake/coast buffers and neighbors", () => {
  const r = region();
  for (let y = 0; y < 320; y++)
    for (let x = 0; x < 320; x++) {
      if (x < 65) r.terrain[y * 320 + x] = Terrain.Ocean;
      else if (Math.abs(y - 170 - Math.sin(x / 30) * 12) < 3)
        r.terrain[y * 320 + x] = Terrain.River;
      else if (Math.hypot(x - 230, y - 80) < 22)
        r.terrain[y * 320 + x] = Terrain.Lake;
    }
  const original = structuredClone(r),
    plants = generatePlants(r);
  assert.ok(plants.length > 10);
  assert.deepEqual(generatePlants(r), plants);
  assert.deepEqual(r, original);
  assert.notDeepEqual(generatePlants({ ...r, seed: 23 }), plants);
  for (let i = 0; i < plants.length; i++) {
    assert.ok(plantFits(r, plants[i]));
    for (let j = i + 1; j < plants.length; j++)
      assert.equal(plantsOverlap(plants[i], plants[j]), false);
  }
  for (const b of [Biome.Polar, Biome.Tundra])
    assert.equal(generatePlants(region(b)).length, 0);
  const mountain = region(Biome.Mountain);
  mountain.elevation.fill(0.9);
  assert.equal(generatePlants(mountain).length, 0);
  const desert = region(Biome.Desert);
  desert.moisture.fill(0.04);
  assert.equal(generatePlants(desert).length, 0);
});
test("neighbor chunks agree in the shared safe interior and preserve existing tree identities through zoom", () => {
  const a = region(),
    b = region(Biome.Tropical, a.originX + 256, a.originY);
  const pa = generatePlants(a),
    pb = generatePlants(b);
  const shared = (p: typeof pa) =>
    p.filter((t) => t.x >= b.originX + 24 && t.x < a.originX + 296);
  assert.ok(shared(pa).length > 0);
  assert.deepEqual(shared(pa), shared(pb));
  const child = region(Biome.Tropical, a.originX * 2, a.originY * 2, 10);
  const pc = generatePlants(child);
  const visible = pa.filter(
    (p) =>
      p.x > a.originX + 24 &&
      p.x < a.originX + 136 &&
      p.y > a.originY + 24 &&
      p.y < a.originY + 136,
  );
  assert.ok(visible.length > 0);
  for (const p of visible) {
    const next = pc.find((q) => q.id === p.id);
    assert.ok(next, `retained ${p.id}`);
    assert.equal(next.x, p.x * 2);
    assert.equal(next.y, p.y * 2);
  }
});
test("regional UTC weather is reproducible, continuous, diverse, and excludes polar rain", () => {
  const start = Date.UTC(2026, 8, 28),
    states = new Set();
  let rains = 0;
  for (let minute = 0; minute < 180; minute += 2) {
    let wet = 0,
      dry = 0;
    for (const [lon, lat] of [
      [-63, -5],
      [15, 25],
      [10, 48],
      [100, 60],
      [-72, -15],
      [133, -25],
      [-41, 75],
      [0, -78],
    ]) {
      const t = start + minute * 60000,
        a = weatherAt(lon, lat, t);
      assert.deepEqual(a, weatherAt(lon, lat, t));
      states.add(a.state);
      assert.ok(a.cloud >= 0 && a.cloud <= 1 && a.rain >= 0 && a.rain <= 1);
      if (a.rain > 0.04) {
        wet++;
        rains++;
      } else dry++;
      if (lat === 75 || lat === -78) assert.equal(a.rain, 0);
      const b = weatherAt(lon, lat, t + 100);
      assert.ok(Math.abs(a.rain - b.rain) < 0.02);
      assert.ok(Math.abs(a.cloud - b.cloud) < 0.02);
    }
    assert.ok(dry > 0 && wet < 8);
  }
  assert.ok(rains > 0);
  assert.ok(
    states.has("CLEAR") && states.has("CLOUDY") && states.has("LIGHT_RAIN"),
  );
  const left = weatherAt(5 - 0.00001, 45, start),
    right = weatherAt(5 + 0.00001, 45, start);
  assert.ok(Math.abs(left.rain - right.rain) < 0.0001);
  const clock = new EnvironmentClock();
  clock.setForTesting(start);
  assert.equal(clock.now(true), start);
  assert.equal(clock.now(true), start);
  clock.setForTesting(start + 1000);
  assert.equal(clock.now(false), start + 1000);
});
test("water metadata preserves masks and distinguishes river orientation", () => {
  const r = region();
  r.terrain.fill(Terrain.Land);
  for (let y = 130; y < 134; y++)
    for (let x = 0; x < 320; x++) r.terrain[y * 320 + x] = Terrain.River;
  const before = r.terrain.slice(),
    t = buildEnvironmentTile(r, "fixture", 9);
  assert.deepEqual(r.terrain, before);
  assert.equal(t.terrain[(131 - 32) * 256 + 100], Terrain.River);
  assert.equal(t.flow[((131 - 32) >> 2) * 64 + (100 >> 2)], 0);
  assert.ok(t.bytes < 1024 * 1024);
});
test("environment rendering freezes in reduced motion, bounds work and releases resources", () => {
  const original = Object.getOwnPropertyDescriptor(
    globalThis,
    "OffscreenCanvas",
  );
  Object.defineProperty(globalThis, "OffscreenCanvas", {
    configurable: true,
    value: class {
      constructor(w: number, h: number) {
        return createCanvas(w, h);
      }
    },
  });
  try {
    const renderer = new EnvironmentRenderer(),
      r = region();
    r.terrain.fill(Terrain.Ocean);
    const tile = buildEnvironmentTile(r, "test", 9);
    renderer.put(tile);
    const canvas = createCanvas(800, 600),
      c = canvas.getContext("2d") as unknown as CanvasRenderingContext2D;
    const view: EnvironmentView = {
      width: 800,
      height: 600,
      level: 9,
      signature: "fixed",
      bounds: () => ({ x: 0, y: 0, width: 800, height: 600 }),
      project: () => ({ x: 0, y: 0 }),
      unproject: (x, y) => [-65 + x / 100, -8 + y / 100],
    };
    // Test surfaces without browser asset loading; there is no vegetation in this fixture.
    Object.assign(renderer, { loaded: true });
    renderer.clock.setForTesting(Date.UTC(2026, 8, 28));
    renderer.drawGround(c, view, true);
    renderer.drawWeather(c, view, true);
    const a = canvas.toBuffer("image/png");
    c.clearRect(0, 0, 800, 600);
    renderer.drawGround(c, view, true);
    renderer.drawWeather(c, view, true);
    assert.deepEqual(canvas.toBuffer("image/png"), a);
    assert.equal(renderer.metrics.leaves, 0);
    assert.ok(renderer.metrics.clouds <= 32 && renderer.metrics.ripples <= 96);
    assert.ok(renderer.metrics.bytes < 16 * 1024 * 1024);
    renderer.dispose();
    assert.equal(renderer.cache.bytes, 0);
  } finally {
    if (original)
      Object.defineProperty(globalThis, "OffscreenCanvas", original);
    else Reflect.deleteProperty(globalThis, "OffscreenCanvas");
  }
});
