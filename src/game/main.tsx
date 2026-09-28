import { labelNature } from "../../shared/nature-labels.ts";
import { createRoot } from "react-dom/client";
import { useEffect, useRef, useState } from "react";
import type { Polygon, MultiPolygon } from "geojson";
import { WorldMap, activeMap } from "./Map.tsx";
import {
  api,
  type User,
  type Territory,
  type World,
  type Quote,
} from "./types.ts";
import { visibleWorld, localRegions } from "./remote.ts";
import { WORLD_BOUNDS, type ViewBounds } from "../../shared/contracts.ts";
import { BUILDINGS, type BuildingKind } from "../../shared/game.ts";
import { GAME_TIME, type NatureNode } from "../../shared/nature.ts";
import { climateAt } from "../world/climate.ts";
import "./ui.css";
import "./sandbox.css";
const empty: World = {
  territories: [],
  events: [],
  total: 0,
  players: 0,
  state: { tick: 0, revision: 0, gameTime: 0 },
};
const biomes = [
  "Oceano",
  "Floresta tropical",
  "Floresta temperada",
  "Taiga",
  "Savana",
  "Deserto",
  "Campos",
  "Tundra",
  "Montanha",
  "Gelo",
];
const fmt = (n: number) =>
  new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 2 }).format(n);
