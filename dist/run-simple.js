import "dotenv/config";
import { recall, configureRecall } from "./lib/recall.js";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const nowIso = () => new Date().toISOString();
function ema(prev, price, len) {
    const k = 2 / (len + 1);
    return prev == null ? price : prev + k * (price - prev);
}
function stdev(arr) {
    if (arr.length < 2)
        return 0;
    const mean = arr.reduce((a, b) => a + b, 0) / arr.length;
    const varr = arr.reduce((s, x) => s + (x - mean) ** 2, 0) / (arr.length - 1);
    return Math.sqrt(varr);
}
// Configure Recall API
const API_KEY = process.env.RECALL_API_KEY || "";
const API_URL = process.env.RECALL_API_URL || "https://api.sandbox.competitions.recall.network";
configureRecall(API_KEY, API_URL);
const TOKENS = (process.env.TRADE_TOKENS || "WETH").split(",").map((s) => s.trim().toUpperCase());
const BASE = (process.env.BASE || "USDC").toUpperCase();
const PRICE_POLL_SEC = Number(process.env.PRICE_POLL_SEC || "30");
const DECISION_MIN = Number(process.env.DECISION_MIN || "5");
const EMA_FAST = Number(process.env.EMA_FAST || "20");
const EMA_SLOW = Number(process.env.EMA_SLOW || "60");
const BASE_RISK_PCT = Number(process.env.BASE_RISK_PCT || "0.01");
const MIN_RISK_PCT = Number(process.env.MIN_RISK_PCT || "0.005");
const MAX_RISK_PCT = Number(process.env.MAX_RISK_PCT || "0.02");
const DAILY_CAP_PCT = Number(process.env.DAILY_NOTIONAL_CAP_PCT || "0.05");
const DRIFT_THRESHOLD = Number(process.env.DRIFT_THRESHOLD || "0.015");
const MIN_LOT_USD = Number(process.env.MIN_LOT_USD || "50");
const TRADE_COOLDOWN_SEC = Number(process.env.TRADE_COOLDOWN_SEC || "60");
const MIN_DAILY_TRADES = Number(process.env.MIN_DAILY_TRADES || "5");
const QUOTA_TRADE_USD = Number(process.env.QUOTA_TRADE_USD || "10");
const QUOTA_CHECK_EVERY_MIN = Number(process.env.QUOTA_CHECK_EVERY_MIN || "15");
const TEST_MINUTES = Number(process.env.TEST_MINUTES || "1440");
const DRY_RUN = (process.env.DRY_RUN || "false") === "true";
// địa chỉ token
const ADDR = {
    USDC: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
    WETH: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2",
    WBTC: "0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599",
    SOL: "So11111111111111111111111111111111111111112"
};
async function getPrice(tokenAddr) {
    return await recall.price(tokenAddr, "evm", "eth");
}
async function getPortfolio() {
    return await recall.portfolio();
}
async function executeTrade(fromToken, toToken, amountHuman, reason) {
    return await recall.tradeExecute({
        fromToken,
        toToken,
        amount: String(amountHuman),
        reason
    });
}
async function getRecentTrades(limit = 500) {
    const data = await recall.trades();
    const trades = Array.isArray(data?.trades) ? data.trades : [];
    return trades.slice(-limit);
}
const states = {};
TOKENS.forEach(sym => {
    states[sym] = { emaFast: null, emaSlow: null, lastDecisionAt: 0, lastTradeAt: 0, pxBuf: [], retBuf: [] };
});
function riskPctFromVol(stdevPct) {
    const low = 0.5 / 100, high = 2 / 100;
    if (stdevPct <= low)
        return MAX_RISK_PCT;
    if (stdevPct >= high)
        return MIN_RISK_PCT;
    const f = (stdevPct - low) / (high - low);
    return MAX_RISK_PCT - f * (MAX_RISK_PCT - MIN_RISK_PCT);
}
async function main() {
    console.log("▶ Multi-token day test:", TOKENS);
    const startTs = Date.now();
    const endTs = startTs + TEST_MINUTES * 60 * 1000;
    const pf0 = await getPortfolio();
    const nav0 = Number(pf0?.totalValue || 0);
    while (Date.now() < endTs) {
        try {
            const pf = await getPortfolio();
            const nav = Number(pf?.totalValue || 0);
            for (const sym of TOKENS) {
                const st = states[sym];
                const px = await getPrice(ADDR[sym]);
                st.pxBuf.push(px);
                if (st.pxBuf.length > 500)
                    st.pxBuf.shift();
                st.emaFast = ema(st.emaFast, px, EMA_FAST);
                st.emaSlow = ema(st.emaSlow, px, EMA_SLOW);
                if (st.pxBuf.length >= 2) {
                    const r = Math.log(st.pxBuf.at(-1) / st.pxBuf.at(-2));
                    st.retBuf.push(r);
                    if (st.retBuf.length > 500)
                        st.retBuf.shift();
                }
                if (Date.now() - st.lastDecisionAt >= DECISION_MIN * 60 * 1000 && st.emaFast && st.emaSlow) {
                    st.lastDecisionAt = Date.now();
                    const target = st.emaFast > st.emaSlow ? 1 : 0;
                    const posNow = 0; // demo: không track position chi tiết multi-token
                    const drift = target - posNow;
                    const stdevPct = Math.abs(stdev(st.retBuf)) * 100;
                    let riskPct = riskPctFromVol(stdevPct);
                    riskPct = Math.max(MIN_RISK_PCT, Math.min(MAX_RISK_PCT, (riskPct + BASE_RISK_PCT) / 2));
                    let tradeNotional = nav * riskPct;
                    const side = drift > 0 ? "BUY" : "SELL";
                    const qty = Number((tradeNotional / px).toFixed(6));
                    console.log(`[${sym}] px=${px.toFixed(2)} drift=${(drift * 100).toFixed(1)}% riskPct=${(riskPct * 100).toFixed(2)}% notional=$${tradeNotional.toFixed(2)} side=${side}`);
                    if (Math.abs(drift) >= DRIFT_THRESHOLD && tradeNotional >= MIN_LOT_USD && Date.now() - st.lastTradeAt >= TRADE_COOLDOWN_SEC * 1000) {
                        const from = side === "BUY" ? ADDR[BASE] : ADDR[sym];
                        const to = side === "BUY" ? ADDR[sym] : ADDR[BASE];
                        if (DRY_RUN) {
                            console.log(` [DRY] ${side} ${sym} qty=${qty}`);
                        }
                        else {
                            const res = await executeTrade(from, to, qty, `Multi EMA ${side} ${sym}`);
                            console.log(` [LIVE] ${side} ${sym} ok=${res?.success}`);
                        }
                        st.lastTradeAt = Date.now();
                    }
                }
            }
        }
        catch (e) {
            console.error("ERROR", e?.message || e);
            await sleep(2000);
        }
        await sleep(PRICE_POLL_SEC * 1000);
    }
    const pf1 = await getPortfolio();
    const nav1 = Number(pf1?.totalValue || 0);
    console.log(`\n===== REPORT =====\nStart NAV=$${nav0}\nEnd NAV=$${nav1}\nPnL=$${(nav1 - nav0).toFixed(2)}\n`);
}
main();
