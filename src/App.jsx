import { useState, useCallback, useRef } from "react";

const T = {
  bg: "#08090d", surface: "#0f1016", card: "#13141d", cardBorder: "#1c1d2b",
  accent: "#f0b90b", accentDim: "rgba(240,185,11,0.12)", accentGlow: "rgba(240,185,11,0.25)",
  green: "#00d395", greenDim: "rgba(0,211,149,0.10)",
  red: "#ff4d6a", redDim: "rgba(255,77,106,0.10)",
  blue: "#4da6ff", blueDim: "rgba(77,166,255,0.10)",
  text: "#e2e3ea", muted: "#5e6072", dim: "#333548", divider: "#1a1b28",
};

const fmt = (n, d = 2) => {
  if (n == null || isNaN(n)) return "$0.00";
  if (Math.abs(n) >= 1e9) return "$" + (n / 1e9).toFixed(2) + "B";
  if (Math.abs(n) >= 1e6) return "$" + (n / 1e6).toFixed(2) + "M";
  if (Math.abs(n) >= 1e3) return "$" + (n / 1e3).toFixed(2) + "K";
  return "$" + Number(n).toFixed(d);
};

const fmtAmt = (n) => {
  if (n == null || isNaN(n)) return "0";
  if (n >= 1e6) return (n / 1e6).toFixed(2) + "M";
  if (n >= 1e3) return (n / 1e3).toFixed(2) + "K";
  if (n >= 1) return Number(n).toFixed(4);
  if (n >= 0.0001) return Number(n).toFixed(6);
  return Number(n).toExponential(2);
};

const shortAddr = (a) => a ? a.slice(0, 6) + "···" + a.slice(-4) : "";
const copyAddr = (t) => navigator.clipboard.writeText(t).catch(() => {});

const apiCall = {
  async setKey(key) {
    const r = await fetch("/api/set-key", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ key }) });
    if (!r.ok) throw new Error("Failed to set key");
    return r.json();
  },
  async getPositions(wallet) {
    const r = await fetch("/api/positions/" + wallet);
    if (!r.ok) { const e = await r.json().catch(() => ({})); throw new Error(e.error || e.detail || "HTTP " + r.status); }
    return r.json();
  },
};

function parseLPPositions(data) {
  const out = [];
  if (!Array.isArray(data)) return out;
  for (const proto of data) {
    for (const item of (proto.portfolio_item_list || [])) {
      const nm = (item.name || "").toLowerCase();
      const types = (item.detail_types || []).map(d => d.toLowerCase());
      const isLP = nm.includes("liquidity") || nm.includes("farming") || nm.includes("lp") || types.some(d => d.includes("liquidity") || d.includes("lp"));
      if (!isLP && !types.includes("locked")) continue;
      const pn = (proto.name || "").toLowerCase();
      const iNm = nm;
      let ver = "";
      if (pn.includes("v4") || iNm.includes("v4")) ver = "v4";
      else if (pn.includes("v3") || iNm.includes("v3")) ver = "v3";
      else if (pn.includes("v2") || iNm.includes("v2")) ver = "v2";
      const det = item.detail || {};
      const supply = det.supply_token_list || [];
      const rewards = det.reward_token_list || [];
      out.push({
        protocolName: proto.name || "Unknown", protocolLogo: proto.logo_url, itemName: item.name, version: ver,
        pair: supply.map(t => t.symbol || t.optimized_symbol || "?").join(" / "),
        tokens: supply.map(t => ({ symbol: t.symbol || t.optimized_symbol || "?", amount: t.amount || 0, price: t.price || 0, logo: t.logo_url })),
        totalValue: item.stats?.net_usd_value ?? supply.reduce((s, t) => s + (t.amount || 0) * (t.price || 0), 0),
        fees: rewards.reduce((s, t) => s + (t.amount || 0) * (t.price || 0), 0),
        rewardTokens: rewards.map(t => ({ symbol: t.symbol || t.optimized_symbol || "?", amount: t.amount || 0, price: t.price || 0 })),
        lowerBound: det.lower_bound, upperBound: det.upper_bound, currentPrice: det.current_price,
        lowerTick: det.lower_tick, upperTick: det.upper_tick, currentTick: det.current_tick,
      });
    }
  }
  return out;
}

