import { drawFarmAnimal } from "../environment/assets.ts";
export function animal(
  c: CanvasRenderingContext2D,
  x: number,
  y: number,
  scale: number,
  index: number,
  time: number,
) {
  if (
    drawFarmAnimal(
      c,
      index === 1 ? "pig" : index === 0 ? "cow" : "chicken",
      x,
      y,
      scale * 12,
      time / 1000,
      index,
    )
  )
    return;
  c.save();
  c.translate(Math.round(x), Math.round(y));
  c.scale(scale, scale);
  c.fillStyle = "#50664b33";
  c.fillRect(-3, 1, 8, 2);
  c.fillStyle = index === 1 ? "#d5a6a0" : "#ece4c9";
  c.fillRect(-3, -3, 7, 4);
  c.fillRect(3, -5, 3, 4);
  c.fillStyle = "#766450";
  c.fillRect(-2, 1, 1, 2);
  c.fillRect(2, 1, 1, 2);
  if (index === 0) c.fillRect(-1, -3, 3, 2);
  c.fillStyle = "#4c5140";
  c.fillRect(5, -4, 1, 1);
  if (time && Math.floor(time / 900) % 2) c.fillRect(-4, -3, 1, 2);
  c.restore();
}
export const terrainCacheBytes = () => 0;
