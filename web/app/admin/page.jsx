"use client";
import { useState, useEffect } from "react";

export default function Admin() {
  const [status, setStatus] = useState(null);
  useEffect(() => { fetch("/api/seed").then(r => r.json()).then(setStatus).catch(() => {}); }, []);

  const box = { maxWidth: 640, margin: "40px auto", padding: "0 18px", fontFamily: "-apple-system,Segoe UI,Roboto,sans-serif", color: "#e6edf3" };
  const card = { background: "#141922", border: "1px solid #252d3b", borderRadius: 14, padding: 18, marginBottom: 16 };

  return (
    <div style={box}>
      <h1 style={{ fontSize: 24 }}>🛠️ Admin — santé</h1>
      <div style={card}>
        {status ? (
          <ul style={{ fontSize: 14, lineHeight: 1.8 }}>
            <li>Base de données : {status.dbOk ? "✅ connectée" : "❌ erreur — " + (status.err || "")}</li>
            <li>Jeux en base : <b>{status.dbGames}</b></li>
            <li>Clés API : Twitch/IGDB {status.keysApi?.twitch ? "✅" : "❌"} · ITAD {status.keysApi?.itad ? "✅" : "❌"} · YouTube {status.keysApi?.youtube ? "✅" : "❌"}</li>
          </ul>
        ) : <p style={{ color: "#8b98a9" }}>Chargement…</p>}
      </div>
      <p style={{ color: "#8b98a9", fontSize: 13 }}><a href="/" style={{ color: "#7c5cff" }}>← Retour à la liste</a></p>
    </div>
  );
}
