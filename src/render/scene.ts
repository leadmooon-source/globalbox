import type { Animal, Species } from "../world/types.ts";
import { chunkBounds, stepAt, createProjection } from "../world/config.ts";
import type { ChunkWorld } from "../streaming/world.ts";
import type { Camera } from "../input/camera.ts";
import { animalSprite } from "./sprites.ts";
import { drawFarmAnimal } from "../environment/assets.ts";
import type { EnvironmentView } from "../environment/renderer.ts";
export class Scene {
  readonly world: ChunkWorld;
  private readonly sprites = new Map<Species, OffscreenCanvas[]>();
  private readonly projection = createProjection();
  constructor(world: ChunkWorld) {
    this.world = world;
    for (const species of [
      "chicken",
      "pig",
      "cow",
      "deer",
      "elephant",
      "camel",
      "penguin",
    ] as Species[])
      this.sprites.set(species, [
        animalSprite(species, 0),
        animalSprite(species, 1),
      ]);
  }
  draw(
    ctx: CanvasRenderingContext2D,
    camera: Camera,
    animals: Animal[],
    time: number,
    reducedMotion: boolean,
  ): void {
    const { width, height, x, y, scale } = camera;
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = "#10365d";
    ctx.fillRect(0, 0, width, height);
    const minX = Math.max(0, -x / scale),
      minY = Math.max(0, -y / scale),
      maxX = Math.min(this.world.width, (width - x) / scale),
      maxY = Math.min(this.world.height, (height - y) / scale);
    const chunks = [...this.world.cache.entries.entries()]
      .filter(([, chunk]) => {
        const b = chunkBounds(chunk.key);
        return (
          chunk.key.level <= this.world.level &&
          b.x < maxX &&
          b.y < maxY &&
          b.x + b.size > minX &&
          b.y + b.size > minY
        );
      })
      .sort((a, b) => a[1].key.level - b[1].key.level);
    for (const [id, chunk] of chunks) {
      this.world.cache.get(id);
      if (chunk.environment && !this.world.environment.cache.peek(id))
        this.world.environment.put(chunk.environment);
      const b = chunkBounds(chunk.key),
        left = Math.max(b.x, minX),
        top = Math.max(b.y, minY),
        right = Math.min(b.x + b.size, maxX),
        bottom = Math.min(b.y + b.size, maxY),
        pixelScale = 2 / stepAt(chunk.key.level);
      const dx = Math.round(x + left * scale),
        dy = Math.round(y + top * scale),
        dw = Math.round(x + right * scale) - dx,
        dh = Math.round(y + bottom * scale) - dy;
      ctx.drawImage(
        chunk.bitmap,
        (left - b.x) * pixelScale,
        (top - b.y) * pixelScale,
        (right - left) * pixelScale,
        (bottom - top) * pixelScale,
        dx,
        dy,
        dw,
        dh,
      );
    }
    const view: EnvironmentView = {
      width,
      height,
      level: this.world.level,
      signature: `${x}/${y}/${scale}`,
      bounds: (t) => ({
        x: x + t.originX * scale,
        y: y + t.originY * scale,
        width: 256 * t.step * scale,
        height: 256 * t.step * scale,
      }),
      project: (lon, lat) => {
        const p = this.projection([lon, lat]) ?? [0, 0];
        return { x: x + p[0] * scale, y: y + p[1] * scale };
      },
      unproject: (sx, sy) =>
        (this.projection.invert?.([(sx - x) / scale, (sy - y) / scale]) ?? [
          0, 90,
        ]) as [number, number],
    };
    this.world.environment.drawGround(ctx, view, reducedMotion);
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(scale, scale);
    for (const animal of [...animals].sort((a, b) => a.y - b.y)) {
      if (
        animal.x < minX - 8 ||
        animal.y < minY - 8 ||
        animal.x > maxX + 8 ||
        animal.y > maxY + 8 ||
        scale < 0.5
      )
        continue;
      const frame =
        !reducedMotion && animal.waiting <= 0 ? Math.floor(time * 5) % 2 : 0;
      if (
        drawFarmAnimal(
          ctx,
          animal.species,
          animal.x,
          animal.y,
          animal.species === "cow" ? 6 : 4,
          reducedMotion || animal.waiting > 0 ? 0 : time,
          animal.id,
          animal.heading,
        )
      )
        continue;
      const sprite = this.sprites.get(animal.species)![frame];
      ctx.save();
      ctx.translate(Math.round(animal.x * 2) / 2, Math.round(animal.y * 2) / 2);
      ctx.scale(animal.heading / 2, 0.5);
      ctx.fillStyle = "#314f493d";
      ctx.fillRect(-2, 0, 5, 1);
      ctx.drawImage(sprite, -Math.floor(sprite.width / 2), -sprite.height + 1);
      ctx.restore();
    }
    ctx.restore();
    this.world.environment.drawWeather(ctx, view, reducedMotion);
  }
}