function RangeIndicator({ lower, upper, current }) {
  if (lower == null || upper == null) return null;
  const inRange = current != null && current >= lower && current <= upper;
  const range = upper - lower;
  let pct = 50;
  if (range > 0 && current != null) pct = Math.max(2, Math.min(98, ((current - lower) / range) * 100));
  return (
    <div style={{ marginTop: 10 }}>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: T.muted, marginBottom: 5 }}>
        <span>Min: <span style={{ color: T.text }}>{Number(lower).toPrecision(5)}</span></span>
        {current != null && (
          <span style={{ color: inRange ? T.green : T.red, fontWeight: 700, fontSize: 10, display: "flex", alignItems: "center", gap: 4 }}>
            <span style={{ width: 5, height: 5, borderRadius: "50%", background: inRange ? T.green : T.red, display: "inline-block", boxShadow: "0 0 6px " + (inRange ? T.green : T.red) }} />
            {inRange ? "IN RANGE" : "OUT OF RANGE"}
          </span>
        )}
        <span>Max: <span style={{ color: T.text }}>{Number(upper).toPrecision(5)}</span></span>
      </div>
      <div style={{ height: 7, borderRadius: 4, background: T.dim, position: "relative" }}>
        <div style={{ position: "absolute", left: 0, top: 0, height: "100%", width: "100%", borderRadius: 4, background: inRange ? "linear-gradient(90deg, transparent, " + T.green + "40, " + T.green + "60, " + T.green + "40, transparent)" : "linear-gradient(90deg, transparent, " + T.red + "25, " + T.red + "25, transparent)" }} />
        <div style={{ position: "absolute", top: "50%", left: pct + "%", transform: "translate(-50%, -50%)", width: 13, height: 13, borderRadius: "50%", background: inRange ? T.green : T.red, border: "2.5px solid " + T.card, boxShadow: "0 0 8px " + (inRange ? T.green : T.red), zIndex: 2 }} />
      </div>
      {current != null && <div style={{ textAlign: "center", fontSize: 10, marginTop: 5, color: T.accent }}>Current: {Number(current).toPrecision(5)}</div>}
    </div>
  );
}

function PositionCard({ pos }) {
  const lower = pos.lowerBound ?? pos.lowerTick;
  const upper = pos.upperBound ?? pos.upperTick;
  const current = pos.currentPrice ?? pos.currentTick;
  return (
    <div style={{ margin: "8px 12px", padding: "14px 16px", background: T.surface, borderRadius: 10, border: "1px solid " + T.dim }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <span style={{ fontSize: 13, fontWeight: 700 }}>{pos.pair || "LP"}</span>
          {pos.version && <span style={{ padding: "2px 7px", borderRadius: 4, fontSize: 9, fontWeight: 800, letterSpacing: "0.5px", textTransform: "uppercase", background: pos.version === "v4" ? T.blueDim : pos.version === "v3" ? T.accentDim : T.dim, color: pos.version === "v4" ? T.blue : pos.version === "v3" ? T.accent : T.muted }}>{pos.version}</span>}
          <span style={{ fontSize: 10, color: T.muted }}>{pos.protocolName}</span>
        </div>
        <span style={{ fontSize: 15, fontWeight: 800 }}>{fmt(pos.totalValue)}</span>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 3, marginBottom: 8 }}>
        {pos.tokens.map((tk, i) => (
          <div key={i} style={{ display: "flex", justifyContent: "space-between", fontSize: 11 }}>
            <span style={{ color: T.muted, display: "flex", alignItems: "center", gap: 5 }}>
              {tk.logo && <img src={tk.logo} alt="" style={{ width: 14, height: 14, borderRadius: "50%" }} onError={e => e.target.style.display = "none"} />}
              {tk.symbol}
            </span>
            <span>{fmtAmt(tk.amount)} <span style={{ color: T.muted }}>({fmt(tk.amount * tk.price)})</span></span>
          </div>
        ))}
      </div>
      {pos.fees > 0 && (
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "7px 10px", background: T.greenDim, borderRadius: 6, marginBottom: 8, border: "1px solid " + T.green + "15" }}>
          <span style={{ fontSize: 10, color: T.green, fontWeight: 700, letterSpacing: "0.5px", textTransform: "uppercase" }}>Uncollected Fees</span>
          <div style={{ textAlign: "right" }}>
            <span style={{ fontSize: 13, color: T.green, fontWeight: 800 }}>{fmt(pos.fees)}</span>
            {pos.rewardTokens.length > 0 && <div style={{ fontSize: 9, color: T.green, opacity: 0.7, marginTop: 1 }}>{pos.rewardTokens.map(r => fmtAmt(r.amount) + " " + r.symbol).join(" + ")}</div>}
          </div>
        </div>
      )}
      {lower != null && <RangeIndicator lower={lower} upper={upper} current={current} />}
    </div>
  );
}

