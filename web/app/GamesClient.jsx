"use client";
import { useState, useMemo, useRef } from "react";

const noteColor = (n) => n >= 85 ? "#3fb950" : n >= 75 ? "#f5c518" : n >= 60 ? "#ff8c42" : "#f85149";
const prixVal = (g) => (g.prix && g.prix.meilleur != null) ? g.prix.meilleur : (g.prixSteam != null ? g.prixSteam : null);
const noteVal = (g) => g.note != null ? g.note : (g.metacritic != null ? g.metacritic : (g.steamPct != null ? g.steamPct : null));
const md = (g) => g.modes || {};

const MOIS = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];
function fmtDate(iso) {
  if (!iso) return { txt: "", released: false };
  const p = iso.split("-");
  let txt;
  if (p.length >= 3) txt = `${+p[2]} ${MOIS[+p[1] - 1]} ${p[0]}`;
  else if (p.length === 2) txt = `${MOIS[+p[1] - 1]} ${p[0]}`;
  else txt = p[0];
  const today = new Date().toISOString().slice(0, 10);
  const released = iso <= today.slice(0, iso.length);
  return { txt, released };
}
function modesDetailText(g) {
  const d = g.modesDetail || {}; const out = [];
  const c = []; if (d.coopOnline) c.push("en ligne"); if (d.coopCouch) c.push("écran partagé"); if (d.coopLan) c.push("LAN");
  if (c.length) out.push("Coop " + c.join("/"));
  const p = []; if (d.pvpOnline) p.push("en ligne"); if (d.pvpCouch) p.push("écran partagé"); if (d.pvpLan) p.push("LAN");
  if (p.length) out.push("PvP " + p.join("/"));
  if (d.remotePlay) out.push("Remote Play");
  if (d.crossPlatform) out.push("cross-play");
  return out.join(" · ");
}

// clé de tri → fonction de valeur + direction par défaut (1 asc, -1 desc)
const SORT_VAL = {
  titre: g => g.titre.toLowerCase(),
  prix: g => { const p = prixVal(g); return p == null ? Infinity : p; },
  note: g => { const n = noteVal(g); return n == null ? -1 : n; },
  joueurs: g => g.nbJoueursMax == null ? -1 : g.nbJoueursMax,
  sortie: g => g.sortieISO || "",
};
const SORT_DEFDIR = { titre: 1, prix: 1, note: -1, joueurs: -1, sortie: -1 };

