import fs from "fs";
const STATE_FILE = "data/state.json";

export function loadState() {
  try { 
    return JSON.parse(fs.readFileSync(STATE_FILE, "utf8")); 
  }
  catch { 
    return { pos:{} }; 
  }
}

export function saveState(s) {
  fs.mkdirSync("data", { recursive: true });
  fs.writeFileSync(STATE_FILE, JSON.stringify(s, null, 2));
}

/**
 * Maintain average entry/cost and trailing high for each token.
 * side: "BUY" | "SELL", qty in token units, priceUSD is fill price in USD
 */
export function updatePositionState(state, { token, side, qty, priceUSD }) {
  const p = state.pos[token] ?? { qty:0, cost:0, trailingHigh:0 };
  
  if (side === "BUY") {
    p.cost += qty * priceUSD;
    p.qty  += qty;
    if (priceUSD > p.trailingHigh) p.trailingHigh = priceUSD;
  } else { // SELL
    const sellQty = Math.min(qty, p.qty);
    const avg = p.qty > 0 ? p.cost / p.qty : 0;
    p.cost -= avg * sellQty;
    p.qty  -= sellQty;
    // trailingHigh keep as is (we only move it up on new highs)
  }
  
  state.pos[token] = p;
}

/**
 * Get current position state for a token
 */
export function getPositionState(state, token) {
  return state.pos[token] ?? { qty:0, cost:0, trailingHigh:0 };
}

/**
 * Check if a position meets TP/SL conditions
 */
export function checkTpSlConditions(state, token, currentPrice, tpBps, slBps, useTrailing, trailBps) {
  const pos = getPositionState(state, token);
  if (!pos || pos.qty <= 0) return null;
  
  const avg = pos.qty > 0 ? (pos.cost / pos.qty) : currentPrice;
  const hitTP = tpBps > 0 && currentPrice >= avg * (1 + tpBps / 1e4);
  const hitSL = slBps > 0 && currentPrice <= avg * (1 - slBps / 1e4);
  const hitTrail = useTrailing && pos.trailingHigh > 0 && currentPrice <= pos.trailingHigh * (1 - trailBps / 1e4);
  
  if (hitTP || hitSL || hitTrail) {
    return {
      triggered: true,
      reason: hitTP ? "TP" : hitSL ? "SL" : "TRAIL",
      avgEntry: avg,
      currentPrice: currentPrice,
      qty: pos.qty,
      trailingHigh: pos.trailingHigh
    };
  }
  
  return { triggered: false };
}