function WalletCard({ wallet, positions, loading, error, onRemove, onRefresh }) {
  const [expanded, setExpanded] = useState(true);
  const tv = positions.reduce((s, p) => s + (p.totalValue || 0), 0);
  const tf = positions.reduce((s, p) => s + (p.fees || 0), 0);
  return (
    <div style={{ background: T.card, border: "1px solid " + (loading ? T.accent + "50" : T.cardBorder), borderRadius: 14, overflow: "hidden", transition: "border-color 0.3s, box-shadow 0.3s", boxShadow: loading ? "0 0 24px " + T.accentDim : "0 2px 12px rgba(0,0,0,0.2)" }}>
      <div style={{ padding: "16px 18px 12px", display: "flex", justifyContent: "space-between", alignItems: "flex-start", borderBottom: "1px solid " + T.divider }}>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
            <div style={{ width: 28, height: 28, borderRadius: 7, background: "linear-gradient(135deg, " + T.accent + "30, " + T.accent + "10)", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={T.accent} strokeWidth="2" strokeLinecap="round"><path d="M21 12V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2h14a2 2 0 002-2v-1"/><circle cx="17" cy="12" r="1" fill={T.accent}/></svg>
            </div>
            <span style={{ fontSize: 13, fontWeight: 700, cursor: "pointer", letterSpacing: "0.3px" }} onClick={() => copyAddr(wallet)} title="Copy">{shortAddr(wallet)}</span>
            <span style={{ opacity: 0.35, cursor: "pointer", display: "flex" }} onClick={() => copyAddr(wallet)}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>
            </span>
            <a href={"https://bscscan.com/address/" + wallet} target="_blank" rel="noopener noreferrer" style={{ color: T.muted, opacity: 0.4, display: "flex" }}>
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
            </a>
          </div>
          <div style={{ display: "flex", gap: 14, fontSize: 11 }}>
            <span style={{ color: T.muted }}>Positions: <span style={{ color: T.text, fontWeight: 700 }}>{positions.length}</span></span>
            <span style={{ color: T.muted }}>Value: <span style={{ color: T.accent, fontWeight: 800 }}>{fmt(tv)}</span></span>
            {tf > 0 && <span style={{ color: T.muted }}>Fees: <span style={{ color: T.green, fontWeight: 800 }}>{fmt(tf)}</span></span>}
          </div>
        </div>
        <div style={{ display: "flex", gap: 4, alignItems: "center", flexShrink: 0 }}>
          <button onClick={onRefresh} title="Refresh" style={{ background: "transparent", border: "1px solid " + T.cardBorder, borderRadius: 7, padding: "6px 8px", cursor: "pointer", color: T.muted, display: "flex" }}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 11-2.12-9.36L23 10"/></svg>
          </button>
          <button onClick={onRemove} title="Remove" style={{ background: "transparent", border: "none", borderRadius: 7, padding: "6px 8px", cursor: "pointer", color: T.red, opacity: 0.5, display: "flex", transition: "opacity 0.15s" }} onMouseEnter={e => e.currentTarget.style.opacity = 1} onMouseLeave={e => e.currentTarget.style.opacity = 0.5}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg>
          </button>
          <button onClick={() => setExpanded(!expanded)} style={{ background: "transparent", border: "1px solid " + T.cardBorder, borderRadius: 7, padding: "6px 8px", cursor: "pointer", color: T.muted, display: "flex", transform: expanded ? "rotate(180deg)" : "rotate(0)", transition: "transform 0.2s" }}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><polyline points="6 9 12 15 18 9"/></svg>
          </button>
        </div>
      </div>
      {expanded && (
        <div style={{ paddingBottom: 6 }}>
          {loading ? (
            <div style={{ padding: 32, textAlign: "center", color: T.muted }}>
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={T.accent} strokeWidth="2.5" strokeLinecap="round" style={{ animation: "spin 0.8s linear infinite" }}><path d="M21 12a9 9 0 11-6.219-8.56"/></svg>
              <div style={{ marginTop: 8, fontSize: 11 }}>Fetching from DeBank...</div>
            </div>
          ) : error ? (
            <div style={{ padding: "20px 18px", textAlign: "center" }}>
              <div style={{ fontSize: 12, color: T.red, marginBottom: 6 }}>{error}</div>
              <button onClick={onRefresh} style={{ background: T.redDim, border: "none", borderRadius: 6, padding: "6px 14px", color: T.red, fontSize: 11, fontWeight: 600, cursor: "pointer" }}>Retry</button>
            </div>
          ) : positions.length === 0 ? (
            <div style={{ padding: 24, textAlign: "center", fontSize: 11, color: T.muted }}>No V3/V4 LP positions found on BSC</div>
          ) : positions.map((p, i) => <PositionCard key={i} pos={p} />)}
        </div>
      )}
    </div>
  );
}

export default function App() {
  const [apiKey, setApiKey] = useState("");
  const [connected, setConnected] = useState(false);
  const [wallets, setWallets] = useState([]);
  const [newWallet, setNewWallet] = useState("");
  const [positions, setPositions] = useState({});
  const [loading, setLoading] = useState({});
  const [errors, setErrors] = useState({});
  const [toast, setToast] = useState(null);
  const tRef = useRef(null);

  const showToast = (msg, isErr = false) => { setToast({ msg, isErr }); clearTimeout(tRef.current); tRef.current = setTimeout(() => setToast(null), 3500); };

  const fetchPositions = useCallback(async (wallet) => {
    setLoading(p => ({ ...p, [wallet]: true }));
    setErrors(p => ({ ...p, [wallet]: null }));
    try {
      const data = await apiCall.getPositions(wallet);
      const parsed = parseLPPositions(data);
      setPositions(p => ({ ...p, [wallet]: parsed }));
      if (parsed.length > 0) showToast(parsed.length + " position" + (parsed.length > 1 ? "s" : "") + " for " + shortAddr(wallet));
    } catch (err) {
      setErrors(p => ({ ...p, [wallet]: err.message }));
      showToast(err.message, true);
    } finally {
      setLoading(p => ({ ...p, [wallet]: false }));
    }
  }, []);

  const connectKey = async () => {
    if (!apiKey.trim()) return;
    try { await apiCall.setKey(apiKey.trim()); setConnected(true); showToast("API key connected"); wallets.forEach(w => fetchPositions(w)); }
    catch (e) { showToast("Failed to set API key", true); }
  };

  const addWallet = () => {
    const a = newWallet.trim().toLowerCase();
    if (!a) return;
    if (!/^0x[a-f0-9]{40}$/i.test(a)) { showToast("Invalid address", true); return; }
    if (wallets.includes(a)) { showToast("Already tracked", true); return; }
    setWallets(p => [...p, a]);
    setNewWallet("");
    fetchPositions(a);
  };

  const removeWallet = (a) => {
    setWallets(p => p.filter(w => w !== a));
    setPositions(p => { const n = { ...p }; delete n[a]; return n; });
    setErrors(p => { const n = { ...p }; delete n[a]; return n; });
    showToast("Removed " + shortAddr(a));
  };

  const tv = Object.values(positions).flat().reduce((s, p) => s + (p.totalValue || 0), 0);
  const tf = Object.values(positions).flat().reduce((s, p) => s + (p.fees || 0), 0);

  return (
    <div style={{ minHeight: "100vh", background: T.bg, color: T.text, fontFamily: "'JetBrains Mono', 'SF Mono', monospace" }}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600;700;800&display=swap');*{box-sizing:border-box;margin:0;padding:0}::-webkit-scrollbar{width:5px}::-webkit-scrollbar-track{background:${T.bg}}::-webkit-scrollbar-thumb{background:${T.dim};border-radius:3px}@keyframes spin{to{transform:rotate(360deg)}}@keyframes fadeUp{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}input:focus{outline:none;border-color:${T.accent}!important;box-shadow:0 0 0 2px ${T.accentDim}}button{font-family:inherit}button:active{transform:scale(0.97)}`}</style>

      <header style={{ padding: "24px 28px 18px", display: "flex", justifyContent: "space-between", alignItems: "center", borderBottom: "1px solid " + T.divider, background: "linear-gradient(180deg, " + T.accent + "04, transparent 80%)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{ width: 38, height: 38, borderRadius: 9, background: "linear-gradient(135deg, " + T.accent + ", #c99a08)", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 900, fontSize: 15, color: "#000", boxShadow: "0 4px 16px " + T.accentGlow }}>LP</div>
          <div>
            <div style={{ fontSize: 16, fontWeight: 800, letterSpacing: "-0.3px" }}>BSC LP Tracker</div>
            <div style={{ fontSize: 10, color: T.muted, letterSpacing: "1.5px", textTransform: "uppercase" }}>V3 & V4 Positions · DeBank</div>
          </div>
        </div>
        {wallets.length > 0 && connected && (
          <div style={{ display: "flex", gap: 24 }}>
            <div style={{ textAlign: "right" }}>
              <div style={{ fontSize: 9, color: T.muted, letterSpacing: "1px", textTransform: "uppercase" }}>Total Value</div>
              <div style={{ fontSize: 22, fontWeight: 800, color: T.accent }}>{fmt(tv)}</div>
            </div>
            {tf > 0 && <div style={{ textAlign: "right" }}>
              <div style={{ fontSize: 9, color: T.muted, letterSpacing: "1px", textTransform: "uppercase" }}>Fees</div>
              <div style={{ fontSize: 22, fontWeight: 800, color: T.green }}>{fmt(tf)}</div>
            </div>}
          </div>
        )}
      </header>

      <div style={{ padding: "14px 28px", display: "flex", gap: 8, alignItems: "center", borderBottom: "1px solid " + T.divider, background: T.surface, flexWrap: "wrap" }}>
        {!connected ? (<>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={T.accent} strokeWidth="2" strokeLinecap="round"><path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 11-7.78 7.78 5.5 5.5 0 017.78-7.78zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4"/></svg>
          <input type="password" placeholder="Enter DeBank Pro API Key..." value={apiKey} onChange={e => setApiKey(e.target.value)} onKeyDown={e => e.key === "Enter" && connectKey()} style={{ flex: 1, minWidth: 200, background: T.bg, border: "1px solid " + T.cardBorder, borderRadius: 8, padding: "9px 14px", color: T.text, fontSize: 12, fontFamily: "inherit" }} />
          <button onClick={connectKey} style={{ background: T.accent, color: "#000", border: "none", borderRadius: 8, padding: "9px 22px", fontSize: 12, fontWeight: 800, cursor: "pointer" }}>Connect</button>
        </>) : (<>
          <input placeholder="Paste BSC wallet address (0x...)..." value={newWallet} onChange={e => setNewWallet(e.target.value)} onKeyDown={e => e.key === "Enter" && addWallet()} style={{ flex: 1, minWidth: 200, background: T.bg, border: "1px solid " + T.cardBorder, borderRadius: 8, padding: "9px 14px", color: T.text, fontSize: 12, fontFamily: "inherit" }} />
          <button onClick={addWallet} style={{ background: T.accent, color: "#000", border: "none", borderRadius: 8, padding: "9px 18px", fontSize: 12, fontWeight: 800, cursor: "pointer", display: "flex", alignItems: "center", gap: 5 }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>Add
          </button>
          {wallets.length > 0 && <button onClick={() => wallets.forEach(w => fetchPositions(w))} style={{ background: "transparent", border: "1px solid " + T.cardBorder, borderRadius: 8, padding: "8px 14px", fontSize: 11, color: T.muted, cursor: "pointer", display: "flex", alignItems: "center", gap: 5 }}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 11-2.12-9.36L23 10"/></svg>Refresh All
          </button>}
          <button onClick={() => { setConnected(false); setApiKey(""); }} style={{ background: "transparent", border: "1px solid " + T.cardBorder, borderRadius: 8, padding: "8px 12px", fontSize: 10, color: T.muted, cursor: "pointer", marginLeft: "auto" }}>Change Key</button>
        </>)}
      </div>

      <main style={{ padding: "24px 28px", maxWidth: 1440, margin: "0 auto" }}>
        {wallets.length === 0 ? (
          <div style={{ textAlign: "center", padding: "80px 20px", color: T.muted }}>
            <div style={{ fontSize: 52, opacity: 0.12, marginBottom: 16 }}>◇</div>
            <div style={{ fontSize: 15, fontWeight: 700, color: T.text, marginBottom: 8 }}>No wallets tracked yet</div>
            <div style={{ fontSize: 12, color: T.dim, maxWidth: 380, margin: "0 auto", lineHeight: 1.7 }}>{connected ? "Paste a BSC wallet address above to start tracking." : "Enter your DeBank Pro API key to get started."}</div>
          </div>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(440px, 1fr))", gap: 16 }}>
            {wallets.map(w => <WalletCard key={w} wallet={w} positions={positions[w] || []} loading={loading[w]} error={errors[w]} onRemove={() => removeWallet(w)} onRefresh={() => fetchPositions(w)} />)}
          </div>
        )}
      </main>

      {toast && <div style={{ position: "fixed", bottom: 20, right: 20, background: T.card, border: "1px solid " + (toast.isErr ? T.red + "40" : T.accent + "30"), borderRadius: 10, padding: "10px 18px", fontSize: 12, color: toast.isErr ? T.red : T.text, boxShadow: "0 8px 32px rgba(0,0,0,0.5)", zIndex: 1000, animation: "fadeUp 0.25s ease", maxWidth: 360 }}>{toast.msg}</div>}
    </div>
  );
}
