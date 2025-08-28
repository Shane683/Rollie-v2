import "dotenv/config";
import dayjs from "dayjs";
import { z } from "zod";
import { recall, configureRecall } from "./lib/recall.js";
import { MultiTokenEMAScalper } from "./strategies/multiTokenEMAScalper.js";
import { getTokenConfig, parseTokensFromEnv, getBaseTokenFromEnv } from "./lib/tokens.js";
import { getInstruments } from "./lib/instruments.js";
import { ensureDailyQuota, scheduleQuotaGuard } from "./lib/quota.js";
import { sleep } from "./lib/math.js";
import { CostEstimator } from "./lib/costs.js";
import { StructuredLogger } from "./lib/logger.js";
import { RetryManager } from "./lib/retry.js";
import { loadState, saveState, updatePositionState } from "./lib/state.js";
import { checkTpSlAndExitIfNeeded } from "./lib/tpsl.js";
const env = z.object({
    RECALL_API_KEY: z.string().min(1),
    RECALL_API_URL: z.string().optional(),
    DRY_RUN: z.string().optional(),
    PRICE_POLL_SEC: z.string().optional(),
    DECISION_MIN: z.string().optional(),
    TRADE_TOKENS: z.string().optional(),
    BASE: z.string().optional(),
    EMA_FAST: z.string().optional(),
    EMA_SLOW: z.string().optional(),
    DRIFT_THRESHOLD: z.string().optional(),
    MIN_LOT_USD: z.string().optional(),
    TRADE_COOLDOWN_SEC: z.string().optional(),
    TURBULENCE_STD: z.string().optional(),
    MAX_POS_HIGH_VOL: z.string().optional(),
    MIN_DAILY_TRADES: z.string().optional(),
    QUOTA_TRADE_USD: z.string().optional(),
    QUOTA_CHECK_EVERY_MIN: z.string().optional(),
    QUOTA_WINDOW_END: z.string().optional(),
    QUOTA_BASE: z.string().optional(),
    QUOTA_TOKENS: z.string().optional(),
    AGGRESSIVE_MODE: z.string().optional(),
    MIN_VOLUME_USD: z.string().optional(),
    MAX_DAILY_TRADES: z.string().optional(),
    TARGET_DAILY_VOLUME: z.string().optional(),
    VOLUME_BOOST_MODE: z.string().optional(),
    // TP/SL Configuration
    ON_START_MODE: z.string().optional(),
    TP_BPS: z.string().optional(),
    SL_BPS: z.string().optional(),
    USE_TRAILING: z.string().optional(),
    TRAIL_BPS: z.string().optional(),
}).parse(process.env);
const DRY_RUN = env.DRY_RUN === "true";
const POLL_SEC = Number(env.PRICE_POLL_SEC ?? "10"); // Reduced for 2000+ volume target
const DECISION_MIN = Number(env.DECISION_MIN ?? "1"); // Reduced for 2000+ volume target
const TRADE_COOLDOWN_SEC = Number(env.TRADE_COOLDOWN_SEC ?? "20"); // Reduced for 2000+ volume target
// Contest configuration - 10000+ volume target with 60%+ win rate
const AGGRESSIVE_MODE = env.AGGRESSIVE_MODE === "true";
const VOLUME_BOOST_MODE = env.VOLUME_BOOST_MODE === "true";
const MIN_VOLUME_USD = Number(env.MIN_VOLUME_USD ?? "100"); // Reduced for more trades
const MAX_DAILY_TRADES = Number(env.MAX_DAILY_TRADES ?? "50"); // Increased for volume target
const TARGET_DAILY_VOLUME = Number(env.TARGET_DAILY_VOLUME ?? "10000"); // Increased to 10k+

