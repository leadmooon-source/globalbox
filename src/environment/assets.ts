import { ASSET_DATA as LEGACY_ASSETS } from "./asset-data.ts";
import {
  NATURE_ASSETS,
  type NatureAssetId,
} from "../../shared/nature-assets.ts";
export const ASSET_DATA = {
  ...LEGACY_ASSETS,
  ...(Object.fromEntries(
    Object.entries(NATURE_ASSETS).map(([id, a]) => [
      id,
      {
        ...a,
        width: Math.round(
          (a.width / a.height) *
            (a.type === "Tree" ? (id === "youngOak" ? 64 : 96) : 48),
        ),
        height: a.type === "Tree" ? (id === "youngOak" ? 64 : 96) : 48,
      },
    ]),
  ) as unknown as Record<
    NatureAssetId,
    {
      width: number;
      height: number;
      biomes: readonly number[];
      mirror: boolean;
    }
  >),
};
export type PlantAsset = keyof typeof ASSET_DATA;
export type ArtContext =
  CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
export const assetImages = new Map<string, ImageBitmap>();
let loading: Promise<void> | undefined;
/** Shared by windows and workers. Failed loads can be retried; no generic replacement tree. */
export function loadLifeAssets(): Promise<void> {
  if (loading) return loading;
  const names = [
    ...Object.keys(ASSET_DATA),
    ...[
      "chick",
      "chicken-blonde",
      "chicken-red",
      "cow-female",
      "cow-male",
      "crops",
      "grass",
    ].map((n) => `${n}-sheet`),
  ];
  loading = Promise.allSettled(
    names.map(async (name) => {
      if (assetImages.has(name)) return;
      const response = await fetch(
        `${import.meta.env.BASE_URL}${name in NATURE_ASSETS ? "sandbox" : "world-life"}/${name}.png`,
      );
      if (!response.ok)
        throw Error(`World asset ${name}: HTTP ${response.status}`);
      assetImages.set(name, await createImageBitmap(await response.blob()));
    }),
  )
    .then((results) => {
      const failure = results.find((r) => r.status === "rejected");
      if (failure?.status === "rejected") throw failure.reason;
    })
    .catch((error) => {
      loading = undefined;
      throw error;
    });
  return loading;
}
export function drawFarmAnimal(
  c: ArtContext,
  species: string,
  x: number,
  y: number,
  size: number,
  time: number,
  id = 0,
  heading = 1,
): boolean {
  const name =
    species === "cow"
      ? id % 2
        ? "cow-male"
        : "cow-female"
      : species === "chicken"
        ? id % 5 === 0
          ? "chick"
          : id % 2
            ? "chicken-red"
            : "chicken-blonde"
        : null;
  const image = name && assetImages.get(`${name}-sheet`);
  if (!image) return false;
  const frameSize = species === "cow" ? 32 : 16,
    frame = time ? Math.floor(time * 5 + id) % 4 : 0;
  c.save();
  c.imageSmoothingEnabled = false;
  c.translate(Math.round(x), Math.round(y));
  c.scale(heading, 1);
  // The supplied side-view cows face left, chickens face right.
  if (species === "cow") c.scale(-1, 1);
  c.drawImage(
    image,
    frame * frameSize,
    0,
    frameSize,
    frameSize,
    -size / 2,
    -size + 1,
    size,
    size,
  );
  c.restore();
  return true;
}
