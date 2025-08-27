import { sleep } from "./math.js";

/**
 * Get total equity in USD from portfolio
 */
export async function getEquityUSD({ recall, base, chain }) {
  try {
    const pf = await recall.portfolio();
    const balances = pf?.balances ?? pf?.tokens ?? {};
    const symbols = Object.keys(balances);
    let equity = 0;
    
    for (const sym of symbols) {
      if (sym === base) continue;
      const qty = Number(balances[sym] || 0);
      if (!qty) continue;
      
      try {
        const px = await recall.price(sym, chain || "evm", chain === "eth" ? "eth" : "evm");
        equity += qty * Number(px);
      } catch (e) {
        console.warn(`Failed to get price for ${sym}:`, e.message);
      }
    }
    
    return equity;
  } catch (e) {
    console.error("Failed to get equity:", e.message);
    return 0;
  }
}

/**
 * Sell in chunks respecting 25% equity rule and cooldown
 */
export async function sellInChunks({ 
  recall, 
  symbol, 
  qty, 
  base, 
  chain, 
  tradeCooldownSec = 1,
  reason = "tp-sl-exit"
}) {
  if (qty <= 0) return;
  
  try {
    const px = await recall.price(symbol, chain || "evm", chain === "eth" ? "eth" : "evm");
    const usdTotal = qty * Number(px);
    const equity = await getEquityUSD({ recall, base, chain });
    const cap = 0.25 * equity; // 25% per trade
    
    if (cap <= 0) {
      console.warn(`[TP/SL] ${symbol}: Cannot determine equity cap, selling all at once`);
      await recall.tradeExecute({ 
        fromToken: symbol, 
        toToken: base, 
        amount: String(qty), 
        reason 
      });
      return;
    }
    
    const chunks = Math.max(1, Math.ceil(usdTotal / cap));
    const qtyPerChunk = qty / chunks;
    
    console.log(`[TP/SL] ${symbol}: Selling ${qty} in ${chunks} chunks (${qtyPerChunk.toFixed(6)} per chunk)`);
    
    for (let i = 0; i < chunks; i++) {
      const remainingQty = qty - (i * qtyPerChunk);
      const chunkQty = Math.min(qtyPerChunk, remainingQty);
      
      if (chunkQty <= 0) break;
      
      console.log(`[TP/SL] ${symbol}: Chunk ${i + 1}/${chunks}, selling ${chunkQty.toFixed(6)}`);
      
      await recall.tradeExecute({ 
        fromToken: symbol, 
        toToken: base, 
        amount: String(chunkQty), 
        reason: `${reason}-chunk-${i + 1}` 
      });
      
      if (i < chunks - 1) {
        await sleep((tradeCooldownSec || 1) * 1000);
      }
    }
    
    console.log(`[TP/SL] ${symbol}: Successfully sold ${qty} in ${chunks} chunks`);
    
  } catch (e) {
    console.error(`[TP/SL] ${symbol}: Failed to sell in chunks:`, e.message);
    throw e;
  }
}

/**
 * Check TP/SL conditions and execute exits if needed
 */
export async function checkTpSlAndExitIfNeeded({ 
  recall, 
  base, 
  chain, 
  tradeCooldownSec,
  tradingState,
  tpBps,
  slBps,
  useTrailing,
  trailBps,
  updatePositionState,
  saveState
}) {
  try {
    const pf = await recall.portfolio();
    const balances = pf?.balances ?? pf?.tokens ?? {};
    
    for (const [sym, balance] of Object.entries(balances)) {
      if (sym === base) continue;
      
      const qty = Number(balance?.qty || balance || 0);
      if (qty <= 0) continue;

      try {
        const px = await recall.price(sym, chain || "evm", chain === "eth" ? "eth" : "evm");
        const st = tradingState.pos[sym];

        // If we don't have saved state (first run), skip TP/SL for this token
        if (!st || !st.qty) continue;

        // Update trailing high if enabled
        if (useTrailing && px > (st.trailingHigh || 0)) {
          st.trailingHigh = px; 
          saveState(tradingState);
        }

        const avg = st.qty > 0 ? (st.cost / st.qty) : px;
        const hitTP = tpBps > 0 && px >= avg * (1 + tpBps / 1e4);
        const hitSL = slBps > 0 && px <= avg * (1 - slBps / 1e4);
        const hitTrail = useTrailing && st.trailingHigh > 0 && px <= st.trailingHigh * (1 - trailBps / 1e4);

        if (hitTP || hitSL || hitTrail) {
          console.log(`[TP/SL] ${sym} qty=${qty} avg=${avg.toFixed(6)} px=${px} reason=${hitTP ? "TP" : hitSL ? "SL" : "TRAIL"}`);
          
          await sellInChunks({ 
            recall, 
            symbol: sym, 
            qty, 
            base, 
            chain, 
            tradeCooldownSec 
          });
          
          // Update state after full exit
          updatePositionState(tradingState, { 
            token: sym, 
            side: "SELL", 
            qty, 
            priceUSD: px 
          });
          saveState(tradingState);
        }
      } catch (e) {
        console.error(`[TP/SL] ${sym}: Error checking TP/SL:`, e.message);
      }
    }
  } catch (e) {
    console.error("[TP/SL] Failed to check TP/SL conditions:", e.message);
  }
}