// TP/SL Configuration - Optimized for 60%+ win rate
const ON_START_MODE = env.ON_START_MODE ?? "rebalance";
const TP_BPS = Number(env.TP_BPS ?? "150"); // 1.5% take profit - increased for better win rate
const SL_BPS = Number(env.SL_BPS ?? "100"); // 1.0% stop loss - tighter for better win rate
const USE_TRAILING = (env.USE_TRAILING ?? "true") === "true"; // Enable trailing stops
const TRAIL_BPS = Number(env.TRAIL_BPS ?? "75"); // 0.75% trailing stop

// Remove daily trade limit when MAX_DAILY_TRADES <= 0
const NO_DAILY_CAP = MAX_DAILY_TRADES <= 0;

// Quota configuration - 10000+ volume optimized with 10+ trades/day
const MIN_DAILY_TRADES = Number(env.MIN_DAILY_TRADES ?? "10"); // Minimum 10 trades per day
const QUOTA_TRADE_USD = Number(env.QUOTA_TRADE_USD ?? "1000"); // Increased trade size for volume
const QUOTA_CHECK_EVERY_MIN = Number(env.QUOTA_CHECK_EVERY_MIN ?? "3"); // More frequent checks
const QUOTA_WINDOW_END = env.QUOTA_WINDOW_END ?? "23:30"; // Extended trading window
const QUOTA_BASE = getBaseTokenFromEnv(env.QUOTA_BASE ?? "USDC");
const QUOTA_TOKENS = parseTokensFromEnv(env.QUOTA_TOKENS ?? "WETH,WBTC,SOL,MATIC,AVAX,UNI,AAVE,LINK");

// Parse tokens from environment - Expanded for more trading opportunities
const TRADE_TOKENS = parseTokensFromEnv(env.TRADE_TOKENS ?? "WETH,WBTC,SOL,MATIC,AVAX,UNI,AAVE,LINK,DOT,ATOM,NEAR,FTM");
const BASE = getBaseTokenFromEnv(env.BASE ?? "USDC");

// Get normalized instruments using the new module
const CHAINS = ["eth", "base", "arbitrum", "optimism", "polygon", "solana"];
const INSTRUMENTS = getInstruments({ CHAINS, TRADE_TOKENS });

console.log(`🚀 CONTEST MODE: ${AGGRESSIVE_MODE ? 'ENABLED' : 'DISABLED'}`);
console.log(`🚀 VOLUME BOOST MODE: ${VOLUME_BOOST_MODE ? 'ENABLED' : 'DISABLED'}`);
console.log(`🎯 TARGET DAILY VOLUME: $${TARGET_DAILY_VOLUME.toLocaleString()}`);
console.log(`🚀 Trading tokens: ${TRADE_TOKENS.join(', ')} with base: ${BASE}`);
console.log(`🔧 Normalized instruments: ${INSTRUMENTS.map(i => `${i.chain}:${i.symbol}${i.address ? `(${i.address.substring(0, 8)}...)` : ''}`).join(', ')}`);
console.log(`⚡ Contest settings: Min volume $${MIN_VOLUME_USD}, Max daily trades: ${NO_DAILY_CAP ? 'UNLIMITED' : MAX_DAILY_TRADES}`);
console.log(`🎯 TP/SL Configuration: TP=${TP_BPS}bps, SL=${SL_BPS}bps, Trailing=${USE_TRAILING ? TRAIL_BPS + 'bps' : 'OFF'}`);
console.log(`🚀 Startup Mode: ${ON_START_MODE.toUpperCase()}`);
console.log(`🎯 Target: ${MIN_DAILY_TRADES}+ trades/day, $${TARGET_DAILY_VOLUME.toLocaleString()}+ volume, 60%+ win rate`);

