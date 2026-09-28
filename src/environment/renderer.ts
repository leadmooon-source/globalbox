import { mercatorInverse } from "../terrain/geography.ts";
import { BudgetCache } from "../streaming/cache.ts";
import { Terrain } from "../world/types.ts";
import { hash } from "../world/noise.ts";
import { assetImages, loadLifeAssets, drawFarmAnimal } from "./assets.ts";
import type { EnvironmentTile } from "./tile.ts";
import { EnvironmentClock, gustAt, weatherAt } from "./weather.ts";
export interface ScreenRect {
  x: number;
  y: number;
  width: number;
  height: number;
}
export interface EnvironmentView {
  width: number;
  height: number;
  level: number;
  signature: string;
  bounds(tile: EnvironmentTile): ScreenRect;
  project(lon: number, lat: number): { x: number; y: number };
  unproject(x: number, y: number): [number, number];
  exclusions?: ScreenRect[];
  excludesPlant?(x: number, y: number, id?: string): boolean;
}
interface VisibleTile {
  tile: EnvironmentTile;
  rect: ScreenRect;
}
const intersects = (a: ScreenRect, b: ScreenRect) =>
  a.x < b.x + b.width &&
  a.x + a.width > b.x &&
  a.y < b.y + b.height &&
  a.y + a.height > b.y;
export const ENVIRONMENT_LAYERS = [
  "Ocean Base",
  "Ocean Details",
  "Terrain Base",
  "Terrain Pixel Details",
  "Rivers & Lakes",
  "Vegetation",
  "Natural Objects",
  "Animals",
  "Weather",
  "Atmospheric Effects",
] as const;
/** Canvas-only environment shared by Equal Earth, MapLibre and the Canvas fallback.
 * Metadata <=8 MiB; three viewport surfaces <=6 MiB; art/patterns fit the remaining 2 MiB.
 * Static terrain itself remains in the pre-existing renderer caches. */
