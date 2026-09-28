/// <reference lib="webworker" />
import landUrl from "../../data/geography/land.json?url";
import lakeUrl from "../../data/geography/lakes.json?url";
import riverUrl from "../../data/geography/rivers_lake_centerlines.json?url";
import { prepareVectors, rasterRegion, type TileKey } from "./geography.ts";
import { renderSurface } from "./surface.ts";
const scope = self as unknown as DedicatedWorkerGlobalScope;
const vectors = Promise.all(
  [landUrl, lakeUrl, riverUrl].map(async (url) => {
    const res = await fetch(url);
    if (!res.ok) throw Error(`Geography HTTP ${res.status}`);
    return prepareVectors(await res.json());
  }),
).then(([land, lakes, rivers]) => ({ land, lakes, rivers }));

const TREE_ASSETS: Record<number, ImageBitmap> = {};
let treesLoading: Promise<void> | null = null;

function ensureTreesLoaded() {
  if (treesLoading) return treesLoading;
  const load = (src: string, id: number) =>
    fetch(new URL(src, self.location.origin))
      .then((r) => r.blob())
      .then(createImageBitmap)
      .then((img) => {
        TREE_ASSETS[id] = img;
      })
      .catch((e) => console.error("Tree load error:", src, e));
  treesLoading = Promise.all([
    load("/forest.png", 0),
    load("/jungle.png", 1),
    load("/snow.png", 2),
    load("/savanna.png", 3),
    load("/beach.png", 4),
  ]).then(() => {});
  return treesLoading;
}

scope.onmessage = async (
  e: MessageEvent<{ id: number; key: TileKey; format: "bitmap" | "png" }>,
) => {
  const { id, key, format } = e.data,
    start = performance.now();
  try {
    const useImages = key.z > 8;
    if (useImages) await ensureTreesLoaded();
    
    const trees: { x: number; y: number; b: number }[] = [];
    const region = rasterRegion(key, await vectors),
      pixels = renderSurface(region, { detail: key.z, vegetation: true, trees: useImages ? trees : undefined });
    const canvas = new OffscreenCanvas(512, 512);
    const ctx = canvas.getContext("2d")!;
    ctx.putImageData(new ImageData(pixels, 512, 512), 0, 0);

    if (useImages) {
      // Sort trees by Y so they overlap correctly
      trees.sort((a, b) => a.y - b.y);
      for (const t of trees) {
        // Map biome to variant (simplified logic similar to sprites.ts)
        const variant = t.b === 4 ? 2 : t.b === 2 ? 1 : t.b === 5 ? 3 : t.b === 6 ? 4 : 0;
        const img = TREE_ASSETS[variant] || TREE_ASSETS[0];
        if (img) {
          const w = img.width * 0.5;
          const h = img.height * 0.5;
          // Coordinates in surface.ts are in 256x256 grid, canvas is 512x512
          // gx = ox + x * 2, so we draw at (x * 2, y * 2)
          ctx.drawImage(img, t.x * 2 - w / 2, t.y * 2 - h + 4, w, h);
        }
      }
    }

    if (format === "png") {
      const data = await (
        await canvas.convertToBlob({ type: "image/png" })
      ).arrayBuffer();
      scope.postMessage({ id, key, data, ms: performance.now() - start }, [
        data,
      ]);
    } else {
      const bitmap = canvas.transferToImageBitmap();
      scope.postMessage({ id, key, bitmap, ms: performance.now() - start }, [
        bitmap,
      ]);
    }
  } catch (error) {
    scope.postMessage({
      id,
      key,
      error: error instanceof Error ? error.message : String(error),
    });
  }
};
