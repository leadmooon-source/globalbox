import { createRoot } from "react-dom/client";
import { useEffect, useRef, useState, type FormEvent } from "react";
import type { Polygon } from "geojson";
import { area, polygon } from "@turf/turf";
import { WorldMap, activeMap } from "./Map.tsx";
import { Icon } from "./icons.tsx";
import {
  api,
  type User,
  type Territory,
  type World,
  type Listing,
  type Offer,
  type Quote,
  type Place,
} from "./types.ts";
import {
  BUILDINGS,
  RESOURCE_KINDS,
  CROPS,
  DEFAULT_PRICING,
  estimatePrice,
  money,
  number,
  type PricingConfig,
  type BuildingKind,
  type CropKind,
  type ResourceKind,
} from "../../shared/game.ts";
import { useScreens } from "./screens.ts";
import { visibleWorld, localRegions } from "./remote.ts";
import { WORLD_BOUNDS, type ViewBounds } from "../../shared/contracts.ts";
import type { Panel } from "./screens.ts";
import { CHARACTER_ART, characterArt } from "./characters.ts";
import "./ui.css";

const empty: World = {
  territories: [],
  events: [],
  total: 0,
  players: 0,
  state: { tick: 0, revision: 0 },
};
function App() {
  const {
    top,
    panel,
    setPanel,
    auth,
    setAuth,
    layers,
    setLayers,
    person: personSnapshot,
    setPerson,
    confirmation,
    setConfirmation,
  } = useScreens();
  const [bounds, setBounds] = useState<ViewBounds>(WORLD_BOUNDS),
    [details, setDetails] = useState<Territory[]>([]),
    [resourceLayer, setResourceLayer] = useState(false),
    [collapsed, setCollapsed] = useState(false),
    [textScale, setTextScale] = useState(
      () => Number(localStorage.getItem("gt-text-scale")) || 1,
    );
  const view = useRef(bounds);
  view.current = bounds;
  const socketRef = useRef<WebSocket | null>(null);
  const refreshSerial = useRef(0);
  useEffect(() => {
    document.documentElement.style.setProperty(
      "--text-scale",
      String(textScale),
    );
    localStorage.setItem("gt-text-scale", String(textScale));
  }, [textScale]);

  const [world, setWorld] = useState<World>(empty),
    [user, setUser] = useState<User | null>(null),
    [selected, setSelected] = useState<Territory | null>(null),
    [tab, setTab] = useState("overview"),
    [drawing, setDrawing] = useState(false),
    [draft, setDraft] = useState<Polygon | null>(null),
    [liveArea, setLiveArea] = useState(0),
    [quote, setQuote] = useState<Quote | null>(null),
    [pricing, setPricing] = useState<PricingConfig>(DEFAULT_PRICING),
    [name, setName] = useState("Minha nova terra"),
    [register, setRegister] = useState(true),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [connected, setConnected] = useState(false),
    [ready, setReady] = useState(false),
    [market, setMarket] = useState<Listing[]>([]),
    [offers, setOffers] = useState<Offer[]>([]),
    [owned, setOwned] = useState<Territory[]>([]),
    [political, setPolitical] = useState(true),
    [terrain, setTerrain] = useState(true),
    [population, setPopulation] = useState(false),
    [destination, setDestination] = useState<{
      center: [number, number];
      zoom: number;
      nonce: number;
    } | null>(null),
    [search, setSearch] = useState(""),
    [places, setPlaces] = useState<Place[]>([]),
    [placing, setPlacing] = useState<BuildingKind | null>(null),
    [crop, setCrop] = useState<CropKind>("Wheat"),
    [price, setPrice] = useState("12"),
    [counter, setCounter] = useState<Record<string, string>>({}),
    [profile, setProfile] = useState<{
      username: string;
      createdAt: string;
      territories: Territory[];
      tradingVolume: number;
      trades: number;
    } | null>(null);
  const person =
    selected?.characters?.find((p) => p.id === personSnapshot?.id) ??
    personSnapshot;
  const latest = useRef({
    selected,
    user,
    panel,
    profileName: profile?.username,
  });
  latest.current = { selected, user, panel, profileName: profile?.username };
  const requestSerial = useRef(0);
  const mutation = useRef(false);
  async function refresh() {
    const serial = ++refreshSerial.current,
      current = latest.current;
    const w = await visibleWorld(view.current);
    if (serial !== refreshSerial.current) return;
    setWorld(w);
    const m = activeMap;
    const detailIds = m
      ? w.territories
          .filter((t) => {
            const a = m.project([t.minLon, t.maxLat]),
              b = m.project([t.maxLon, t.minLat]);
            return (
              b.x - a.x > 130 &&
              b.x >= 0 &&
              a.x <= m.getCanvas().clientWidth &&
              b.y >= 0 &&
              a.y <= m.getCanvas().clientHeight
            );
          })
          .map((t) => t.id)
          .slice(0, 24)
      : [];
    const local = await localRegions(detailIds);
    if (serial !== refreshSerial.current) return;
    setDetails(local);

    if (current.selected) {
      const t = await api<Territory>("/territories/" + current.selected.id);
      if (
        serial === refreshSerial.current &&
        latest.current.selected?.id === t.id
      )
        setSelected(t);
    }
    if (current.user) {
      const [me, lands, offers] = await Promise.all([
        api<User>("/me"),
        api<Territory[]>("/me/territories"),
        api<Offer[]>("/me/offers"),
      ]);
      if (
        serial === refreshSerial.current &&
        latest.current.user?.id === current.user.id
      ) {
        setUser(me);
        setOwned(lands);
        setOffers(offers);
      }
    }
    if (current.panel === "market") {
      const listings = await api<Listing[]>("/market");
      if (latest.current.panel === "market" && serial === refreshSerial.current)
        setMarket(listings);
    }
    if (current.panel === "profile" && current.profileName) {
      const next = await api<NonNullable<typeof profile>>(
        "/profiles/" + current.profileName,
      );
      if (
        serial === refreshSerial.current &&
        latest.current.profileName === current.profileName
      )
        setProfile(next);
    }
  }
  async function run(action: () => Promise<void>) {
    if (mutation.current) return;
    mutation.current = true;
    setBusy(true);
    setError("");
    try {
      await action();
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Não foi possível concluir.");
    } finally {
      mutation.current = false;
      setBusy(false);
    }
  }
  useEffect(() => {
    void refresh().catch((e) => setError(e.message));
    void api<User>("/me")
      .then((u) => {
        setUser(u);
        return Promise.all([
          api<Territory[]>("/me/territories").then(setOwned),
          api<Offer[]>("/me/offers").then(setOffers),
        ]);
      })
      .catch(() => {});
    void api<{ pricing: PricingConfig }>("/config")
      .then((c) => setPricing(c.pricing))
      .catch((e) => setError(e.message));
    let ws: WebSocket,
      retry: ReturnType<typeof setTimeout>,
      update: ReturnType<typeof setTimeout>,
      stopped = false,
      inFlight = false;
    const sync = async () => {
      if (inFlight || stopped) return;
      inFlight = true;
      try {
        await refresh();
      } catch {
        setConnected(false);
      } finally {
        inFlight = false;
      }
    };
    function connect() {
      ws = new WebSocket(
        `${location.protocol === "https:" ? "wss:" : "ws:"}//${location.host}/ws`,
      );
      socketRef.current = ws;
      ws.onopen = () => {
        ws.send(JSON.stringify({ type: "subscribe", bounds: view.current }));
        setConnected(true);
        void sync();
      };
      ws.onmessage = () => {
        clearTimeout(update);
        update = setTimeout(() => void sync(), 150);
      };
      ws.onerror = () => ws.close();
      ws.onclose = () => {
        setConnected(false);
        if (!stopped) retry = setTimeout(connect, 2000);
      };
    }
    connect();
    const route = () => {
      const match = location.pathname.match(/^\/@([a-z0-9_]+)$/);
      if (match) void showProfile(match[1], false);
    };
    route();
    window.addEventListener("popstate", route);
    return () => {
      stopped = true;
      clearTimeout(retry);
      clearTimeout(update);
      ws.close();
      window.removeEventListener("popstate", route);
    };
  }, []);
  useEffect(() => {
    if (socketRef.current?.readyState === WebSocket.OPEN)
      socketRef.current.send(JSON.stringify({ type: "subscribe", bounds }));
    const timeout = setTimeout(
      () => void refresh().catch((e) => setError(e.message)),
      120,
    );
    return () => clearTimeout(timeout);
  }, [bounds]);
  useEffect(() => {
    if (search.length < 2) {
      setPlaces([]);
      return;
    }
    const timeout = setTimeout(
      () =>
        void api<Place[]>("/search?q=" + encodeURIComponent(search))
          .then(setPlaces)
          .catch(() => {}),
      250,
    );
    return () => clearTimeout(timeout);
  }, [search]);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(""), 6000);
    return () => clearTimeout(timer);
  }, [notice]);
  useEffect(() => {
    if (panel === "market")
      void api<Listing[]>("/market")
        .then(setMarket)
        .catch((e) => setError(e.message));
  }, [panel]);
  const my = !!selected && selected.ownerId === user?.id;
  function fly(t: Territory, zoom?: number) {
    const lon = (t.minLon + t.maxLon) / 2,
      lat = (t.minLat + t.maxLat) / 2,
      span = Math.max(
        t.maxLon - t.minLon,
        (t.maxLat - t.minLat) / Math.cos((lat * Math.PI) / 180),
      );
    const target = Math.max(
      200,
      Math.min(
        innerWidth > 760 ? innerWidth - 600 : innerWidth - 40,
        innerHeight - 220,
      ) * 0.85,
    );
    setDestination({
      center: [
        lon + (innerWidth > 760 ? (t.maxLon - t.minLon) * 0.25 : 0),
        lat - (innerWidth <= 760 ? (t.maxLat - t.minLat) * 0.65 : 0),
      ],
      zoom:
        zoom ??
        Math.max(9, Math.min(17, Math.log2(((360 / span) * target) / 512))),
      nonce: Date.now(),
    });
  }
  async function select(id: string, move = false) {
    const serial = ++requestSerial.current;
    try {
      const t = await api<Territory>("/territories/" + id);
      if (serial !== requestSerial.current) return;
      setSelected(t);
      setPanel(null);
      setTab("overview");
      setPerson(null);
      setPlacing(null);
      setDrawing(false);
      if (move) fly(t);
    } catch (e) {
      setError((e as Error).message);
    }
  }
  async function showProfile(username: string, push = true) {
    try {
      const p = await api<NonNullable<typeof profile>>("/profiles/" + username);
      setProfile(p);
      setPanel("profile");
      if (push) history.pushState({}, "", `/@${username}`);
    } catch (e) {
      setError((e as Error).message);
    }
  }
  function togglePanel(value: Panel) {
    setPanel(panel === value ? null : value);
    setDrawing(false);
    setPlacing(null);
    if (location.pathname !== "/") history.pushState({}, "", "/");
  }
  function beginDraw() {
    if ((activeMap?.getZoom() ?? 0) < 8) {
      setNotice(
        "Aproxime uma região de terra firme para desenhar sua fronteira.",
      );
      setDestination({ center: [-47.65, -22.5], zoom: 12, nonce: Date.now() });
      return;
    }

    if (!user) {
      setAuth(true);
      return;
    }
    setDrawing(true);
    setDraft(null);
    setQuote(null);
    setSelected(null);
    setPanel(null);
    setLiveArea(0);
    setPlacing(null);
    setError("");
  }
  async function finishDraw(geometry: Polygon) {
    setDrawing(false);
    setDraft(geometry);
    setLiveArea(area(polygon(geometry.coordinates)) / 1e6);
    await run(async () => {
      const q = await api<Quote>("/territories/quote", { geometry });
      setQuote(q);
      setDraft(q.geometry);
    });
  }
  async function authenticate(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    await run(async () => {
      const u = await api<User>("/auth/" + (register ? "register" : "login"), {
        username: form.get("username"),
        password: form.get("password"),
      });
      setUser(u);
      latest.current.user = u;
      setAuth(false);
      setNotice(
        register
          ? "Seu mundo começa aqui. Você recebeu R$ 100 em saldo fictício."
          : "Bem-vindo de volta.",
      );
    });
  }
  function requireLogin() {
    if (!user) {
      setAuth(true);
      return false;
    }
    return true;
  }
  function buy(l: Listing) {
    if (!requireLogin()) return;
    const requestId = crypto.randomUUID();
    setConfirmation({
      title: "Comprar território",
      text: `Transferir ${l.territory?.name ?? selected?.name} por ${money(l.priceCents)} de saldo fictício?`,
      action: async () => {
        await api("/market/" + l.id + "/buy", { requestId });
        setConfirmation(null);
        setNotice("Compra simulada concluída. O território agora é seu.");
        await select(l.territoryId, true);
      },
    });
  }
  async function order(
    kind: BuildingKind,
    position?: { x: number; y: number },
  ) {
    if (!selected) return;
    await run(async () => {
      await api("/territories/" + selected.id + "/build", {
        type: kind,
        position,
        crop,
        requestId: crypto.randomUUID(),
      });
      setPlacing(null);
      setNotice("Ordem recebida. Os construtores estão a caminho.");
    });
  }
  function priceCents(value: string) {
    const n = Math.round(Number(value.replace(",", ".")) * 100);
    if (!Number.isSafeInteger(n) || n <= 0)
      throw Error("Informe um valor maior que zero.");
    return n;
  }
  const resources = owned.flatMap((t) => t.resources ?? []);
  const totalPeople = owned.reduce(
    (n, t) => n + (t.characters?.length ?? 0),
    0,
  );
  return (
    <div className="app panel-collapsed">
      <WorldMap
        territories={world.territories}
        details={details}
        resources={resourceLayer}
        blocked={false}
        onView={setBounds}
        selected={selected}
        drawing={false}
        draft={null}
        ownerId={undefined}
        destination={destination}
        political={political}
        terrain={terrain}
        population={population}
        placing={null}
        onSelect={(id) => void select(id, true)}
        onDraw={() => {}}
        onArea={() => {}}
        onPlace={() => {}}
        onPerson={() => {}}
        onReady={() => setReady(true)}
        onError={setError}
      />
    </div>
  );
}
function resourceLabel(k: string) {
  return (
    (
      {
        Food: "Alimento",
        Wood: "Madeira",
        Stone: "Pedra",
        Metal: "Metal",
        Energy: "Energia",
      } as Record<string, string>
    )[k] ?? k
  );
}
function professionLabel(k: string) {
  return (
    (
      {
        Builder: "Construtor",
        Farmer: "Agricultor",
        Woodcutter: "Lenhador",
        Miner: "Minerador",
      } as Record<string, string>
    )[k] ?? k
  );
}
function taskLabel(k: string) {
  return (
    (
      {
        Exploring: "Explorando",
        Walking: "A caminho",
        Building: "Construindo",
        Farming: "Cultivando",
        Gathering: "Coletando",
        Mining: "Minerando",
        Resting: "Descansando",
        Eating: "Comendo",
      } as Record<string, string>
    )[k] ?? k
  );
}
function statusLabel(k: string) {
  return (
    (
      {
        OPEN: "EM NEGOCIAÇÃO",
        ACCEPTED: "ACEITA",
        REJECTED: "RECUSADA",
        COUNTERED: "CONTRAPROPOSTA",
        INVALIDATED: "ENCERRADA",
      } as Record<string, string>
    )[k] ?? k
  );
}
function Empty({
  icon,
  title,
  text,
}: {
  icon: string;
  title: string;
  text: string;
}) {
  return (
    <div className="empty">
      <Icon name={icon} size={35} />
      <h3>{title}</h3>
      <p>{text}</p>
    </div>
  );
}
function TerritoryCard({ t, onClick }: { t: Territory; onClick: () => void }) {
  return (
    <button className="territory-card" onClick={onClick}>
      <span className="land-icon">
        <Icon name="tree" size={27} />
      </span>
      <span>
        <b>{t.name}</b>
        <small>
          {number(t.areaKm2)} km² · #{t.number}
        </small>
      </span>
      <Icon name="arrow" size={18} />
    </button>
  );
}
createRoot(document.getElementById("root")!).render(<App />);

function CharacterPortrait({ profession }: { profession: string }) {
  const role = characterArt(profession);
  return (
    <span
      className="character-portrait"
      aria-hidden="true"
      style={{
        backgroundImage: `url(/characters/${role}.png)`,
        backgroundPosition: `${-CHARACTER_ART[role].idle * 80}px 0`,
      }}
    />
  );
}