const strat = new MultiTokenEMAScalper({
    emaFast: Number(env.EMA_FAST ?? "5"), // Faster EMA for more frequent signals
    emaSlow: Number(env.EMA_SLOW ?? "21"), // Shorter slow EMA for quicker reversals
    driftThreshold: Number(env.DRIFT_THRESHOLD ?? "0.003"), // Lower threshold for more trades
    minLotUsd: Number(env.MIN_LOT_USD ?? "100"), // Lower minimum for more trades
    turbulenceStd: Number(env.TURBULENCE_STD ?? "0.012"), // Adjusted for better signal quality
    maxPosHighVol: Number(env.MAX_POS_HIGH_VOL ?? "0.50"), // Increased for more aggressive trading
    tradeCooldownSec: TRADE_COOLDOWN_SEC, // Per-symbol cooldown base
    aggressiveMode: AGGRESSIVE_MODE, // Enable contest mode
    volumeBoostMode: VOLUME_BOOST_MODE, // Enable volume boost mode
});

// Initialize advanced features
const costEstimator = new CostEstimator();
const logger = new StructuredLogger();
const retryManager = new RetryManager();
let lastDecisionAt = 0;
let lastTradeAt = 0;
let dailyTradeCount = 0;
let dailyVolume = 0;
let lastTradeDate = dayjs().format('YYYY-MM-DD');

// Enhanced risk management for 60%+ win rate
let consecutiveWins = 0;
let consecutiveLosses = 0;
let riskAdjustedPnL = 0;

// P&L tracking
let totalPnL = 0;
let totalTrades = 0;
let winningTrades = 0;
let losingTrades = 0;
let tradeHistory = new Map(); // Track entry prices and quantities per symbol

// Trading state for TP/SL
let tradingState = loadState();
// Simplified adapter cho quota module
const RecallAdapter = {
    async nowPortfolio() {
        const pf = await recall.portfolio();
        return { totalValue: pf?.totalValue ?? 0 };
    },
    async recentTrades() {
        try {
            const data = await recall.trades();
            return { trades: data?.trades || [] };
        }
        catch (error) {
            console.error("Failed to get recent trades:", error);
            return { trades: [] };
        }
    },
    async price(addr) {
        // Try to find the token config to get chain info
        let chain = "evm";
        let specificChain = "eth";
        // Check if it's a known token address
        for (const [symbol, config] of Object.entries(getTokenConfig("WETH") ? { WETH: getTokenConfig("WETH") } : {})) {
            if (config && config.address.toLowerCase() === addr.toLowerCase()) {
                chain = config.chain;
                specificChain = config.specificChain;
                break;
            }
        }
        return await recall.price(addr, chain, specificChain);
    },
    async execute(fromToken, toToken, amountHuman, reason) {
        return await recall.tradeExecute({
            fromToken,
            toToken,
            amount: String(amountHuman),
            reason
        });
    },
    addrOf(sym) {
        const s = sym.toUpperCase();
        // map symbol->address giống phần bạn dùng ở engine
        const ADDR = {
            USDC: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
            WETH: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2",
            WBTC: "0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599",
            SOL: "So11111111111111111111111111111111111111112", // ví dụ, tùy sandbox
            XRP: "r9cZA1lkHfzCxqTbNQk7qHwM9qHwM9qHwM9",
            SUI: "0x2::sui::SUI",
        };
        return ADDR[s] ?? (() => { throw new Error(`Unknown token ${sym}`); })();
    },
};
async function currentWeights() {
    const pf = await recall.portfolio();
    const nav = pf.totalValue || 0;
    const positions = new Map();
    for (const t of pf.tokens || []) {
        const symbol = (t.symbol || "").toUpperCase();
        if (TRADE_TOKENS.includes(symbol)) {
            const currentValue = positions.get(symbol) || 0;
            positions.set(symbol, currentValue + (t.value ?? 0));
        }
    }
    // Calculate position percentages
    const positionPercentages = new Map();
    for (const [symbol, value] of positions) {
        positionPercentages.set(symbol, nav > 0 ? value / nav : 0);
    }
    return { positions: positionPercentages, navUsd: nav };
}

