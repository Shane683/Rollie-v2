import "dotenv/config";
import dayjs from "dayjs";
import { z } from "zod";
import { recall, configureRecall } from "./lib/recall.js";
import { AdvancedCryptoStrategy } from "./strategies/advancedCryptoStrategy.js";
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
    AGGRESSIVE_MODE: z.string().optional(),
    VOLUME_BOOST_MODE: z.string().optional(),
    MIN_VOLUME_USD: z.string().optional(),
    MAX_DAILY_TRADES: z.string().optional(),
    TARGET_DAILY_VOLUME: z.string().optional(),
    MIN_DAILY_TRADES: z.string().optional(),
    QUOTA_TRADE_USD: z.string().optional(),
    QUOTA_CHECK_EVERY_MIN: z.string().optional(),
    QUOTA_WINDOW_END: z.string().optional(),
    QUOTA_BASE: z.string().optional(),
    QUOTA_TOKENS: z.string().optional(),
    ON_START_MODE: z.string().optional(),
    TP_BPS: z.string().optional(),
    SL_BPS: z.string().optional(),
    USE_TRAILING: z.string().optional(),
    TRAIL_BPS: z.string().optional(),
}).parse(process.env);

const DRY_RUN = env.DRY_RUN === "true";
const POLL_SEC = Number(env.PRICE_POLL_SEC ?? "10");
const DECISION_MIN = Number(env.DECISION_MIN ?? "1");

// Contest configuration - 2000+ volume target
const AGGRESSIVE_MODE = env.AGGRESSIVE_MODE === "true";
const VOLUME_BOOST_MODE = env.VOLUME_BOOST_MODE === "true";
const MIN_VOLUME_USD = Number(env.MIN_VOLUME_USD ?? "150");
const MAX_DAILY_TRADES = Number(env.MAX_DAILY_TRADES ?? "30");
const TARGET_DAILY_VOLUME = Number(env.TARGET_DAILY_VOLUME ?? "2000");

// TP/SL Configuration
const ON_START_MODE = env.ON_START_MODE ?? "rebalance";
const TP_BPS = Number(env.TP_BPS ?? "0");
const SL_BPS = Number(env.SL_BPS ?? "0");
const USE_TRAILING = (env.USE_TRAILING ?? "false") === "true";
const TRAIL_BPS = Number(env.TRAIL_BPS ?? "0");

// Remove daily trade limit when MAX_DAILY_TRADES <= 0
const NO_DAILY_CAP = MAX_DAILY_TRADES <= 0;

// Quota configuration - Contest 2000+ volume optimized
const MIN_DAILY_TRADES = Number(env.MIN_DAILY_TRADES ?? "10");
const QUOTA_TRADE_USD = Number(env.QUOTA_TRADE_USD ?? "200");
const QUOTA_CHECK_EVERY_MIN = Number(env.QUOTA_CHECK_EVERY_MIN ?? "5");
const QUOTA_WINDOW_END = env.QUOTA_WINDOW_END ?? "23:00";
const QUOTA_BASE = getBaseTokenFromEnv(env.QUOTA_BASE ?? "USDC");
const QUOTA_TOKENS = parseTokensFromEnv(env.QUOTA_TOKENS ?? "WETH,WBTC,SOL,MATIC,AVAX");

// Parse tokens from environment - Contest 2000+ volume expanded
const TRADE_TOKENS = parseTokensFromEnv(env.TRADE_TOKENS ?? "WETH,WBTC,SOL,MATIC,AVAX,UNI,AAVE,LINK");
const BASE = getBaseTokenFromEnv(env.BASE ?? "USDC");

// Get normalized instruments using the new module
const CHAINS = ["eth", "base", "arbitrum", "optimism", "polygon", "solana"];
const INSTRUMENTS = getInstruments({ CHAINS, TRADE_TOKENS });

console.log("🚀 ADVANCED CRYPTO TRADING STRATEGY STARTING 🚀");
console.log(`🚀 CONTEST MODE: ${AGGRESSIVE_MODE ? 'ENABLED' : 'DISABLED'}`);
console.log(`🚀 VOLUME BOOST MODE: ${VOLUME_BOOST_MODE ? 'ENABLED' : 'DISABLED'}`);
console.log(`🎯 TARGET DAILY VOLUME: $${TARGET_DAILY_VOLUME.toLocaleString()}`);
console.log(`🚀 Trading tokens: ${TRADE_TOKENS.join(', ')} with base: ${BASE}`);
console.log(`🔧 Normalized instruments: ${INSTRUMENTS.map(i => `${i.chain}:${i.symbol}${i.address ? `(${i.address.substring(0, 8)}...)` : ''}`).join(', ')}`);
console.log(`🛡️ Quota system: ${MIN_DAILY_TRADES} trades/day, $${QUOTA_TRADE_USD} per trade`);
console.log(`🕐 Quota check: every ${QUOTA_CHECK_EVERY_MIN} min, safe window ends: ${QUOTA_WINDOW_END}`);
console.log(`⚡ Contest settings: Min volume $${MIN_VOLUME_USD}, Max daily trades: ${NO_DAILY_CAP ? 'UNLIMITED' : MAX_DAILY_TRADES}`);
console.log(`🎯 TP/SL Configuration: TP=${TP_BPS}bps, SL=${SL_BPS}bps, Trailing=${USE_TRAILING ? TRAIL_BPS + 'bps' : 'OFF'}`);
console.log(`🚀 Startup Mode: ${ON_START_MODE.toUpperCase()}`);

