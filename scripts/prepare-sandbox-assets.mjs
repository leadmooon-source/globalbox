import { format } from "prettier";
import { createCanvas, loadImage } from "@napi-rs/canvas";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";
// Curated, non-overlapping source rectangles. The sheets have opaque backgrounds.
const crops = [
  ["oak", "trees", [14, 10, 138, 162], "Tree", [2, 6]],
  ["birch", "trees", [799, 188, 95, 143], "Tree", [2]],
  ["conifer", "trees", [122, 338, 121, 133], "Tree", [3, 8]],
  ["snowConifer", "trees", [355, 337, 107, 134], "Tree", [3, 8]],
  ["tropical", "trees", [647, 723, 198, 177], "Tree", [1]],
  ["savanna", "trees", [575, 546, 180, 160], "Tree", [4]],
  ["coconut", "trees", [878, 350, 137, 165], "Tree", [1, 5]],
  ["youngOak", "trees", [132, 118, 64, 74], "Tree", [2, 6]],
  ["bush", "trees", [19, 900, 53, 51], "Bush", [1, 2, 4, 6]],
  ["flowers", "trees", [771, 899, 72, 55], "Flower", [1, 2, 6]],
  ["log", "trees", [880, 900, 65, 48], "Log", [1, 2, 3, 4, 6]],
  ["cutStump", "trees", [949, 901, 57, 51], "Stump", [1, 2, 3, 4, 6]],
  ["branch", "trees", [1170, 959, 57, 44], "Log", [1, 2, 3, 6]],
  ["stone", "rocks", [428, 59, 76, 80], "Rock", [1, 2, 3, 4, 5, 6, 7, 8]],
  ["sandstone", "rocks", [321, 325, 79, 88], "Rock", [4, 5]],
  ["iron", "rocks", [11, 609, 99, 81], "Ore", [3, 8]],
  ["copper", "rocks", [396, 610, 99, 78], "Ore", [4, 5, 8]],
  ["coal", "rocks", [650, 799, 100, 58], "Ore", [2, 3, 8]],
  ["crystal", "rocks", [208, 695, 49, 67], "Crystal", [8]],
  ["ice", "rocks", [648, 426, 89, 83], "Ice", [7, 9]],
];
const manifest = { version: 1, season: "spring", sources: {}, assets: {} };
await mkdir("public/sandbox", { recursive: true });
for (const name of ["trees", "rocks"]) {
  const bytes = await readFile(`data/sandbox-pack/${name}.png`);
  const im = await loadImage(bytes);
  manifest.sources[name] = {
    path: `data/sandbox-pack/${name}.png`,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    width: im.width,
    height: im.height,
  };
  for (const [id, sheet, rect, type, biomes] of crops.filter(
    (c) => c[1] === name,
  )) {
    const [sx, sy, w, h] = rect,
      c = createCanvas(w, h),
      ctx = c.getContext("2d");
    ctx.drawImage(im, sx, sy, w, h, 0, 0, w, h);
    const pixels = ctx.getImageData(0, 0, w, h),
      d = pixels.data,
      seen = new Uint8Array(w * h),
      queue = [];
    for (let x = 0; x < w; x++) queue.push(x, (h - 1) * w + x);
    for (let y = 0; y < h; y++) queue.push(y * w, y * w + w - 1);
    const neutral = (k) =>
      Math.max(d[k], d[k + 1], d[k + 2]) - Math.min(d[k], d[k + 1], d[k + 2]) <
        24 && Math.min(d[k], d[k + 1], d[k + 2]) > 160;
    for (const i of queue) seen[i] = 1;
    for (let q = 0; q < queue.length; q++) {
      const i = queue[q],
        x = i % w,
        y = Math.floor(i / w),
        k = i * 4;
      for (const [xx, yy] of [
        [x - 1, y],
        [x + 1, y],
        [x, y - 1],
        [x, y + 1],
      ]) {
        if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
        const j = yy * w + xx,
          l = j * 4;
        if (seen[j]) continue;
        const delta = Math.max(
          Math.abs(d[k] - d[l]),
          Math.abs(d[k + 1] - d[l + 1]),
          Math.abs(d[k + 2] - d[l + 2]),
        );
        if (name === "rocks" ? neutral(l) : delta < 6) {
          seen[j] = 1;
          queue.push(j);
        }
      }
    }
    for (let i = 0; i < seen.length; i++) if (seen[i]) d[i * 4 + 3] = 0;
    const masks = {
      birch: [
        [0, 0],
        [95, 0],
        [90, 96],
        [66, 112],
        [61, 143],
        [26, 143],
        [25, 108],
        [0, 90],
      ],
      conifer: [
        [40, 0],
        [80, 0],
        [121, 100],
        [77, 112],
        [77, 133],
        [47, 133],
        [47, 112],
        [0, 100],
      ],
      snowConifer: [
        [40, 0],
        [70, 0],
        [107, 98],
        [69, 112],
        [69, 134],
        [39, 134],
        [39, 112],
        [0, 98],
      ],
      savanna: [
        [0, 0],
        [180, 0],
        [180, 95],
        [115, 110],
        [111, 160],
        [70, 160],
        [72, 110],
        [0, 95],
      ],
      coconut: [
        [0, 0],
        [137, 0],
        [137, 94],
        [87, 106],
        [87, 165],
        [57, 165],
        [57, 106],
        [0, 94],
      ],
      tropical: [
        [4, 0],
        [192, 0],
        [192, 165],
        [184, 177],
        [15, 177],
        [4, 160],
      ],
    };
    const mask = masks[id];
    if (mask) {
      const mc = createCanvas(w, h),
        mx = mc.getContext("2d");
      mx.beginPath();
      mask.forEach(([x, y], i) => (i ? mx.lineTo(x, y) : mx.moveTo(x, y)));
      mx.closePath();
      mx.fill();
      const md = mx.getImageData(0, 0, w, h).data;
      for (let i = 0; i < w * h; i++) if (md[i * 4 + 3] < 255) d[i * 4 + 3] = 0;
    }

    // Keep the largest connected silhouette, removing neighboring foliage and isolated background specks.
    const visited = new Uint8Array(w * h);
    let largest = [];
    for (let i = 0; i < w * h; i++)
      if (d[i * 4 + 3] && !visited[i]) {
        const component = [i];
        visited[i] = 1;
        for (let n = 0; n < component.length; n++) {
          const p = component[n],
            x = p % w,
            y = Math.floor(p / w);
          for (const [xx, yy] of [
            [x - 1, y],
            [x + 1, y],
            [x, y - 1],
            [x, y + 1],
          ]) {
            if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
            const j = yy * w + xx;
            if (!visited[j] && d[j * 4 + 3]) {
              visited[j] = 1;
              component.push(j);
            }
          }
        }
        if (component.length > largest.length) largest = component;
      }
    const keep = new Set(largest);
    let x0 = w,
      y0 = h,
      x1 = 0,
      y1 = 0;
    for (let i = 0; i < w * h; i++) {
      if (!keep.has(i)) d[i * 4 + 3] = 0;
      else {
        d[i * 4 + 3] = 255;
        x0 = Math.min(x0, i % w);
        x1 = Math.max(x1, i % w);
        y0 = Math.min(y0, Math.floor(i / w));
        y1 = Math.max(y1, Math.floor(i / w));
      }
    }
    ctx.putImageData(pixels, 0, 0);
    const out = createCanvas(x1 - x0 + 1, y1 - y0 + 1);
    out
      .getContext("2d")
      .drawImage(c, x0, y0, out.width, out.height, 0, 0, out.width, out.height);
    const png = out.toBuffer("image/png");
    await writeFile(`public/sandbox/${id}.png`, png);
    manifest.assets[id] = {
      id,
      type,
      biomes,
      width: out.width,
      height: out.height,
      crop: [sx + x0, sy + y0, out.width, out.height],
      source: sheet,
      pivot: [Math.floor(out.width / 2), out.height - 1],
      rarity: type === "Crystal" ? 0.02 : 1,
      season: "spring",
      variants: [],
      collision: type !== "Flower",
      harvestable: ["Tree", "Rock", "Ore", "Crystal"].includes(type),
      mirror: false,
      sha256: createHash("sha256").update(png).digest("hex"),
    };
  }
}
await writeFile(
  "public/sandbox/catalog.json",
  JSON.stringify(manifest, null, 2) + "\n",
);
await writeFile(
  "shared/nature-assets.ts",
  await format(
    "// Generated by scripts/prepare-sandbox-assets.mjs.\nexport const NATURE_ASSETS = " +
      JSON.stringify(manifest.assets, null, 2) +
      " as const;\nexport type NatureAssetId = keyof typeof NATURE_ASSETS;\n",
    { parser: "typescript" },
  ),
);
const contact = createCanvas(800, Math.ceil(crops.length / 5) * 180),
  cc = contact.getContext("2d");
cc.fillStyle = "#638d5c";
cc.fillRect(0, 0, contact.width, contact.height);
let n = 0;
for (const [id] of crops) {
  const im = await loadImage(`public/sandbox/${id}.png`),
    x = (n % 5) * 160,
    y = Math.floor(n / 5) * 180;
  cc.drawImage(
    im,
    x + (160 - im.width * 0.8) / 2,
    y,
    im.width * 0.8,
    im.height * 0.8,
  );
  cc.fillStyle = "#fff";
  cc.fillText(id, x + 10, y + 170);
  n++;
}
await writeFile("/tmp/sandbox-assets.png", contact.toBuffer("image/png"));
