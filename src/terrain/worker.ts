/// <reference lib="webworker" />
import landUrl from "../../data/geography/land.json?url";
import lakeUrl from "../../data/geography/lakes.json?url";
import riverUrl from "../../data/geography/rivers_lake_centerlines.json?url";
import { prepareVectors, rasterRegion, type TileKey } from "./geography.ts";
import {
  buildEnvironmentTile,
  environmentTransfers,
} from "../environment/tile.ts";
import { renderSurface } from "./surface.ts";
const scope = self as unknown as DedicatedWorkerGlobalScope;
const vectors = Promise.all(
  [landUrl, lakeUrl, riverUrl].map(async (url) => {
    const res = await fetch(url);
    if (!res.ok) throw Error(`Geography HTTP ${res.status}`);
    return prepareVectors(await res.json());
  }),
).then(([land, lakes, rivers]) => ({ land, lakes, rivers }));

scope.onmessage = async (
  e: MessageEvent<{ id: number; key: TileKey; format: "bitmap" | "png" }>,
) => {
  const { id, key, format } = e.data,
    start = performance.now();
  try {
    const region = rasterRegion(key, await vectors);
    const environment = buildEnvironmentTile(
      region,
      `${key.z}/${key.x}/${key.y}`,
      key.z,
    );
    const pixels = renderSurface(region, {
      detail: key.z,
      vegetation: key.z < 7,
    });
    const canvas = new OffscreenCanvas(512, 512),
      ctx = canvas.getContext("2d")!;
    ctx.imageSmoothingEnabled = false;
    ctx.putImageData(new ImageData(pixels, 512, 512), 0, 0);

    if (format === "png") {
      const data = await (
        await canvas.convertToBlob({ type: "image/png" })
      ).arrayBuffer();
      scope.postMessage(
        { id, key, data, environment, ms: performance.now() - start },
        [data, ...environmentTransfers(environment)],
      );
    } else {
      const bitmap = canvas.transferToImageBitmap();
      scope.postMessage(
        { id, key, bitmap, environment, ms: performance.now() - start },
        [bitmap, ...environmentTransfers(environment)],
      );
    }
  } catch (error) {
    scope.postMessage({
      id,
      key,
      error: error instanceof Error ? error.message : String(error),
    });
  }
};
