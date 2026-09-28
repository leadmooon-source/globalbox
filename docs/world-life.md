# World life

The Equal Earth atlas (`/atlas.html`) and the main Mercator map share Canvas environmental layers, an official sprite catalog, deterministic vegetation and UTC regional weather. MapLibre retains its own camera/raster layer; the same environmental overlay is used by its Canvas fallback.

## Official art

`data/world-pack/source.json` pins the supplied RAR and eight extracted sheets. `public/world-life/source.json` records original sources, checksums, transparent crops, pivots, frame sizes and biome assignments. The five existing biome trees complement the pack's maple, growth stages, grass, stump, cows and chickens. The green pine changes only snow-highlight palette entries. Missing stones, flowers and branches use small original pixel motifs. Spring crops appear only in existing wheat/corn farms. There is no seasonal cycle in this pass.

Regenerate with `npm run world-life:prepare`. To re-extract the exact selected files from the RAR first, use `python3 scripts/extract-world-pack.py` (Python 3 and system libarchive with RAR5 support). Extracted inputs are committed, so normal build/startup does not need RAR support.

## Generation and masks

Candidates have irregular positions and deterministic priorities. Multi-scale forest cover creates clearings and patches; moisture, latitude/temperature, slope, elevation and shoreline distance gate acceptance. Full rectangular sprite bounds conservatively cover opaque pixels, shadows and gust displacement. Entire footprints must fit on land. Frozen biomes and elevations above the tree line reject trees. Candidates lose to overlapping higher-priority neighbors independently of processing order. The 32-cell geographic gutters retain cross-chunk context; comparisons of two padded regions use their safe interior, not the outermost padding.

Mercator detail uses nested geographic candidate tiers: prior candidates retain their position and identity as more candidates become visible. Refined geography can veto an earlier candidate. Mercator tiles now follow the existing camera through zoom 24, rasterizing the same Natural Earth vectors rather than magnifying level 20. Equal Earth retains its existing fixed world coordinates. Geographic fields and Natural Earth files are never modified by art generation.

## Rendering and budgets

Logical order: Ocean Base, Ocean Details, Terrain Base, Terrain Pixel Details, Rivers & Lakes, Vegetation, Natural Objects, Animals, Weather, Atmospheric Effects. Static ground layers remain fused into cached opaque terrain tiles. Water accents are masked to water; vegetation and objects use a separate cached transparent viewport. Local buildings exclude environmental plants so territories do not paint a second forest over the global one. Existing animal simulation and server gameplay continue independently.

Worker replies add packed terrain/shore/channel orientation, plants, natural objects and bounded decorative animal sources. Metadata retained beside ground tiles is included in the original terrain cache byte count. Environmental caches are limited to 8 MiB; three viewport surfaces use at most 6 MiB, leaving 2 MiB for shared sprite art and pools within the 16 MiB extra budget. Canvas tile selection is capped at 52 requests to account for added metadata; atlas requests are capped at 64. Buffers and surfaces are released on disposal.

Water/rain update at up to 15 Hz, gust vegetation at 8 Hz, and cloud shapes at 5 Hz. Camera composition remains responsive independently of those clocks. Effects are viewport-only, with <=64 leaves (24 on narrow screens), <=32 clouds, <=96 rain/lake ripples (40 on narrow screens) and <=24 decorative animals. Hidden pages stop rendering. Reduced motion freezes the environmental clock, suppresses falling rain/leaves and holds water and cloud patterns still. Input and server simulation remain available.

## Regional climate

`weatherAt(longitude, latitude, utcMilliseconds, seed)` is pure from the caller's perspective. Ten-degree geographic control regions blend across boundaries. Each region has a deterministic offset within five-minute periods and approximately 30-second staged cloud/wind/rain transitions. At most one of each four neighboring regions is a rain nucleus per epoch; transitions and geographic interpolation soften this constraint. Frozen regions veto liquid rain after interpolation. This is decorative weather, not scientific forecasting.

`EnvironmentClock.setForTesting()` accepts a fixed UTC timestamp in development/tests only. In the Vite shared browser, inspect `activeEnvironment` from `/src/game/Map.tsx` or `worldState.world.environment` from `/src/main.ts`. `metrics` exposes layer work times, cache/surface bytes, particles and asset failures. No debug controls are added to the player interface.

## Validation

`tests/environment.test.ts` covers provenance, full footprints, collisions, frozen terrain, river direction, border determinism, nested candidate identity, UTC transitions, reduced motion, memory bounds and disposal. Existing geography, streaming, camera, territory and animal tests remain mandatory.

Visual acceptance: Amazon, Sahara, Europe, Siberia, Andes, Australia, Greenland and Antarctica on both pages; global/medium/high/maximum zoom; coast, river and lake; rain, clouds and gusts; pan/resize/touch; desktop/mobile sizes and reduced motion. Use a fixed development UTC time to reproduce weather. The shared sandbox browser may lack WebGL2; explicitly record that limitation separately from Canvas fallback and PNG worker protocol validation.

The current repository has SQLite in Prisma but its older integration runner still issues PostgreSQL `CREATE SCHEMA`/`DROP SCHEMA`; that gate cannot run against SQLite without a separate backend migration repair. The world-life changes do not modify persistence or migrate production data.
