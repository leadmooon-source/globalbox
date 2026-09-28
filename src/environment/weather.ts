import { hash, noise } from "../world/noise.ts";
import { climateAt } from "../world/climate.ts";
import { Biome } from "../world/types.ts";
import { visualTemperature } from "../world/vegetation.ts";
export type WeatherState = "CLEAR" | "CLOUDY" | "LIGHT_RAIN" | "RAIN" | "WINDY";
export interface Weather {
  state: WeatherState;
  cloud: number;
  rain: number;
  wind: number;
  direction: number;
}
export const WEATHER_PERIOD = 300;
export const WEATHER_TRANSITION = 30;
const smooth = (n: number) => {
  const t = Math.max(0, Math.min(1, n));
  return t * t * (3 - 2 * t);
};
const climates = new Map<string, ReturnType<typeof climateAt>>();
function climate(rx: number, ry: number, seed: number) {
  const key = `${seed}/${rx}/${ry}`;
  let value = climates.get(key);
  if (!value) {
    value = climateAt(rx * 10 - 175, ry * 10 - 85, seed);
    if (climates.size >= 512) climates.delete(climates.keys().next().value!);
    climates.set(key, value);
  }
  return value;
}
function target(rx: number, ry: number, epoch: number, seed: number): Weather {
  const c = climate(rx, ry, seed),
    lat = ry * 10 - 85,
    r = hash(rx, ry, seed + epoch * 31);
  // Only one of four neighbors is a rain nucleus in an epoch. Blending can soften
  // boundaries, but cannot turn the entire planet into a simultaneous rain event.
  const nucleus = Math.floor(
    hash(Math.floor(rx / 2), Math.floor(ry / 2), seed + epoch * 17) * 4,
  );
  const canRain =
    nucleus === (((rx % 2) + 2) % 2) + 2 * (((ry % 2) + 2) % 2) &&
    c.biome !== Biome.Polar &&
    visualTemperature(lat, c.elevation) > 1 &&
    c.moisture > 0.24;
  const rain =
    canRain && r < c.moisture ? (r < c.moisture * 0.6 ? 0.8 : 0.36) : 0;
  const cloud = rain ? 0.8 : r < 0.32 ? 0.52 : r < 0.52 ? 0.28 : 0.08;
  const wind = rain ? 0.6 : r > 0.78 ? 0.62 : 0.14;
  return {
    state:
      rain > 0.5
        ? "RAIN"
        : rain
          ? "LIGHT_RAIN"
          : wind > 0.5
            ? "WINDY"
            : cloud > 0.3
              ? "CLOUDY"
              : "CLEAR",
    rain,
    cloud,
    wind,
    direction: hash(rx, ry, seed + 15) * Math.PI * 2,
  };
}
function regionWeather(
  rx: number,
  ry: number,
  seconds: number,
  seed: number,
): Weather {
  rx = ((rx % 36) + 36) % 36;
  ry = Math.max(0, Math.min(17, ry));
  const shifted = seconds + hash(rx, ry, seed + 7) * 120,
    epoch = Math.floor(shifted / WEATHER_PERIOD),
    phase = shifted - epoch * WEATHER_PERIOD;
  const a = target(rx, ry, epoch - 1, seed),
    b = target(rx, ry, epoch, seed);
  const cloud = smooth(phase / WEATHER_TRANSITION),
    wind = smooth((phase - 5) / WEATHER_TRANSITION),
    rain = smooth((phase - 12) / WEATHER_TRANSITION);
  return {
    ...b,
    cloud: a.cloud + (b.cloud - a.cloud) * cloud,
    wind: a.wind + (b.wind - a.wind) * wind,
    rain: a.rain + (b.rain - a.rain) * rain,
  };
}
/** UTC milliseconds; callers can inject an exact instant for reproducible visual tests. */
export function weatherAt(
  lon: number,
  lat: number,
  utcMs: number,
  seed = 271828,
): Weather {
  const gx = (lon + 175) / 10,
    gy = (lat + 85) / 10,
    rx = Math.floor(gx),
    ry = Math.floor(gy),
    fx = smooth(gx - rx),
    fy = smooth(gy - ry);
  const result: Weather = {
    state: "CLEAR",
    rain: 0,
    cloud: 0,
    wind: 0,
    direction: 0,
  };
  let dx = 0,
    dy = 0;
  for (let y = 0; y < 2; y++)
    for (let x = 0; x < 2; x++) {
      const w = (x ? fx : 1 - fx) * (y ? fy : 1 - fy),
        s = regionWeather(rx + x, ry + y, utcMs / 1000, seed);
      result.cloud += s.cloud * w;
      result.rain += s.rain * w;
      result.wind += s.wind * w;
      dx += Math.cos(s.direction) * w;
      dy += Math.sin(s.direction) * w;
    }
  // This final geographic veto also excludes blending rain across the ice edge.
  if (
    lat < -61 ||
    lat > 77 ||
    (lat > 60 &&
      Math.exp(-(((lon + 41) / 18) ** 2 + ((lat - 75) / 14) ** 2) * 1.4) > 0.32)
  )
    result.rain = 0;
  result.direction = Math.atan2(dy, dx);
  result.state =
    result.rain > 0.35
      ? "RAIN"
      : result.rain > 0.04
        ? "LIGHT_RAIN"
        : result.wind > 0.38
          ? "WINDY"
          : result.cloud > 0.3
            ? "CLOUDY"
            : "CLEAR";
  return result;
}
export function gustAt(
  lon: number,
  lat: number,
  seconds: number,
  wind: number,
  seed = 271828,
): number {
  const wave = noise(
    lon * 0.35 + seconds * 0.035,
    lat * 0.35 - seconds * 0.015,
    seed + 411,
  );
  return Math.max(0, (wave - 0.57) / 0.43) * (0.3 + wind);
}
/** Freeze environmental motion in reduced mode; camera and simulation clocks are separate. */
export class EnvironmentClock {
  private fixed: number | undefined;
  private simulation: number | undefined;
  setSimulationTime(utcMs: number | undefined) {
    this.simulation = utcMs;
  }
  private reducedAt: number | undefined;
  now(reduced = false): number {
    const now = this.fixed ?? this.simulation ?? Date.now();
    if (reduced) {
      this.reducedAt ??= now;
      return this.reducedAt;
    }
    this.reducedAt = undefined;
    return now;
  }
  setForTesting(utcMs: number | undefined) {
    if (typeof window !== "undefined" && !import.meta.env.DEV)
      throw Error("Clock override is only available in development");
    this.fixed = utcMs;
    this.reducedAt = undefined;
  }
}