function App() {
  const [world, setWorld] = useState(empty),
    [user, setUser] = useState<User | null>(null),
    [details, setDetails] = useState<Territory[]>([]),
    [selected, setSelected] = useState<Territory | null>(null),
    [bounds, setBounds] = useState<ViewBounds>(WORLD_BOUNDS);
  const [drawing, setDrawing] = useState(false),
    [draft, setDraft] = useState<Polygon | MultiPolygon | null>(null),
    [quote, setQuote] = useState<Quote | null>(null),
    [area, setArea] = useState(0),
    [placing, setPlacing] = useState<BuildingKind | null>(null);
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [panel, setPanel] = useState<"auth" | "build" | "explore" | "stock" | null>(
      null,
    ),
    [login, setLogin] = useState(false),
    [name, setName] = useState("Meu refúgio");
  const [inspectedObject, setInspectedObject] = useState<
      { id: string; asset: string } | undefined
    >(),
    [inspectedLand, setInspectedLand] = useState(true);
  const [inspection, setInspection] = useState<[number, number] | null>(null),
    [nodeId, setNodeId] = useState<string | null>(null),
    [destination, setDestination] = useState<{
      center: [number, number];
      zoom: number;
      nonce: number;
    } | null>(null);
  const current = useRef({ bounds, selected, user });
  current.current = { bounds, selected, user };
  const serial = useRef(0),
    syncing = useRef(false);
  async function refresh() {
    if (syncing.current) return;
    syncing.current = true;
    const version = ++serial.current;
    try {
      const state = current.current,
        w = await visibleWorld(state.bounds);
      const m = activeMap;
      const ids = w.territories
        .filter((t) => {
          if (!m) return false;
          const a = m.project([t.minLon, t.maxLat]),
            b = m.project([t.maxLon, t.minLat]);
          return b.x - a.x > 130;
        })
        .slice(0, 24)
        .map((t) => t.id);
      const local = ids.length ? await localRegions(ids) : [];
      if (version !== serial.current) return;
      setWorld(w);
      setDetails(local);
      if (state.selected) {
        const t = await api<Territory>("/territories/" + state.selected.id);
        if (current.current.selected?.id === t.id) setSelected(t);
      }
      if (state.user) setUser(await api<User>("/me"));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      syncing.current = false;
    }
  }
  useEffect(() => {
    void api<User>("/me")
      .then(setUser)
      .catch(() => {});
    void refresh();
    const timer = setInterval(() => {
      if (!document.hidden) void refresh();
    }, 3000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    const timer = setTimeout(() => void refresh(), 150);
    return () => clearTimeout(timer);
  }, [bounds]);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setDrawing(false);
        setDraft(null);
        setQuote(null);
        setPlacing(null);
        setPanel(null);
        setInspection(null);
        setNodeId(null);
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, []);
  async function action(work: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await work();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function select(id: string) {
    await action(async () => {
      const t = await api<Territory>("/territories/" + id);
      setSelected(t);
      setInspection(null);
      setNodeId(null);
      setPanel(null);
    });
  }
  function acquire() {
    if (!user) {
      setPanel("auth");
      return;
    }
    setDrawing(true);
    setDraft(null);
    setQuote(null);
    setSelected(null);
    setNodeId(null);
    setInspection(null);
    setPanel(null);
    setError("");
    setArea(0);
  }
  async function drawn(geometry: Polygon) {
    setDrawing(false);
    setDraft(geometry);
    await action(async () => {
      const q = await api<Quote>("/territories/quote", { geometry });
      setQuote(q);
      setDraft(q.geometry);
    });
  }
  async function purchase() {
    if (!quote) return;
    await action(async () => {
      const t = await api<Territory>("/territories/claim", {
        quoteId: quote.id,
        name,
      });
      setSelected(t);
      setQuote(null);
      setDraft(null);
      setDetails((d) => [...d.filter((d) => d.id !== t.id), t]);
      setWorld((w) => ({
        ...w,
        territories: [...w.territories.filter((d) => d.id !== t.id), t],
      }));
      setUser(await api<User>("/me"));
    });
  }
  async function place(x: number, y: number) {
    if (!selected || !placing) return;
    await action(async () => {
      await api("/territories/" + selected.id + "/build", {
        requestId: crypto.randomUUID(),
        type: placing,
        position: { x, y },
      });
      setPlacing(null);
      await refresh();
    });
  }
  const node = selected?.nature?.nodes.find((n) => n.id === nodeId),
    owned = !!user && selected?.ownerId === user.id;
  const climate = inspection ? climateAt(...inspection) : null;
  function onNode(t: Territory, n: NatureNode) {
    setSelected(t);
    setNodeId(n.id);
    setInspection(null);
    setPanel(null);
  }
  return (
    <div className="app panel-collapsed sandbox">
      <WorldMap
        territories={world.territories}
        details={details}
        resources={false}
        blocked={panel === "auth"}
        onView={setBounds}
        selected={selected}
        drawing={drawing}
        draft={draft}
        ownerId={user?.id}
        destination={destination}
        political
        terrain
        population={false}
        placing={placing}
        gameTime={world.state.gameTime ?? 0}
        onSelect={(id) => void select(id)}
        onDraw={(g) => void drawn(g)}
        onArea={setArea}
        onPlace={(x, y) => void place(x, y)}
        onPerson={(p) =>
          setError(
            `${p.name} · ${p.profession} · ${p.task} · energia ${Math.round(p.energy)}%`,
          )
        }
        onInspect={(p, object, land) => {
          setInspectedObject(object);
          setInspectedLand(!!land);
          setInspection(p);
          setNodeId(null);
          setSelected(null);
          setPanel(null);
        }}
        onNode={onNode}
        onDiscoverTree={(t, hit) =>
          void action(async () => {
            const n = await api<NatureNode>("/territories/" + t.id + "/tree", {
              sourceId: hit.id,
              lon: hit.lon,
              lat: hit.lat,
              level: hit.level,
              requestId: crypto.randomUUID(),
            });
            const next = await api<Territory>("/territories/" + t.id);
            setDetails((list) => [...list.filter((d) => d.id !== t.id), next]);
            onNode(next, n);
          })
        }
        onReady={() => {}}
        onError={setError}
      />
      <header className="world-hud">
        <strong>
          ◈ GLOBALBOX <small>um mundo em movimento</small>
        </strong>
        <span>
          Dia {Math.floor((world.state.gameTime ?? 0) / GAME_TIME.day) + 1}
        </span>
        <button
          onClick={() =>
            user
              ? setPanel(panel === "stock" ? null : "stock")
              : setPanel("auth")
          }
        >
          {user ? `◉ ${fmt(user.money)} moedas` : "Entrar no mundo"}
        </button>
      </header>
      <nav className="world-tools" aria-label="Ferramentas do mundo">
        <button
          title="Explorar destinos"
          onClick={() => setPanel(panel === "explore" ? null : "explore")}
        >
          ◎ <span>Explorar</span>
        </button>
        <button
          className={drawing ? "active" : ""}
          onClick={acquire}
          title="Desenhar uma área livre"
        >
          ⌁ <span>Adquirir território</span>
        </button>
        <button
          disabled={!owned}
          onClick={() => setPanel(panel === "build" ? null : "build")}
          title="Construir no território selecionado"
        >
          ⌂ <span>Construir</span>
        </button>
        <button
          disabled={!selected}
          onClick={() => setPanel(panel === "stock" ? null : "stock")}
          title="Estoques e história"
        >
          ▣ <span>Comunidade</span>
        </button>
      </nav>
      {busy && (
        <div className="world-message" role="status">
          Preparando seu mundo…
        </div>
      )}
      {error && (
        <div className="world-message" role="status">
          {error}
          <button aria-label="Fechar mensagem" onClick={() => setError("")}>
            ×
          </button>
        </div>
      )}
      {(drawing || placing) && (
        <aside className="world-hint">
          {drawing
            ? `Desenhe sua fronteira · ${fmt(area)} km²`
            : `Escolha o terreno para ${BUILDINGS[placing!].label}`}
          <button
            onClick={() => {
              setDrawing(false);
              setPlacing(null);
            }}
          >
            Cancelar
          </button>
        </aside>
      )}
      {panel === "explore" && (
        <aside className="world-card">
          <h2>Escolha um lugar</h2>
          <p>Explore, aproxime e toque no terreno.</p>
          {(
            [
              ["Amazônia", -62, -5, 11],
              ["Europa", 2, 48, 13],
              ["Andes", -72, -15, 11],
              ["Saara", 15, 25, 9],
              ["Sibéria", 100, 60, 10],
              ["Austrália", 133, -25, 9],
              ["Groenlândia", -41, 75, 8],
              ["Antártida", 0, -75, 6],
            ] as [string, number, number, number][]
          ).map(([label, lon, lat, zoom]) => (
            <button
              key={label}
              onClick={() => {
                setDestination({ center: [lon, lat], zoom, nonce: Date.now() });
                setPanel(null);
              }}
            >
              {label} ↗
            </button>
          ))}
        </aside>
      )}
      {panel === "auth" && (
        <aside className="world-card">
          <h2>{login ? "Voltar ao mundo" : "Comece sua comunidade"}</h2>
          <p>Uma carteira de moedas virtuais e um mundo para explorar.</p>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const data = new FormData(e.currentTarget);
              void action(async () => {
                const u = await api<User>(
                  "/auth/" + (login ? "login" : "register"),
                  Object.fromEntries(data),
                );
                setUser(u);
                setPanel(null);
              });
            }}
          >
            <label>
              Nome
              <input
                name="username"
                required
                minLength={3}
                maxLength={24}
                autoComplete="username"
                pattern="[a-z0-9_]+"
              />
            </label>
            <label>
              Senha
              <input
                name="password"
                type="password"
                required
                minLength={8}
                autoComplete={login ? "current-password" : "new-password"}
              />
            </label>
            <button disabled={busy} className="primary">
              {login ? "Entrar" : "Criar jogador"}
            </button>
          </form>
          <button onClick={() => setLogin(!login)}>
            {login ? "Criar uma conta" : "Já tenho uma conta"}
          </button>
          <button onClick={() => setPanel(null)}>Continuar explorando</button>
        </aside>
      )}
      {quote && (
        <aside className="world-card">
          <h2>Um lugar para chamar de seu</h2>
          <dl>
            <dt>Área selecionada</dt>
            <dd>{fmt(quote.totalAreaKm2 ?? quote.areaKm2)} km²</dd>
            <dt>Ocupada</dt>
            <dd>{fmt(quote.occupiedAreaKm2 ?? 0)} km²</dd>
            <dt>Disponível para adquirir</dt>
            <dd>{fmt(quote.areaKm2)} km²</dd>
            <dt>Valor simulado</dt>
            <dd>{fmt(quote.priceCents)} moedas</dd>
          </dl>
          <label>
            Nome do território
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={48}
            />
          </label>
          <button
            className="primary"
            disabled={
              busy ||
              name.trim().length < 2 ||
              (user?.money ?? 0) < quote.priceCents
            }
            onClick={() => void purchase()}
          >
            Adquirir território
          </button>
          <button onClick={acquire}>Desenhar novamente</button>
          <button
            onClick={() => {
              setQuote(null);
              setDraft(null);
            }}
          >
            Cancelar
          </button>
        </aside>
      )}
      {!quote && !drawing && !panel && inspection && climate && (
        <aside className="world-card">
          <h2>
            {!inspectedLand
              ? "Água"
              : inspectedObject
                ? `Árvore · ${labelNature(inspectedObject.asset)}`
                : biomes[climate.biome]}
          </h2>
          <p>{inspection.map((v) => v.toFixed(3)).join(" · ")}</p>
          <dl>
            <dt>Relevo ilustrativo</dt>
            <dd>{fmt(climate.elevation * 4000)} m</dd>
            <dt>Umidade</dt>
            <dd>{Math.round(climate.moisture * 100)}%</dd>
            <dt>Vegetação</dt>
            <dd>
              {[0, 9, 7].includes(climate.biome)
                ? "Ausente"
                : climate.biome === 5
                  ? "Rara"
                  : climate.moisture > 0.6
                    ? "Densa"
                    : "Variável"}
            </dd>
          </dl>
          {inspectedLand && (
            <button onClick={acquire}>Desenhar território aqui</button>
          )}
          <button onClick={() => setInspection(null)}>Fechar</button>
        </aside>
      )}
      {!quote && !drawing && !panel && selected && (
        <aside className="world-card">
          <h2>
            {node
              ? node.kind === "Tree"
                ? "Árvore"
                : labelNature(node.resource)
              : selected.name}
          </h2>
          {node ? (
            <>
              <p>
                {labelNature(node.asset)} · {labelNature(node.state)}
                <br />
                {node.kind === "Tree"
                  ? `${Math.floor(node.age)} dias · saúde ${Math.round(node.health)}%`
                  : `${node.quantity} unidades`}
              </p>
              {owned &&
                node.harvestable &&
                ["MATURE", "OLD", "AVAILABLE"].includes(node.state) &&
                !selected.nature?.jobs.some((j) => j.nodeId === node.id) && (
                  <button
                    className="primary"
                    disabled={busy}
                    onClick={() =>
                      void action(async () => {
                        await api("/territories/" + selected.id + "/harvest", {
                          nodeId: node.id,
                          requestId: crypto.randomUUID(),
                        });
                        await refresh();
                      })
                    }
                  >
                    {node.kind === "Tree" ? "Cortar árvore" : "Extrair recurso"}
                  </button>
                )}
              <button onClick={() => setNodeId(null)}>Ver território</button>
            </>
          ) : (
            <>
              <p>
                @{selected.owner.username} · {fmt(selected.areaKm2)} km²
              </p>
              <p>
                {selected.characters?.length ?? 0} habitantes ·{" "}
                {selected.nature?.nodes.filter(
                  (n) => n.kind === "Tree" && n.harvestable,
                ).length ?? 0}{" "}
                árvores adultas
              </p>
              {owned && (
                <button onClick={() => setPanel("build")}>Construir</button>
              )}
              <button onClick={() => setPanel("stock")}>
                Estoques e acontecimentos
              </button>
            </>
          )}
          <button
            onClick={() => {
              setSelected(null);
              setNodeId(null);
            }}
          >
            Fechar
          </button>
        </aside>
      )}
      {panel === "build" && selected && owned && (
        <aside className="world-card">
          <h2>Construir em {selected.name}</h2>
          <p>Escolha uma clareira dentro da fronteira.</p>
          {(Object.keys(BUILDINGS) as BuildingKind[]).map((kind) => (
            <button
              key={kind}
              onClick={() => {
                setPlacing(kind);
                setPanel(null);
              }}
            >
              {BUILDINGS[kind].label}
              <small>
                {Object.entries(BUILDINGS[kind].cost)
                  .map(([k, v]) => `${v} ${k}`)
                  .join(" · ")}
              </small>
            </button>
          ))}
        </aside>
      )}
      {panel === "stock" && (
        <aside className="world-card">
          <h2>{selected?.name ?? "Sua comunidade"}</h2>
          {selected?.resources?.map((r) => (
            <p key={r.kind}>
              {r.kind}{" "}
              <b>
                {Math.floor(r.amount)} / {r.capacity}
              </b>
            </p>
          ))}
          {selected?.characters?.map((p) => (
            <small key={p.id}>
              {p.name} · {labelNature(p.task)}
            </small>
          ))}
          <h3>Acontecimentos</h3>
          {(selected?.history ?? world.events).slice(0, 5).map((e) => (
            <p className="history-entry" key={e.id}>
              {e.text}
            </p>
          ))}
          {import.meta.env.DEV && user && (
            <button
              disabled={busy}
              onClick={() =>
                void action(async () => {
                  await api("/dev/time", { days: 3 });
                  await refresh();
                })
              }
            >
              Inspeção: avançar 3 dias
            </button>
          )}
          <button onClick={() => setPanel(null)}>Fechar</button>
        </aside>
      )}
    </div>
  );
}
createRoot(document.getElementById("root")!).render(<App />);
