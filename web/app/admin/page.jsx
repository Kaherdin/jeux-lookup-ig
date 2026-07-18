"use client";
import { useState, useEffect } from "react";

export default function Admin() {
  const [status, setStatus] = useState(null);
  const [secret, setSecret] = useState("");
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState(false);

  async function refresh() {
    try { setStatus(await (await fetch("/api/seed")).json()); } catch {}
  }
  useEffect(() => { refresh(); }, []);

  async function syncFromRepo() {
    if (!secret) { setMsg({ t: "err", m: "Entre le SEED_SECRET." }); return; }
    setBusy(true); setMsg({ t: "info", m: "Synchronisation…" });
    try {
      const r = await fetch(`/api/seed?secret=${encodeURIComponent(secret)}`);
      const j = await r.json();
      if (!r.ok || j.error) setMsg({ t: "err", m: j.error || "Échec" });
      else { setMsg({ t: "ok", m: `✅ ${j.seeded} jeux copiés du repo vers le Blob.` }); refresh(); }
    } catch (e) { setMsg({ t: "err", m: "Erreur : " + e.message }); }
    setBusy(false);
  }

  const box = { maxWidth: 640, margin: "40px auto", padding: "0 18px", fontFamily: "-apple-system,Segoe UI,Roboto,sans-serif", color: "#e6edf3" };
  const card = { background: "#141922", border: "1px solid #252d3b", borderRadius: 14, padding: 18, marginBottom: 16 };
  const inp = { width: "100%", padding: "11px 13px", borderRadius: 9, border: "1px solid #252d3b", background: "#0b0e14", color: "#e6edf3", marginTop: 8 };
  const btn = { padding: "11px 16px", borderRadius: 9, border: "none", background: "#7c5cff", color: "#fff", fontWeight: 700, cursor: "pointer", marginTop: 12 };

  return (
    <div style={box}>
      <h1 style={{ fontSize: 24 }}>🛠️ Admin</h1>
      <p style={{ color: "#8b98a9", fontSize: 14 }}>
        Les jeux sont <b>embarqués dans l'app</b> (data/games.json) : le site les affiche sans rien faire.
        Ce bouton force une <b>resynchronisation repo → Blob</b> (utile après un nouveau déploiement de données).
      </p>

      <div style={card}>
        <b>État</b>
        {status ? (
          <ul style={{ fontSize: 14, lineHeight: 1.7, marginTop: 8 }}>
            <li>Token Blob : {status.hasBlobToken ? `✅ ${status.tokenVar}` : "❌ absent"}</li>
            <li>Clés API : Twitch/IGDB {status.keysApi?.twitch ? "✅" : "❌"} · ITAD {status.keysApi?.itad ? "✅" : "❌"} · SEED_SECRET {status.keysApi?.seedSecret ? "✅" : "❌"}</li>
            <li>Jeux dans le repo (embarqués) : <b>{status.repoGames}</b></li>
            <li>Jeux servis actuellement : <b>{status.servedGames}</b></li>
          </ul>
        ) : <p style={{ color: "#8b98a9" }}>Chargement…</p>}
      </div>

      <div style={card}>
        <b>Resynchroniser repo → Blob</b>
        <input type="password" placeholder="SEED_SECRET" value={secret} onChange={e => setSecret(e.target.value)} style={inp} />
        <button style={btn} onClick={syncFromRepo} disabled={busy}>Synchroniser depuis le repo</button>
        {msg && <div style={{ marginTop: 12, fontSize: 14, color: msg.t === "err" ? "#f85149" : msg.t === "ok" ? "#3fb950" : "#58a6ff" }}>{msg.m}</div>}
      </div>

      <p style={{ color: "#8b98a9", fontSize: 13 }}><a href="/" style={{ color: "#7c5cff" }}>← Retour à la liste</a></p>
    </div>
  );
}