// Calculate P&L for a trade
function calculateTradePnL(symbol, fromToken, toToken, qty, currentPrice, tradeValue) {
    let pnl = 0;
    let pnlPct = 0;
    let tradeType = '';
    
    if (fromToken === BASE) {
        // BUY trade - record entry
        if (!tradeHistory.has(symbol)) {
            tradeHistory.set(symbol, []);
        }
        tradeHistory.get(symbol).push({
            type: 'BUY',
            qty: qty,
            price: currentPrice,
            value: tradeValue,
            timestamp: Date.now()
        });
        tradeType = 'BUY';
        pnl = 0; // No P&L on entry
        pnlPct = 0;
    } else {
        // SELL trade - calculate P&L
        const entries = tradeHistory.get(symbol) || [];
        if (entries.length > 0) {
            // Find the most recent BUY entry to match against
            const buyEntry = entries.find(entry => entry.type === 'BUY');
            if (buyEntry) {
                const entryValue = buyEntry.qty * buyEntry.price;
                pnl = tradeValue - entryValue;
                pnlPct = (pnl / entryValue) * 100;
                
                // Update statistics
                totalPnL += pnl;
                totalTrades++;
                
                // Update consecutive wins/losses for risk management
                if (pnl > 0) {
                    winningTrades++;
                    consecutiveWins++;
                    consecutiveLosses = 0;
                } else if (pnl < 0) {
                    losingTrades++;
                    consecutiveLosses++;
                    consecutiveWins = 0;
                }
                
                // Risk-adjusted P&L calculation
                const riskAdjustedReturn = pnl / (entryValue * 0.01); // 1% risk per trade
                riskAdjustedPnL += riskAdjustedReturn;
                
                // Remove the matched entry
                const index = entries.indexOf(buyEntry);
                entries.splice(index, 1);
            }
        }
        tradeType = 'SELL';
    }
    
    return { pnl, pnlPct, tradeType };
}

