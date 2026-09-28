# World sandbox

## Play

Open `/`, sign in or create a player, explore, and select **Adquirir território**. Draw a freehand boundary (or switch to vertices). The server shows geographic km², occupied area, available land and a virtual price. Confirm to create a community. Select a tree or stone in your territory to assign a worker. Select **Construir** and a clearing to place a building. Escape cancels tools. In development, **Comunidade → Inspeção: avançar 3 dias** exercises regeneration.

Ownership is required for extraction/building. Accounts, wallets, purchases, characters, nature, construction and events live in SQLite, not in the renderer. Currency is exclusively virtual; the existing simulated payment adapter is retained.

## Assets

`npm run sandbox:prepare` reproducibly extracts 20 individual sprites from the two approved September 28 attachments stored in `data/sandbox-pack/`. `public/sandbox/catalog.json` records source hashes, source rectangles, dimensions, pivot, type, compatible biomes, rarity, spring season, collision, harvestability and output hashes. Flood removal, curated silhouette masks and binary alpha remove the colored/checkerboard backgrounds. No blur, tint filter or synthesized replacement art is used.

The sheets include green broadleaf trees, birches, orchard/blossom trees, autumn/bare/snow variants, conifers, palms, willows, flat canopies, tropical roots/vines, saplings, shrubs, flowers, logs and stumps; the geology sheet includes granite, sandstone, slate, snow/ice, volcanic rock, ore, crystals and rubble. This spring catalog selects oak, birch, green/snow conifers, tropical trees, acacia, palms and young oak, plus bushes, flowers, logs, branches, stumps, stone, sandstone, iron, copper, coal, crystal and ice. Seasonal/ornamental variants remain in the original sheets for future seasons. The earlier approved Farm RPG pack continues to supply farm animals, crops and grass.

## Integration

- `src/world/vegetation.ts`: shared irregular candidate generator, biome/climate/altitude/shore suitability and complete silhouette collision checks.
- `server/region-nature.ts`: the same Natural Earth raster and plant generator, through an injected native Canvas adapter. Acquired regions materialize bounded local nature; global/regional views retain procedural instances. No planet-wide tree table or frame loop is allocated.
- `shared/nature.ts`: GameClock, configurable time units, entity state, deterministic regional resource generation and bounded regeneration search. Mature entities remain recorded after felling; regeneration never recreates them merely because a chunk reloads.
- `server/nature.ts`: authorized, idempotent work orders; approach → work → damage/fall or extraction → cargo → transport → storage. Inventory remains with the worker when storage is full. Exhausted minerals do not respawn. Forests regenerate only where the grid, neighbors and buildings permit.
- `server/simulation.ts`: persisted game time advances with bounded elapsed time; existing character, construction and farming behavior remains. Passive infinite wood/ore production is removed; extraction uses finite nodes. Atmosphere in `/` follows this clock; `/atlas.html` keeps its UTC visual clock.
- World events contain a type, actor, territory, timestamp, game time and JSON payload. Tree extraction payloads include identity, species, position, quantity and regeneration time. Human-facing history uses short descriptions.
- `server/geometry.ts`: geodesic area, land/lake/river margins, subtraction of existing ownership. Polygon holes and MultiPolygon parcels survive quote, purchase, Canvas/MapLibre hit testing and clipping. Purchase rechecks availability and debits the wallet atomically. The local navigation grid remains 64×64 per territory.
- `src/game/Map.tsx`: terrain/environment, resources/vegetation, buildings/animals/characters, weather, subtle territorial outline, selection, then DOM UI. Static ground remains cached; local nature and characters are culled to the viewport. Reduced motion removes swaying/falling displacement and atmospheric motion.

## Persistence/setup

The checked-in Prisma datasource is SQLite. Run `npm run db:generate` then `npm run db:deploy` against the intended private database. `db:deploy` now uses Prisma schema synchronization without `--accept-data-loss`; destructive changes fail rather than being accepted. Historical PostgreSQL migrations remain for reference and are not applied to SQLite. Back up an existing database before schema operations. No tracked `prisma/dev.db` is used for validation.

`npm run test:integration` creates a fresh temporary SQLite file, applies the schema, runs API/restart/race tests and removes the file. `@napi-rs/canvas` is a production dependency because authoritative territory materialization uses the same raster contract as the browser worker.

## Deliberate limits

This is the first playable regional sandbox. Nature is materialized for acquired territories; unowned vegetation can be inspected, and ownership is required to work it. Acquisition initializes a bounded set of local entities. Additional procedural trees revealed by zoom are materialized on selection after the server verifies them against the shared raster and generator. Rendering suppresses their original procedural IDs individually, so ownership does not replace the forest with a separate vegetation field. The 64×64 navigation grid conservatively rejects very thin parcels and water-adjacent sites. Elevation and ore distribution are illustrative game fields, not real geological deposits. Existing characters perform the available builder/farmer/woodcutter/miner roles; new economies and population systems are outside this pass.

The development time control is rejected in production. WebGL2 must be available to exercise the actual MapLibre path; Canvas uses the same geographic camera and environment contracts.
