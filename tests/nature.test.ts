import { test } from "node:test";
import assert from "node:assert/strict";
import {
  GameClock,
  GAME_TIME,
  generateNature,
  growNature,
  nodeFits,
  type NatureTerrain,
} from "../shared/nature.ts";
import { NATURE_ASSETS } from "../shared/nature-assets.ts";
import {
  acquirableGeometry,
  calculateTerritoryAreaKm2,
  overlaps,
} from "../server/geometry.ts";
import { polygon, area } from "@turf/turf";
const land: NatureTerrain = {
  id: "region",
  grid: "g".repeat(4096),
  minLon: 2,
  minLat: 48,
  maxLon: 2.02,
  maxLat: 48.02,
  buildings: [],
};
test("clock advances configurable simulation time and rejects invalid elapsed values", () => {
  const c = new GameClock(50, 2);
  assert.equal(c.advance(10), 70);
  assert.throws(() => c.advance(-1));
  assert.throws(() => c.advance(NaN));
});
test("nature is deterministic, biome compatible, spatially separated and excludes water footprints", () => {
  const a = generateNature(land, 0);
  assert.deepEqual(a, generateNature(land, 0));
  assert.ok(a.nodes.length > 20);
  for (const n of a.nodes) {
    assert.ok(
      (NATURE_ASSETS[n.asset].biomes as readonly number[]).includes(n.biome),
    );
    assert.ok(nodeFits(land, n.x, n.y, a.nodes, n.id, n.kind === "Tree"));
  }
  assert.equal(
    generateNature({ ...land, grid: "w".repeat(4096) }, 0).nodes.length,
    0,
  );
  assert.equal(
    generateNature({ ...land, minLat: 78, maxLat: 78.1 }, 0).nodes.length,
    0,
  );
});
test("felled trees retain stumps, regrow at validated nearby positions, and cannot regrow through buildings", () => {
  const state = generateNature(land, 0),
    n = state.nodes.find((n) => n.kind === "Tree")!,
    origin = [n.x, n.y];
  n.state = "FALLING";
  n.fallenAt = 10;
  n.phaseAt = 10;
  n.respawnAt = 10 + GAME_TIME.regeneration;
  n.harvestable = false;
  n.quantity = 0;
  growNature(land, state, 14);
  assert.equal(n.state, "FALLEN");
  growNature(land, state, 10 + GAME_TIME.stump);
  assert.equal(n.state, "DECOMPOSING");
  const t = 10 + GAME_TIME.regeneration;
  growNature(land, state, t);
  assert.equal(n.state, "SEEDLING");
  assert.notDeepEqual([n.x, n.y], origin);
  assert.equal(n.harvestable, false);
  growNature(land, state, t + GAME_TIME.seedling);
  assert.equal(n.state, "YOUNG");
  assert.deepEqual(
    growNature(land, state, t + GAME_TIME.seedling + GAME_TIME.young),
    [n.id],
  );
  assert.equal(n.state, "MATURE");
  assert.equal(n.harvestable, true);
  assert.equal(n.quantity, 12);
  assert.equal(
    nodeFits(
      { ...land, buildings: [{ x: n.x, y: n.y, type: "House" }] },
      n.x,
      n.y,
      [],
      undefined,
    ),
    false,
  );
});
test("territory geodesic area is projection-independent and occupied land is subtracted without dropping islands or holes", () => {
  const outer = polygon([
      [
        [2, 48],
        [2.04, 48],
        [2.04, 48.04],
        [2, 48.04],
        [2, 48],
      ],
    ]),
    middle = polygon([
      [
        [2.018, 47.99],
        [2.022, 47.99],
        [2.022, 48.05],
        [2.018, 48.05],
        [2.018, 47.99],
      ],
    ]);
  const result = acquirableGeometry(outer, [middle.geometry]);
  assert.equal(result.feature.geometry.type, "MultiPolygon");
  assert.ok(!overlaps(result.feature.geometry, middle.geometry));
  assert.ok(
    Math.abs(result.areaKm2 + result.occupiedAreaKm2 - area(outer) / 1e6) <
      1e-6,
  );
  assert.equal(
    calculateTerritoryAreaKm2(result.feature.geometry),
    result.areaKm2,
  );
});

test("new official sprite catalog has pinned source provenance and transparent individual sprites", async () => {
  const { readFileSync } = await import("node:fs"),
    { createHash } = await import("node:crypto"),
    { createCanvas, loadImage } = await import("@napi-rs/canvas");
  const manifest = JSON.parse(
    readFileSync("public/sandbox/catalog.json", "utf8"),
  );
  const digest = (p: string) =>
    createHash("sha256").update(readFileSync(p)).digest("hex");
  for (const source of Object.values(manifest.sources) as {
    path: string;
    sha256: string;
  }[])
    assert.equal(digest(source.path), source.sha256);
  for (const [id, a] of Object.entries(NATURE_ASSETS)) {
    assert.equal(digest(`public/sandbox/${id}.png`), a.sha256);
    const im = await loadImage(`public/sandbox/${id}.png`);
    assert.equal(im.width, a.width);
    assert.equal(im.height, a.height);
    const c = createCanvas(im.width, im.height),
      ctx = c.getContext("2d");
    ctx.drawImage(im, 0, 0);
    const pixels = ctx.getImageData(0, 0, im.width, im.height).data;
    assert.ok(
      pixels.some((v, i) => i % 4 === 3 && v === 0),
      `${id} background must be transparent`,
    );
    assert.ok(
      pixels.some((v, i) => i % 4 === 3 && v === 255),
      `${id} silhouette must remain opaque`,
    );
  }
});