// Display P&L summary with enhanced metrics
function displayPnLSummary() {
    const winRate = totalTrades > 0 ? (winningTrades / totalTrades * 100).toFixed(1) : '0.0';
    const avgPnL = totalTrades > 0 ? (totalPnL / totalTrades).toFixed(2) : '0.00';
    const riskAdjustedReturn = totalTrades > 0 ? (riskAdjustedPnL / totalTrades).toFixed(2) : '0.00';
    
    console.log(`\n💰 === ENHANCED P&L SUMMARY ===`);
    console.log(`📊 Total P&L: $${totalPnL.toFixed(2)}`);
    console.log(`📈 Total Trades: ${totalTrades}`);
    console.log(`✅ Winning Trades: ${winningTrades}`);
    console.log(`❌ Losing Trades: ${losingTrades}`);
    console.log(`🎯 Win Rate: ${winRate}% ${winRate >= 60 ? '🎉' : '⚠️'}`);
    console.log(`📊 Average P&L per Trade: $${avgPnL}`);
    console.log(`⚖️ Risk-Adjusted Return: ${riskAdjustedReturn}`);
    console.log(`🔥 Consecutive Wins: ${consecutiveWins}`);
    console.log(`💥 Consecutive Losses: ${consecutiveLosses}`);
    
    // Performance analysis
    if (totalTrades >= 10) {
        if (winRate >= 60) {
            console.log(`🎯 EXCELLENT: Win rate above 60% target!`);
        } else if (winRate >= 50) {
            console.log(`⚠️ GOOD: Win rate above 50%, working towards 60% target`);
        } else {
            console.log(`🚨 NEEDS IMPROVEMENT: Win rate below 50%, consider strategy adjustments`);
        }
    }
    
    console.log(`💰 === END SUMMARY ===\n`);
}
async function main() {
    // Configure the recall client
    configureRecall(env.RECALL_API_KEY, env.RECALL_API_URL);
    console.log("🚀 Recall Multi-Token EMA-Scalper starting…", {
        DRY_RUN,
        POLL_SEC,
        DECISION_MIN,
        TRADE_TOKENS: TRADE_TOKENS.join(', '),
        BASE
        // MIN_DAILY_TRADES,
        // QUOTA_TRADE_USD,
        // QUOTA_CHECK_EVERY_MIN,
        // QUOTA_WINDOW_END
    });
    // Bật quota guard (gọi 1 lần trong hàm main sau khi bot start)
    // scheduleQuotaGuard(async () => {
    //     const dry = process.env.DRY_RUN === "true";
    //     const res = await ensureDailyQuota(RecallAdapter, { dryRun: dry });
    //     if (res?.action && res?.action !== "enough") {
    //         console.log("[QUOTA]", res);
    //     }
    //     else {
    //         console.log("[QUOTA] OK - đủ số lệnh hôm nay.");
    //     }
    // });
    
    // G. Log rotation and cleanup (every hour)
    setInterval(() => {
        logger.cleanOldLogs();
    }, 60 * 60 * 1000);
    
    // Display initial P&L summary
    console.log(`\n💰 === INITIAL P&L STATUS ===`);
    console.log(`📊 Total P&L: $${totalPnL.toFixed(2)}`);
    console.log(`📈 Total Trades: ${totalTrades}`);
    console.log(`✅ Winning Trades: ${winningTrades}`);
    console.log(`❌ Losing Trades: ${losingTrades}`);
    console.log(`💰 === END INITIAL STATUS ===\n`);
    
    // TP/SL check on startup (before first decision cycle)
    if (TP_BPS > 0 || SL_BPS > 0 || USE_TRAILING) {
        console.log(`[STARTUP] Checking TP/SL conditions on existing positions...`);
        await checkTpSlAndExitIfNeeded({
            recall,
            base: BASE,
            chain: "evm",
            tradeCooldownSec: TRADE_COOLDOWN_SEC,
            tradingState,
            tpBps: TP_BPS,
            slBps: SL_BPS,
            useTrailing: USE_TRAILING,
            trailBps: TRAIL_BPS,
            updatePositionState,
            saveState
        });
        console.log(`[STARTUP] TP/SL check completed`);
    }
    
    while (true) {
        try {
            const now = Date.now();
            // 1) Lấy giá cho tất cả tokens
            const tokenPrices = new Map();
            for (const { chain, symbol, address } of INSTRUMENTS) {
                try {
                    // Use address if available, otherwise use symbol
                    const tokenToQuery = address || symbol;
                    const price = await recall.price(tokenToQuery, chain, chain === "solana" ? "mainnet" : chain);
                    tokenPrices.set(symbol, price);
                    // 2) Cập nhật EMA / turbulence cho từng token
                    strat.updatePrice(symbol, price);
                    
                    // E. Check protective exits for existing positions
                    const exitSignal = strat.checkProtectiveExits(symbol, price);
                    if (exitSignal) {
                        console.log(`[${ts()}] 🚨 ${symbol}: ${exitSignal.type.toUpperCase()} - ${exitSignal.reason}`);
                        logger.logProtectiveExit(symbol, exitSignal.type, exitSignal.reason, price, strat.getTokenState(symbol)?.entryPrice || 0);
                        
                        // TODO: Execute protective exit trade
                        // This would require additional logic to handle the exit trade
                    }
                }
                catch (e) {
                    console.error(`[${ts()}] Failed to get price for ${symbol} on ${chain}:`, e);
                }
            }
            // 3) Mỗi DECISION_MIN phút mới ra quyết định
            const shouldDecide = now - lastDecisionAt >= DECISION_MIN * 60000;
            if (shouldDecide) {
                lastDecisionAt = now;
                
                // TP/SL check at the start of each decision loop
                if (TP_BPS > 0 || SL_BPS > 0 || USE_TRAILING) {
                    await checkTpSlAndExitIfNeeded({
                        recall,
                        base: BASE,
                        chain: "evm",
                        tradeCooldownSec: TRADE_COOLDOWN_SEC,
                        tradingState,
                        tpBps: TP_BPS,
                        slBps: SL_BPS,
                        useTrailing: USE_TRAILING,
                        trailBps: TRAIL_BPS,
                        updatePositionState,
                        saveState
                    });
                }
                // Contest mode: Reset daily trade count at midnight
                const currentDate = dayjs().format('YYYY-MM-DD');
                if (currentDate !== lastTradeDate) {
                    dailyTradeCount = 0;
                    dailyVolume = 0;
                    lastTradeDate = currentDate;
                    console.log(`[${ts()}] 🆕 New trading day started. Daily trade count reset to 0, volume reset to $0.`);
                }
                // Contest mode: Check if we've hit daily trade limit (unless NO_DAILY_CAP is set)
                if (!NO_DAILY_CAP && dailyTradeCount >= MAX_DAILY_TRADES) {
                    console.log(`[${ts()}] ⚠️ Daily trade limit reached (${MAX_DAILY_TRADES}). Skipping trading decisions.`);
                    continue;
                }
                // Volume boost mode: Check if we need more volume
                if (VOLUME_BOOST_MODE && dailyVolume >= TARGET_DAILY_VOLUME) {
                    console.log(`[${ts()}] 🎯 Daily volume target reached: $${dailyVolume.toFixed(2)}/${TARGET_DAILY_VOLUME}. Continuing for safety margin.`);
                }
                // (a) lấy portfolio & positions hiện tại
                const { positions, navUsd } = await currentWeights();
                // (b) xử lý từng token
                for (const symbol of TRADE_TOKENS) {
                    const tokenConfig = getTokenConfig(symbol);
                    if (!tokenConfig)
                        continue;
                    const currentPrice = tokenPrices.get(symbol);
                    if (!currentPrice)
                        continue;
                    const posNow = positions.get(symbol) || 0;
                    const posTgt = strat.targetPosition(symbol);
                    // Contest mode: More aggressive position targeting for 2000+ volume
                    if (AGGRESSIVE_MODE && Math.abs(posTgt - posNow) > 0.003) {
                        console.log(`[${ts()}] ${symbol}: Contest mode - Strong signal detected. posNow=${posNow.toFixed(3)} posTgt=${posTgt.toFixed(3)}`);
                    }
                    // Volume boost mode: Log volume progress
                    if (VOLUME_BOOST_MODE) {
                        console.log(`[${ts()}] 📊 Volume progress: $${dailyVolume.toFixed(2)}/${TARGET_DAILY_VOLUME} (${((dailyVolume / TARGET_DAILY_VOLUME) * 100).toFixed(1)}%)`);
                    }
                    // (c) lập kế hoạch cho token này
                    const plan = strat.makePlan({
                        symbol,
                        navUsd,
                        tokenPrice: currentPrice,
                        posNow,
                        posTgt,
                        baseSymbol: BASE
                    });
                    
                    // D. Costs & spread guard - estimate costs before trading
                    const drift = Math.abs(posTgt - posNow);
                    const tradeValue = drift * navUsd;
                    const estCost = await costEstimator.getTokenCosts(symbol, tradeValue);
                    const expectedReturn = costEstimator.calculateExpectedReturn(drift, strat.getVolatility(symbol));
                    
                    if (!costEstimator.hasSufficientEdge(expectedReturn, estCost)) {
                        console.log(`[${ts()}] ${symbol}: Insufficient edge (${(expectedReturn * 100).toFixed(2)}% < ${(estCost.totalCostPct * 100).toFixed(2)}% + 0.5%), skipping`);
                        logger.logDecision(symbol, currentPrice, drift, posTgt, 0, estCost, 'insufficient_edge', 'skipped');
                        continue;
                    }
                    
                    // (d) thực thi trades
                    if (!plan.shouldTrade) {
                        console.log(`[${ts()}] ${symbol}: No trade. posNow=${posNow.toFixed(3)} posTgt=${posTgt.toFixed(3)} Price=$${currentPrice.toFixed(4)}`);
                        logger.logDecision(symbol, currentPrice, drift, posTgt, 0, estCost, 'no_trade', 'skipped');
                    }
                    else {
                        // Contest mode: Check daily trade limit before executing (unless NO_DAILY_CAP is set)
                        if (!NO_DAILY_CAP && dailyTradeCount >= MAX_DAILY_TRADES) {
                            console.log(`[${ts()}] ⚠️ Daily trade limit reached. Skipping ${symbol} trade.`);
                            break;
                        }
                        
                        // F. Per-symbol cooldown instead of global cooldown
                        if (strat.isInCooldown(symbol)) {
                            console.log(`[${ts()}] ${symbol}: Per-symbol cooldown, skip trade`);
                            continue;
                        }
                        for (const leg of plan.legs) {
                            const qty = Number(leg.qty.toFixed(6)); // làm tròn nhẹ
                            const tradeValue = qty * currentPrice;
                            
                            // Contest mode: Ensure minimum trade value for 2000+ volume target
                            if (tradeValue < MIN_VOLUME_USD) {
                                console.log(`[${ts()}] ${symbol}: Trade value $${tradeValue.toFixed(2)} below minimum $${MIN_VOLUME_USD}. Skipping.`);
                                continue;
                            }
                            
                            const reason = leg.from === BASE
                                ? `Contest 2000+ volume EMA scalper BUY ${symbol} (to target ${posTgt.toFixed(2)})`
                                : `Contest 2000+ volume EMA scalper SELL ${symbol} (to target ${posTgt.toFixed(2)})`;
                            
                            if (DRY_RUN) {
                                console.log(`[${ts()}] ${symbol}: DRY_RUN ${leg.from}→${leg.to} qty=${qty} value=$${tradeValue.toFixed(2)}`);
                                
                                // Calculate and display P&L for DRY_RUN mode too
                                const pnlResult = calculateTradePnL(symbol, leg.from, leg.to, qty, currentPrice, tradeValue);
                                
                                // Display P&L for this trade
                                if (pnlResult.tradeType === 'SELL' && pnlResult.pnl !== 0) {
                                    const pnlEmoji = pnlResult.pnl > 0 ? '💰' : '📉';
                                    console.log(`[${ts()}] ${pnlEmoji} ${symbol}: DRY_RUN P&L: $${pnlResult.pnl.toFixed(2)} (${pnlResult.pnlPct.toFixed(2)}%)`);
                                }
                                
                                // Update position state for TP/SL tracking (DRY_RUN mode)
                                const tradedToken = leg.to === BASE ? leg.from : leg.to;
                                const side = (leg.to === BASE) ? "SELL" : "BUY";
                                const qtyForState = Number(qty);
                                const priceUSD = Number(currentPrice);
                                
                                updatePositionState(tradingState, { 
                                    token: tradedToken, 
                                    side, 
                                    qty: qtyForState, 
                                    priceUSD 
                                });
                                saveState(tradingState);
                                
                                // Display updated P&L summary after each DRY_RUN trade
                                displayPnLSummary();
                                
                                logger.logDecision(symbol, currentPrice, drift, posTgt, qty, estCost, reason, 'dry_run');
                            }
                            else {
                                const fromTokenConfig = getTokenConfig(leg.from);
                                const toTokenConfig = getTokenConfig(leg.to);
                                if (!fromTokenConfig || !toTokenConfig) {
                                    console.error(`[${ts()}] ${symbol}: Invalid token config for ${leg.from} or ${leg.to}`);
                                    continue;
                                }
                                
                                try {
                                    // G. Retry with exponential backoff for trade execution
                                    const res = await retryManager.retryTradeExecution(async () => {
                                        return await recall.tradeExecute({
                                            fromToken: fromTokenConfig.address,
                                            toToken: toTokenConfig.address,
                                            amount: String(qty), // "human units" (backend lo decimals)
                                            reason,
                                        });
                                    }, symbol, 'trade_execution');
                                    
                                    if (res?.success) {
                                        dailyTradeCount++;
                                        dailyVolume += tradeValue;
                                        
                                        // E. Set entry price for protective exits when buying
                                        if (leg.from === BASE) {
                                            strat.setEntryPrice(symbol, currentPrice);
                                        }
                                        
                                        // Update per-symbol cooldown
                                        strat.updateLastTradeTime(symbol);
                                        
                                        // Calculate and display P&L
                                        const pnlResult = calculateTradePnL(symbol, leg.from, leg.to, qty, currentPrice, tradeValue);
                                        
                                        console.log(`[${ts()}] ✅ ${symbol}: TRADE ${leg.from}→${leg.to} qty=${qty} value=$${tradeValue.toFixed(2)} Daily count: ${dailyTradeCount}/${MAX_DAILY_TRADES} Volume: $${dailyVolume.toFixed(2)}/${TARGET_DAILY_VOLUME}`);
                                        
                                        // Display P&L for this trade
                                        if (pnlResult.tradeType === 'SELL' && pnlResult.pnl !== 0) {
                                            const pnlEmoji = pnlResult.pnl > 0 ? '💰' : '📉';
                                            console.log(`[${ts()}] ${pnlEmoji} ${symbol}: P&L: $${pnlResult.pnl.toFixed(2)} (${pnlResult.pnlPct.toFixed(2)}%)`);
                                        }
                                        
                                        // Display updated P&L summary after each trade
                                        displayPnLSummary();
                                        
                                        // Update position state for TP/SL tracking
                                        const tradedToken = leg.to === BASE ? leg.from : leg.to;
                                        const side = (leg.to === BASE) ? "SELL" : "BUY";
                                        const qtyForState = Number(qty);
                                        const priceUSD = Number(currentPrice);
                                        
                                        updatePositionState(tradingState, { 
                                            token: tradedToken, 
                                            side, 
                                            qty: qtyForState, 
                                            priceUSD 
                                        });
                                        saveState(tradingState);
                                        
                                        // Log successful trade
                                        logger.logTrade(symbol, leg.from, leg.to, qty, tradeValue, true);
                                        logger.logDecision(symbol, currentPrice, drift, posTgt, qty, estCost, reason, 'executed');
                                        
                                        lastTradeAt = Date.now();
                                    }
                                    else {
                                        console.error(`[${ts()}] ❌ ${symbol}: Trade failed: ${res?.error || 'Unknown error'}`);
                                        logger.logTrade(symbol, leg.from, leg.to, qty, tradeValue, false, res?.error);
                                    }
                                }
                                catch (tradeError) {
                                    console.error(`[${ts()}] ❌ ${symbol}: Trade execution error:`, tradeError);
                                    logger.logTrade(symbol, leg.from, leg.to, qty, tradeValue, false, tradeError);
                                }
                                
                                // Contest mode: Reduced delay between trades for 2000+ volume target
                                const delay = AGGRESSIVE_MODE ? 800 : 1200;
                                await sleep(delay);
                            }
                        }
                    }
                }
            }
        }
        catch (e) {
            console.error(`[${ts()}] ERROR`, e?.response?.data || e?.message || e);
            // nếu rate limit / network lỗi, nghỉ chút
            await sleep(5000);
        }
        await sleep(POLL_SEC * 1000);
    }
}
function ts() {
    return dayjs().format("YYYY-MM-DD HH:mm:ss");
}
main().catch((e) => {
    console.error(e);
    process.exit(1);
});