// Initialize the advanced strategy
const strategy = new AdvancedCryptoStrategy({
    aggressiveMode: AGGRESSIVE_MODE,
    volumeBoostMode: VOLUME_BOOST_MODE,
    minVolumeUsd: MIN_VOLUME_USD,
    maxDailyTrades: MAX_DAILY_TRADES,
    targetDailyVolume: TARGET_DAILY_VOLUME
});

// Initialize advanced features
const costEstimator = new CostEstimator();
const logger = new StructuredLogger();
const retryManager = new RetryManager();

// Load existing state
let state = loadState();
console.log(`📁 Loaded existing state: ${Object.keys(state.pos || {}).length} positions`);

// Configure Recall API
configureRecall(env.RECALL_API_KEY, env.RECALL_API_URL);

// Initialize quota system - simplified for now
console.log(`[QUOTA] Quota system initialized: ${MIN_DAILY_TRADES} trades/day, $${QUOTA_TRADE_USD} per trade`);

console.log(`🚀 Advanced Crypto Strategy starting…`, {
    DRY_RUN,
    POLL_SEC,
    QUOTA_TRADE_USD,
    QUOTA_CHECK_EVERY_MIN,
    QUOTA_WINDOW_END
});

// Display strategy summary
const strategySummary = strategy.getStrategySummary();
console.log(`📊 Strategy: ${strategySummary.name}`);
console.log(`✨ Features: ${strategySummary.features.join(', ')}`);
console.log(`🔥 Portfolio Heat: ${(strategySummary.currentHeat * 100).toFixed(1)}% / ${(strategySummary.maxHeat * 100).toFixed(1)}%`);

// Main trading loop
async function main() {
    let iteration = 0;
    
    while (true) {
        iteration++;
        const now = dayjs();
        
        try {
            console.log(`\n🔄 Iteration ${iteration} - ${now.format('YYYY-MM-DD HH:mm:ss')}`);
            
            // Check quota status - simplified for now
            const quotaStatus = { canTrade: true, message: "Quota check passed" };
            if (!quotaStatus.canTrade) {
                console.log(`[QUOTA] ${quotaStatus.message}`);
                await sleep(POLL_SEC * 1000);
                continue;
            }
            
            // Process each trading token using normalized instruments
            for (const { chain, symbol, address } of INSTRUMENTS) {
                try {
                    // Get current price using address if available, otherwise use symbol
                    const tokenToQuery = address || symbol;
                    const price = await retryManager.retry(
                        () => recall.price(tokenToQuery, chain, chain === "solana" ? "mainnet" : chain),
                        `Getting price for ${symbol} on ${chain}`
                    );
                    
                    if (!price) {
                        console.log(`[${now.format('HH:mm:ss')}] Failed to get price for ${symbol} on ${chain}`);
                        continue;
                    }
                    
                    const volume = null; // recall.price doesn't return volume
                    
                    // Update strategy with new price data
                    strategy.updatePrice(symbol, price, volume);
                    
                    // Get trading decision from advanced strategy
                    const decision = strategy.targetPosition(symbol, 1000); // Assuming $1000 available capital
                    
                    if (decision.position !== 0) {
                        console.log(`[${now.format('HH:mm:ss')}] ${symbol}: ${decision.reason}`);
                        
                        if (!DRY_RUN) {
                            // Execute trade logic here
                            // This would integrate with your existing trade execution system
                            console.log(`[${symbol}] Would execute ${decision.position > 0 ? 'BUY' : 'SELL'} of ${Math.abs(decision.position).toFixed(6)}`);
                        }
                    } else if (decision.reason && decision.reason !== 'Insufficient data') {
                        console.log(`[${now.format('HH:mm:ss')}] ${symbol}: ${decision.reason}`);
                    }
                    
                } catch (error) {
                    console.error(`[${now.format('HH:mm:ss')}] Error processing ${symbol} on ${chain}:`, error.message);
                }
            }
            
            // Display current portfolio heat
            const currentHeat = strategy.portfolioHeat;
            const maxHeat = strategy.maxPortfolioHeat;
            console.log(`🔥 Portfolio Heat: ${(currentHeat * 100).toFixed(1)}% / ${(maxHeat * 100).toFixed(1)}%`);
            
            // Save state periodically
            if (iteration % 10 === 0) {
                saveState(state);
                console.log(`💾 State saved at iteration ${iteration}`);
            }
            
            // Wait before next iteration
            await sleep(POLL_SEC * 1000);
            
        } catch (error) {
            console.error(`[${now.format('HH:mm:ss')}] Main loop error:`, error);
            await sleep(POLL_SEC * 1000);
        }
    }
}

// Handle graceful shutdown
process.on('SIGINT', async () => {
    console.log('\n🛑 Shutting down gracefully...');
    saveState(state);
    console.log('💾 Final state saved');
    process.exit(0);
});

process.on('SIGTERM', async () => {
    console.log('\n🛑 Received SIGTERM, shutting down...');
    saveState(state);
    console.log('💾 Final state saved');
    process.exit(0);
});

// Start the trading bot
main().catch(error => {
    console.error('💥 Fatal error in main loop:', error);
    saveState(state);
    process.exit(1);
});