export default function GamesClient({ initial, gen }) {
  const [games, setGames] = useState(initial || []);
  const [q, setQ] = useState("");
  const [sortKey, setSortKey] = useState("note");
  const [sortDir, setSortDir] = useState(-1);
  const [filters, setFilters] = useState(() => new Set());
  const [addOpen, setAddOpen] = useState(false);
  const [addInput, setAddInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const [newTitle, setNewTitle] = useState(null);
  const inputRef = useRef(null);

  function changeSort(key) {
    if (key === sortKey) setSortDir(d => -d);
    else { setSortKey(key); setSortDir(SORT_DEFDIR[key]); }
  }

  const stats = useMemo(() => ([
    ["Jeux", games.length],
    ["Dispo", games.filter(g => g.dispo).length],
    ["Gratuits", games.filter(g => g.gratuit).length],
    ["Bons plans", games.filter(g => g.bonPlan).length],
    ["Coop", games.filter(g => md(g).coop).length],
    ["PvP", games.filter(g => md(g).pvp).length],
  ]), [games]);

  const hero = useMemo(() =>
    games.filter(g => g.dispo && g.bienNote).sort((a, b) => noteVal(b) - noteVal(a)).slice(0, 10),
    [games]);

  const list = useMemo(() => {
    let l = games.slice();
    const s = q.toLowerCase().trim();
    if (s) l = l.filter(g => (g.titre + " " + (g.genre || "") + " " + (g.univers || "")).toLowerCase().includes(s));
    for (const f of filters) {
      if (f === "coop") l = l.filter(g => md(g).coop);
      else if (f === "pvp") l = l.filter(g => md(g).pvp);
      else if (f === "solo") l = l.filter(g => md(g).solo);
      else l = l.filter(g => g[f]);
    }
    const val = SORT_VAL[sortKey] || SORT_VAL.note;
    l.sort((a, b) => {
      const va = val(a), vb = val(b);
      const r = va < vb ? -1 : va > vb ? 1 : 0;
      return r * sortDir || a.titre.localeCompare(b.titre);
    });
    return l;
  }, [games, q, sortKey, sortDir, filters]);

  function toggleFilter(f) {
    setFilters(prev => { const n = new Set(prev); n.has(f) ? n.delete(f) : n.add(f); return n; });
  }

  async function submitAdd() {
    const input = addInput.trim();
    if (!input || busy) return;
    setBusy(true);
    setMsg({ type: "info", node: <><span className="spin" />Détection &amp; enrichissement…</> });
    try {
      const r = await fetch("/api/add", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ input }) });
      const j = await r.json();
      if (!r.ok && !j.game) { setMsg({ type: "err", node: j.error || "Échec" }); setBusy(false); return; }
      const g = j.game;
      if (j.duplicate) setMsg({ type: "info", node: <>« {g.titre} » est déjà dans ta liste.</> });
      else setMsg({ type: "ok", node: <>✅ Ajouté : <b>{g.titre}</b> (source : {j.source})</> });
      if (j.games) setGames(j.games);
      setNewTitle(g.titre);
      setAddInput("");
      setTimeout(() => setNewTitle(null), 2100);
    } catch (e) {
      setMsg({ type: "err", node: "Erreur réseau : " + e.message });
    }
    setBusy(false);
  }

  const Arrow = ({ k }) => sortKey === k ? <span className="arrow">{sortDir === 1 ? "▲" : "▼"}</span> : null;

  return (
    <div className="wrap">
      <header>
        <div>
          <h1>🎮 Mes jeux à jouer</h1>
          <div className="sub">Collectés depuis Instagram, enrichis via Steam / IGDB / ITAD · màj {gen}</div>
        </div>
        <button className="btn" onClick={() => { setAddOpen(true); setTimeout(() => inputRef.current?.focus(), 50); }}>+ Ajouter un jeu</button>
      </header>

      <div className="stats">
        {stats.map(([l, v]) => <div className="stat" key={l}><b>{v}</b><span>{l}</span></div>)}
      </div>

      <div className={"add" + (addOpen ? " open" : "")}>
        <div className="head" onClick={() => setAddOpen(o => !o)}>
          <h2>➕ Ajouter un jeu</h2><span className="chev">▾</span>
        </div>
        <div className="body">
          <div className="field">
            <input ref={inputRef} type="text" value={addInput}
              onChange={e => setAddInput(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter") submitAdd(); }}
              placeholder="Colle un lien Steam / YouTube / Instagram, ou tape un titre…" />
            <button className="btn" onClick={submitAdd} disabled={busy}>Rechercher &amp; ajouter</button>
          </div>
          <div className="hint">
            Détecte le jeu depuis : lien <b>Steam</b> (exact), vidéo <b>YouTube</b> (titre nettoyé),
            <b> reel Instagram</b> (best-effort), ou <b>titre libre</b>. Puis enrichit via Steam/IGDB/ITAD.
          </div>
          {msg && <div className={"msg " + msg.type}>{msg.node}</div>}
        </div>
      </div>

      {hero.length > 0 && (
        <div className="hero">
          <h2>🔥 À jouer maintenant — dispo &amp; bien noté</h2>
          <div className="row">
            {hero.map(g => {
              const p = prixVal(g); const dev = g.prix?.devise || "CHF"; const pt = g.gratuit ? "Gratuit" : (p != null ? p + " " + dev : "—");
              return <a className="mini" key={g.titre} href={g.urlStore || g.urlSteam || "#"} target="_blank" rel="noopener noreferrer">
                <div className="t">{g.titre}</div><div className="m">⭐ {noteVal(g)} · {pt}</div></a>;
            })}
          </div>
        </div>
      )}

      <div className="controls">
        <input type="search" value={q} onChange={e => setQ(e.target.value)} placeholder="Rechercher un titre, un genre, un univers…" />
        <select value={sortKey} onChange={e => { setSortKey(e.target.value); setSortDir(SORT_DEFDIR[e.target.value]); }}>
          <option value="note">Trier : Note</option>
          <option value="prix">Prix</option>
          <option value="joueurs">Joueurs</option>
          <option value="sortie">Sortie</option>
          <option value="titre">Titre</option>
        </select>
        <button className="btn ghost dirbtn" onClick={() => setSortDir(d => -d)} title="Inverser le sens du tri">
          {sortDir === 1 ? "▲ croissant" : "▼ décroissant"}
        </button>
      </div>
      <div className="chips">
        {[["dispo", "✅ Dispo", "ok"], ["gratuit", "🆓 Gratuit", "gratuit"], ["bonPlan", "💸 Bon plan", "deal"],
          ["bienNote", "⭐ Bien noté", "note"], ["coop", "👥 Coop", "coop"], ["pvp", "⚔️ PvP", "pvp"], ["solo", "🎯 Solo", "solo"]]
          .map(([f, label, cls]) =>
            <span key={f} className={"chip " + cls + (filters.has(f) ? " on" : "")} onClick={() => toggleFilter(f)}>{label}</span>)}
      </div>

      <div className="count">{list.length} jeu{list.length > 1 ? "x" : ""} affiché{list.length > 1 ? "s" : ""}</div>
      <div className="tablewrap">
        <table>
          <thead><tr>
            <th className="sortable" onClick={() => changeSort("titre")}>Jeu<Arrow k="titre" /></th>
            <th>Statut</th>
            <th>Modes</th>
            <th className="sortable" onClick={() => changeSort("prix")}>Prix<Arrow k="prix" /></th>
            <th className="sortable" onClick={() => changeSort("note")}>Note<Arrow k="note" /></th>
            <th className="sortable hide-m" onClick={() => changeSort("joueurs")}>Joueurs<Arrow k="joueurs" /></th>
            <th className="sortable hide-m" onClick={() => changeSort("sortie")}>Sortie<Arrow k="sortie" /></th>
            <th className="hide-m">Liens</th>
          </tr></thead>
          <tbody>
            {list.map(g => <Row key={g.titre} g={g} isNew={newTitle === g.titre} />)}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Badges({ g }) {
  const b = [];
  if (g.dispo) b.push(<span className="b ok" key="d">✅ Dispo</span>);
  if (g.gratuit) b.push(<span className="b gratuit" key="g">🆓 Gratuit</span>);
  else if (g.gratuitMention) b.push(<span className="b gratuit" key="gm">🆓 {g.gratuitMention}</span>);
  if (g.bonPlan) b.push(<span className="b deal" key="bp">💸 Bon plan</span>);
  if (g.bienNote) b.push(<span className="b note" key="bn">⭐ Top</span>);
  if (g.comingSoon) b.push(<span className="b dim" key="cs">🔜 Bientôt</span>);
  return <div className="badges">{b.length ? b : <span className="dim">—</span>}</div>;
}
function Modes({ g }) {
  const m = md(g); const b = [];
  if (m.solo) b.push(<span className="b solo" key="s">🎯 Solo</span>);
  if (m.coop) b.push(<span className="b coop" key="c">👥 Coop</span>);
  if (m.pvp) b.push(<span className="b pvp" key="p">⚔️ PvP</span>);
  if (!m.solo && !m.coop && !m.pvp && m.multi) b.push(<span className="b dim" key="mu">🌐 Multi</span>);
  const detail = modesDetailText(g);
  return <>
    <div className="badges">{b.length ? b : <span className="dim">—</span>}</div>
    {detail && <div className="dim" style={{ fontSize: 11, marginTop: 3 }}>{detail}</div>}
  </>;
}
function Price({ g }) {
  if (g.gratuit) return <span className="price"><span className="free">Gratuit</span></span>;
  const p = prixVal(g);
  if (p == null) return <span className="dim">—</span>;
  const store = g.prix && g.prix.store ? g.prix.store : "Steam";
  const dev = g.prix && g.prix.devise ? g.prix.devise : "CHF";
  return <>
    <span className="price">{p} {dev}{(g.reducPct || 0) > 0 && <span className="b deal"> -{g.reducPct}%</span>}</span>
    <div className="dim" style={{ fontSize: 11 }}>{store}</div>
    {g.prix && g.prix.plusBasHisto != null && <div className="dim" style={{ fontSize: 11 }}>bas {g.prix.plusBasHisto} {dev}</div>}
  </>;
}
function Note({ g }) {
  const n = noteVal(g);
  if (n == null) return <span className="dim">—</span>;
  const src = g.noteSource || "";
  const steamExtra = (g.steamPct != null && !/Steam/.test(src)) ? ` · 👍 ${g.steamPct}%` : "";
  return <>
    <span className="note-badge" style={{ background: noteColor(n) + "22", color: noteColor(n) }}>{n}</span>
    {(src || steamExtra) && <div className="dim" style={{ fontSize: 10, marginTop: 3 }}>{src}{steamExtra}</div>}
  </>;
}
function Sortie({ g }) {
  const { txt, released } = fmtDate(g.sortieISO);
  if (!txt) return <span className="dim">{g.sortiePrec || "—"}</span>;
  if (released) return <span style={{ color: "#3fb950", fontWeight: 700 }}>{txt}</span>;
  return <span className="dim">{txt}</span>;
}
function Row({ g, isNew }) {
  return (
    <tr className={isNew ? "new" : ""}>
      <td>
        <div className="game">
          {g.image ? <img src={g.image} loading="lazy" alt="" /> : <div className="noimg">🎮</div>}
          <div className="info">
            <div className="name">{g.titre}</div>
            <div className="genre">{[g.genre, g.univers].filter(Boolean).join(" · ")}</div>
          </div>
        </div>
      </td>
      <td><Badges g={g} /></td>
      <td><Modes g={g} /></td>
      <td><Price g={g} /></td>
      <td><Note g={g} /></td>
      <td className="hide-m">{g.nbJoueurs ? g.nbJoueurs : <span className="dim">—</span>}</td>
      <td className="hide-m"><Sortie g={g} /></td>
      <td className="hide-m">
        <div className="links">
          {g.urlSteam && <a href={g.urlSteam} target="_blank" rel="noopener noreferrer">Steam</a>}
          {g.urlStore && g.urlStore !== g.urlSteam && <a href={g.urlStore} target="_blank" rel="noopener noreferrer">Deal</a>}
          {g.reel && <a href={g.reel} target="_blank" rel="noopener noreferrer">Reel</a>}
          {!g.urlSteam && !g.urlStore && !g.reel && <span className="dim">—</span>}
        </div>
      </td>
    </tr>
  );
}