export class EnvironmentRenderer {
  private excludesPlant: EnvironmentView["excludesPlant"];
  hitPlant(x: number, y: number) {
    for (const { tile: t, rect: r } of this.visible) {
      for (const p of t.plants) {
        const px = r.x + (p.x * r.width) / 256,
          py = r.y + (p.y * r.height) / 256,
          w = (p.width * r.width) / 256,
          h = (p.height * r.height) / 256;
        if (
          x >= px - w / 2 &&
          x <= px + w / 2 &&
          y >= py - h &&
          y <= py &&
          this.resolve(px, py)?.tile === t &&
          !this.excludesPlant?.(px, py, p.id)
        ) {
          const [lon, lat] = mercatorInverse(
            (t.originX + p.x * t.step) / (256 * 2 ** t.level),
            (t.originY + p.y * t.step) / (256 * 2 ** t.level),
          );
          return { id: p.id, asset: p.asset, lon, lat, level: t.level };
        }
      }
    }
    return undefined;
  }
  isLand(x: number, y: number): boolean {
    const hit = this.resolve(x, y);
    if (!hit) return false;
    const { tile: t, rect: r } = hit;
    const cx = Math.floor(((x - r.x) / r.width) * 256),
      cy = Math.floor(((y - r.y) / r.height) * 256);
    return t.terrain[cy * 256 + cx] === Terrain.Land;
  }
  readonly clock = new EnvironmentClock();
  readonly cache = new BudgetCache<EnvironmentTile>(8 * 1024 * 1024, () => {});
  readonly metrics = {
    groundMs: 0,
    weatherMs: 0,
    waterMarks: 0,
    leaves: 0,
    clouds: 0,
    ripples: 0,
    vegetationBuilds: 0,
    assetFailures: 0,
    bytes: 0,
  };
  private vegetation: OffscreenCanvas | undefined;
  private water: OffscreenCanvas | undefined;
  private atmosphere: OffscreenCanvas | undefined;
  private generation = 0;
  private vegetationKey = "";
  private waterKey = "";
  private weatherKey = "";
  private loaded = false;
  private disposed = false;
  private loading = false;
  private retryAt = 0;
  private visible: VisibleTile[] = [];
  private readonly leaves = new Float32Array(64 * 5);
  constructor() {
    if (typeof window !== "undefined") this.ensureAssets();
  }
  private ensureAssets() {
    if (
      this.loaded ||
      this.loading ||
      Date.now() < this.retryAt ||
      this.disposed
    )
      return;
    this.loading = true;
    void loadLifeAssets()
      .then(() => {
        if (!this.disposed) {
          this.loaded = true;
          this.generation++;
        }
      })
      .catch((error) => {
        this.metrics.assetFailures++;
        this.retryAt = Date.now() + 10000;
        console.error(error);
      })
      .finally(() => {
        this.loading = false;
      });
  }
  put(tile: EnvironmentTile) {
    if (this.disposed) return;
    this.cache.set(tile.id, tile);
    this.generation++;
  }
  private surface(
    current: OffscreenCanvas | undefined,
    w: number,
    h: number,
    maxW: number,
    maxH: number,
  ) {
    const scale = Math.min(1, maxW / Math.max(1, w), maxH / Math.max(1, h));
    const width = Math.max(1, Math.round(w * scale)),
      height = Math.max(1, Math.round(h * scale));
    if (!current) current = new OffscreenCanvas(width, height);
    if (current.width !== width || current.height !== height) {
      current.width = width;
      current.height = height;
    }
    return current;
  }
  private prepare(canvas: OffscreenCanvas, v: EnvironmentView) {
    const c = canvas.getContext("2d")!;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.clearRect(0, 0, canvas.width, canvas.height);
    c.setTransform(
      canvas.width / v.width,
      0,
      0,
      canvas.height / v.height,
      0,
      0,
    );
    c.imageSmoothingEnabled = false;
    return c;
  }
  private resolve(x: number, y: number): VisibleTile | undefined {
    return this.visible.find(
      ({ rect: r }) =>
        x >= r.x && x < r.x + r.width && y >= r.y && y < r.y + r.height,
    );
  }
  private waterAt(x: number, y: number) {
    const found = this.resolve(x, y);
    if (!found) return;
    const { tile: t, rect: r } = found,
      ix = Math.floor(((x - r.x) / r.width) * 256),
      iy = Math.floor(((y - r.y) / r.height) * 256),
      i = iy * 256 + ix;
    if (t.terrain[i] === Terrain.Land) return;
    return {
      type: t.terrain[i],
      shore: t.shore[i],
      angle: (t.flow[(iy >> 2) * 64 + (ix >> 2)] / 128) * Math.PI,
    };
  }
  private collect(view: EnvironmentView) {
    this.visible = [...this.cache.entries.values()]
      .filter((t) => t.level <= view.level)
      .map((tile) => ({ tile, rect: view.bounds(tile) }))
      .filter(
        ({ rect: r }) =>
          r.width > 0 &&
          intersects(r, { x: 0, y: 0, width: view.width, height: view.height }),
      )
      .sort((a, b) => b.tile.level - a.tile.level);
    for (const { tile } of this.visible) this.cache.get(tile.id);
  }
  drawGround(
    c: CanvasRenderingContext2D,
    v: EnvironmentView,
    reduced: boolean,
  ) {
    if (this.disposed || v.width <= 0 || v.height <= 0) return;
    const start = performance.now();
    this.ensureAssets();
    this.collect(v);
    this.excludesPlant = v.excludesPlant;
    const utc = this.clock.now(reduced),
      seconds = utc / 1000;
    const base = `${v.signature}:${this.generation}:${reduced}:${v.width}:${v.height}`;
    this.water = this.surface(this.water, v.width, v.height, 768, 512);
    const wk = `${base}:${reduced ? 0 : Math.floor(seconds * 15)}`;
    if (wk !== this.waterKey) {
      this.waterKey = wk;
      const out = this.prepare(this.water, v);
      this.metrics.waterMarks = 0;
      this.metrics.ripples = 0;
      const spacing = v.width < 600 ? 30 : 24,
        anchor = v.project(0, 0);
      for (let y = (anchor.y % spacing) - spacing; y < v.height; y += spacing)
        for (
          let x = (anchor.x % spacing) - spacing;
          x < v.width;
          x += spacing
        ) {
          if (this.metrics.waterMarks >= 1200) break;
          const [lon, lat] = v.unproject(x, y),
            r = hash(Math.floor(lon * 10000), Math.floor(lat * 10000), 271831);
          if (r > 0.5) continue;
          const water = this.waterAt(x, y);
          if (!water) continue;
          const w = weatherAt(lon, lat, utc),
            phase = reduced
              ? 0.4
              : (seconds *
                  (water.type === Terrain.River
                    ? 0.65
                    : water.shore > 50
                      ? 0.12
                      : 0.3) +
                  r * 4) %
                1;
          const bright = 0.1 + Math.sin(phase * Math.PI) * 0.2;
          out.fillStyle =
            water.shore < 7
              ? `rgba(218,241,216,${bright + 0.1})`
              : `rgba(132,201,203,${bright})`;
          const length =
            water.type === Terrain.River ? 5 : water.shore > 50 ? 10 : 6;
          const dx = water.type === Terrain.River ? Math.cos(water.angle) : 1,
            dy = water.type === Terrain.River ? Math.sin(water.angle) : 0;
          for (let p = 0; p < length; p += 2) {
            const px = Math.round(x + (p + phase * 4) * dx),
              py = Math.round(y + (p + phase * 4) * dy);
            if (this.waterAt(px, py) && this.waterAt(px + 1, py + 1))
              out.fillRect(px, py, 2, 1);
          }
          if (
            (water.type === Terrain.Lake || w.rain > 0.1) &&
            this.metrics.ripples < (v.width < 600 ? 40 : 96) &&
            r < 0.15
          ) {
            const radius = 1 + Math.floor(phase * 4);
            for (const [dx, dy] of [
              [-radius, 0],
              [radius, 0],
              [0, -radius / 2],
              [0, radius / 2],
            ]) {
              const px = Math.round(x + dx),
                py = Math.round(y + dy);
              if (this.waterAt(px, py)) out.fillRect(px, py, 2, 1);
            }
            this.metrics.ripples++;
          }
          this.metrics.waterMarks++;
        }
    }
    c.imageSmoothingEnabled = false;
    c.drawImage(this.water, 0, 0, v.width, v.height);
    const windy =
      !reduced &&
      this.visible.some(
        ({ tile: t }) =>
          gustAt(...t.center, seconds, weatherAt(...t.center, utc).wind) > 0.03,
      );
    const vk = `${base}:${windy ? Math.floor(seconds * 8) : 0}:${JSON.stringify(v.exclusions ?? [])}`;
    this.vegetation = this.surface(
      this.vegetation,
      v.width,
      v.height,
      1024,
      768,
    );
    if (vk !== this.vegetationKey) {
      this.vegetationKey = vk;
      this.metrics.vegetationBuilds++;
      const out = this.prepare(this.vegetation, v);
      for (const { tile: t, rect: r } of this.visible) {
        const sx = r.width / 256,
          sy = r.height / 256,
          w = weatherAt(...t.center, utc),
          gust = reduced ? 0 : gustAt(...t.center, seconds, w.wind);
        for (const p of t.plants) {
          const x = r.x + p.x * sx,
            y = r.y + p.y * sy;
          if (
            x < -p.width * sx ||
            x > v.width + p.width * sx ||
            y < 0 ||
            y > v.height + p.height * sy
          )
            continue;
          if (this.resolve(x, y)?.tile !== t || v.excludesPlant?.(x, y, p.id))
            continue;
          const width = p.width * sx,
            height = p.height * sy,
            box = {
              x: x - width / 2,
              y: y - height,
              width,
              height: height + 2,
            };
          if (
            !intersects(box, {
              x: 0,
              y: 0,
              width: v.width,
              height: v.height,
            }) ||
            v.exclusions?.some((a) => intersects(box, a))
          )
            continue;
          const image = assetImages.get(p.asset);
          if (!image) continue;
          const split = Math.floor(image.height * 0.73),
            dy = Math.round(y - height),
            left = Math.round(x - width / 2);
          const sway =
            gust > 0.12
              ? Math.round(
                  Math.sin(
                    seconds * 2 + hash(Math.floor(p.x), Math.floor(p.y)) * 6,
                  ) *
                    Math.min(1, sx) *
                    Math.min(1, gust * 3),
                )
              : 0;
          out.drawImage(
            image,
            0,
            split,
            image.width,
            image.height - split,
            left,
            dy + (height * split) / image.height,
            width,
            (height * (image.height - split)) / image.height,
          );
          out.drawImage(
            image,
            0,
            0,
            image.width,
            split,
            left + sway,
            dy,
            width,
            (height * split) / image.height,
          );
        }
        for (const o of t.objects) {
          const x = r.x + o.x * sx,
            y = r.y + o.y * sy;
          if (
            x < -8 * sx ||
            x > v.width + 8 * sx ||
            y < -8 * sy ||
            y > v.height + 8 * sy
          )
            continue;
          if (
            this.resolve(x, y)?.tile !== t ||
            v.exclusions?.some((a) =>
              intersects(
                { x: x - 4 * sx, y: y - 4 * sy, width: 8 * sx, height: 8 * sy },
                a,
              ),
            )
          )
            continue;
          if (
            assetImages.has(
              o.kind === "rock"
                ? "stone"
                : o.kind === "stump"
                  ? "cutStump"
                  : o.kind,
            )
          ) {
            const im = assetImages.get(
              o.kind === "rock"
                ? "stone"
                : o.kind === "stump"
                  ? "cutStump"
                  : o.kind,
            );
            if (im) {
              const size = o.kind === "stump" ? 5 : 4,
                sway =
                  (o.kind === "grass" || o.kind === "bush") && gust > 0.2
                    ? Math.round(
                        Math.sin(seconds * 2 + o.variant) * Math.min(1, sx),
                      )
                    : 0;
              out.drawImage(
                im,
                Math.round(x - (size * sx) / 2) + sway,
                Math.round(y - size * sy),
                size * sx,
                (size * sy * im.height) / im.width,
              );
            }
          } else {
            out.fillStyle =
              o.kind === "rock"
                ? "#829584"
                : o.kind === "branch"
                  ? "#766548"
                  : "#e0c888";
            out.fillRect(
              Math.round(x),
              Math.round(y),
              Math.max(1, 2 * sx),
              Math.max(1, sy),
            );
            if (o.kind === "flowers") {
              out.fillStyle = o.variant % 2 ? "#d6bcdd" : "#ece3a5";
              out.fillRect(
                Math.round(x + 2 * sx),
                Math.round(y - 2 * sy),
                Math.max(1, sx),
                Math.max(1, sy),
              );
            }
          }
        }
      }
    }
    c.drawImage(this.vegetation, 0, 0, v.width, v.height);
    this.metrics.groundMs = performance.now() - start;
    this.metrics.bytes =
      this.cache.bytes +
      (this.vegetation.width * this.vegetation.height +
        this.water.width * this.water.height +
        (this.atmosphere
          ? this.atmosphere.width * this.atmosphere.height
          : 0)) *
        4 +
      this.leaves.byteLength;
  }
  drawAnimals(
    c: CanvasRenderingContext2D,
    v: EnvironmentView,
    reduced: boolean,
  ) {
    let count = 0;
    const seconds = this.clock.now(reduced) / 1000;
    for (const { tile: t, rect: r } of this.visible)
      for (const a of t.animals) {
        if (count >= 24) return;
        const x = r.x + (a.x * r.width) / 256,
          y = r.y + (a.y * r.height) / 256;
        if (
          x < 0 ||
          y < 0 ||
          x > v.width ||
          y > v.height ||
          this.resolve(x, y)?.tile !== t ||
          v.exclusions?.some((box) =>
            intersects({ x: x - 8, y: y - 12, width: 16, height: 14 }, box),
          )
        )
          continue;
        drawFarmAnimal(
          c,
          a.species,
          x,
          y,
          Math.min(24, Math.max(5, (r.width / 256) * 4)),
          reduced ? 0 : seconds,
          a.id,
          a.id % 2 ? 1 : -1,
        );
        count++;
      }
  }
  drawWeather(
    c: CanvasRenderingContext2D,
    v: EnvironmentView,
    reduced: boolean,
  ) {
    if (this.disposed || v.width <= 0 || v.height <= 0) return;
    const start = performance.now(),
      utc = this.clock.now(reduced),
      seconds = utc / 1000;
    const key = `${v.signature}:${this.generation}:${reduced}:${reduced ? 0 : Math.floor(seconds * 15)}:${v.width}:${v.height}`;
    this.atmosphere = this.surface(
      this.atmosphere,
      v.width,
      v.height,
      768,
      512,
    );
    if (this.weatherKey !== key) {
      this.weatherKey = key;
      const out = this.prepare(this.atmosphere, v);
      this.metrics.clouds = 0;
      this.metrics.leaves = 0;
      // Stateless, world-anchored rain pattern: no array of drop entities.
      const anchor = v.project(0, 0),
        pitch = 22;
      if (!reduced)
        for (
          let gy = Math.floor(-anchor.y / pitch) - 1;
          gy < (v.height - anchor.y) / pitch;
          gy++
        )
          for (
            let gx = Math.floor(-anchor.x / pitch) - 1;
            gx < (v.width - anchor.x) / pitch;
            gx++
          ) {
            const r = hash(gx, gy, 271987),
              x = anchor.x + gx * pitch + r * 16,
              y = anchor.y + gy * pitch + ((seconds * 34 + r * 22) % pitch);
            const ll = v.unproject(x, y);
            if (ll[1] < -85 || ll[1] > 85) continue;
            const weather = weatherAt(...ll, utc);
            if (r > weather.rain * 0.8) continue;
            out.fillStyle = `rgba(176,207,212,${0.16 + weather.rain * 0.16})`;
            out.fillRect(Math.round(x), Math.round(y), 1, 3);
            out.fillRect(
              Math.round(x + Math.cos(weather.direction)),
              Math.round(y + 3),
              1,
              2,
            );
          }
      // A bounded pool references deterministic plant sources; leaves expire every 6 s.
      if (!reduced) {
        const limit = v.width < 600 ? 24 : 64;
        let slot = 0;
        for (const { tile: t, rect: r } of this.visible) {
          const w = weatherAt(...t.center, utc),
            gust = gustAt(...t.center, seconds, w.wind);
          if (gust < 0.08) continue;
          for (const p of t.plants) {
            if (slot >= limit) break;
            if (
              p.asset === "pine" ||
              p.asset === "snowPine" ||
              p.asset === "palm" ||
              p.asset === "conifer" ||
              p.asset === "snowConifer" ||
              p.asset === "coconut"
            )
              continue;
            const phase = hash(Math.floor(p.x), Math.floor(p.y), 272133),
              age = (seconds + phase * 6) % 6;
            if (phase > 0.22 || age > 4) continue;
            const sx = r.width / 256,
              sy = r.height / 256,
              x = r.x + p.x * sx,
              y = r.y + (p.y - p.height * 0.7) * sy;
            if (
              x < 0 ||
              y < 0 ||
              x > v.width ||
              y > v.height ||
              this.resolve(x, y)?.tile !== t ||
              v.excludesPlant?.(x, y, p.id)
            )
              continue;
            const k = slot++ * 5;
            this.leaves[k] = x + Math.cos(w.direction) * age * 4;
            this.leaves[k + 1] = y + age * 2 + Math.sin(age * 2 + phase) * 2;
            this.leaves[k + 2] = age;
            this.leaves[k + 3] = gust;
            this.leaves[k + 4] = phase;
            out.fillStyle = phase < 0.1 ? "#c1b967" : "#91ac63";
            out.globalAlpha = Math.min(0.65, (4 - age) * 0.4);
            out.fillRect(
              Math.round(this.leaves[k]),
              Math.round(this.leaves[k + 1]),
              2,
              1,
            );
          }
        }
        out.globalAlpha = 1;
        this.metrics.leaves = slot;
      }
      // Clouds are block silhouettes at 5 Hz, with independent sizes and gradual opacity.
      const cloudTime = reduced ? 0 : Math.floor(seconds * 5) / 5,
        spacing = 180,
        drift = reduced ? 0 : cloudTime * 0.65;
      for (
        let gy = Math.floor((-anchor.y - drift * 0.24) / spacing) - 1;
        gy < (v.height - anchor.y - drift * 0.24) / spacing &&
        this.metrics.clouds < 32;
        gy++
      )
        for (
          let gx = Math.floor((-anchor.x - drift) / spacing) - 1;
          gx < (v.width - anchor.x - drift) / spacing &&
          this.metrics.clouds < 32;
          gx++
        ) {
          const r = hash(gx, gy, 271944),
            x = anchor.x + gx * spacing + drift,
            y = anchor.y + gy * spacing + drift * 0.24 + r * 35;
          const ll = v.unproject(x + 70, y + 20);
          if (ll[1] < -90 || ll[1] > 90 || !this.resolve(x + 70, y + 20))
            continue;
          const w = weatherAt(...ll, utc),
            formation = reduced
              ? 1
              : 0.7 + 0.3 * Math.sin(cloudTime * 0.025 + r * 6);
          if (w.cloud < 0.12 || r > w.cloud) continue;
          const size = 8 + Math.floor(r * 8);
          out.fillStyle = "#dbe7dc";
          out.globalAlpha = Math.min(0.2, w.cloud * 0.23 * formation);
          // Wind changes the local offset, not cloud identity on every frame.
          const windX = reduced
            ? 0
            : Math.round(
                Math.sin(cloudTime * 0.012 + r * 6) *
                  w.wind *
                  15 *
                  Math.cos(w.direction),
              );
          for (let row = 0; row < 4; row++) {
            const inset = row === 0 || row === 3 ? 2 : 0;
            out.fillRect(
              Math.round(x + windX + inset * size),
              Math.round(y + row * size),
              size * (10 - inset * 2),
              size,
            );
          }
          out.globalAlpha = 1;
          this.metrics.clouds++;
        }
    }
    c.imageSmoothingEnabled = false;
    c.save();
    c.beginPath();
    for (const { rect: r } of this.visible) c.rect(r.x, r.y, r.width, r.height);
    c.clip();
    c.drawImage(this.atmosphere, 0, 0, v.width, v.height);
    c.restore();
    this.metrics.weatherMs = performance.now() - start;
  }
  dispose() {
    this.disposed = true;
    this.cache.clear();
    for (const surface of [this.vegetation, this.water, this.atmosphere])
      if (surface) surface.width = surface.height = 1;
    this.visible = [];
  }
}
