import type { Region } from "../world/types.ts";
import { renderSurface } from "../terrain/surface.ts";
/** Only static ground is baked here; vegetation and water motion have separate caches. */
export function renderChunk(region: Region): ImageBitmap {
  const canvas = new OffscreenCanvas(512, 512),
    ctx = canvas.getContext("2d")!;
  ctx.imageSmoothingEnabled = false;
  const pixels = renderSurface(region, {
    detail: 4 - Math.log2(region.step),
    vegetation: region.step > 2,
  });
  ctx.putImageData(new ImageData(pixels, 512, 512), 0, 0);
  return canvas.transferToImageBitmap();
}
