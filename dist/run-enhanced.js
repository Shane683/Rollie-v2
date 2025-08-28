import "dotenv/config";
import dayjs from "dayjs";
import { z } from "zod";
import { recall, configureRecall } from "./lib/recall.js";
import { EnhancedCryptoStrategy } from "./strategies/enhancedCryptoStrategy.js";
import { getTokenConfig, parseTokensFromEnv, getBaseTokenFromEnv } from "./lib/tokens.js";
import { getTokenSymbol } from "./lib/tokenMapping.js";
import { getInstruments, normalizeChain, normalizeSymbol } from "./lib/instruments.js";
import { sleep } from "./lib/math.js";
import { CostEstimator } from "./lib/costs.js";
import { StructuredLogger } from "./lib/logger.js";
import { RetryManager } from "./lib/retry.js";
import { loadState, saveState } from "./lib/state.js";
import { ensureDailyQuota, scheduleQuotaGuard } from "./lib/quota.js";

const env = process.env;

const DRY_RUN = env.DRY_RUN === "true";
const POLL_SEC = Number(env.PRICE_POLL_SEC ?? "10");
const DECISION_MIN = Number(env.DECISION_MIN ?? "1");
const AVAILABLE_CAPITAL = Number(env.AVAILABLE_CAPITAL ?? "10000");

// Contest configuration - defaults OFF
const AGGRESSIVE_MODE = env.AGGRESSIVE_MODE === "true";
const VOLUME_BOOST_MODE = env.VOLUME_BOOST_MODE === "true";
const MIN_VOLUME_USD = Number(env.MIN_VOLUME_USD ?? "0");
const TARGET_DAILY_VOLUME = Number(env.TARGET_DAILY_VOLUME ?? "0");

// TP/SL Configuration
const ON_START_MODE = env.ON_START_MODE ?? "rebalance";
const TP_BPS = Number(env.TP_BPS ?? "0");
const SL_BPS = Number(env.SL_BPS ?? "0");
const USE_TRAILING = (env.USE_TRAILING ?? "false") === "true";
const TRAIL_BPS = Number(env.TRAIL_BPS ?? "0");

// Quota configuration - defaults OFF
const MIN_DAILY_TRADES = Number(env.MIN_DAILY_TRADES ?? "0");
const QUOTA_TRADE_USD = Number(env.QUOTA_TRADE_USD ?? "0");
const QUOTA_CHECK_EVERY_MIN = Number(env.QUOTA_CHECK_EVERY_MIN ?? "0");
const QUOTA_WINDOW_END = env.QUOTA_WINDOW_END ?? "23:00";
const QUOTA_BASE = getBaseTokenFromEnv(env.QUOTA_BASE ?? "USDC");
const QUOTA_TOKENS = parseTokensFromEnv(env.QUOTA_TOKENS ?? "ETH,WBTC,SOL,ARB,OP");

// Treat <=0 as "no cap"
const MAX_DAILY_TRADES = Number(env.MAX_DAILY_TRADES ?? "30");
const NO_DAILY_CAP = MAX_DAILY_TRADES <= 0;

// Single switch: only enable quota when any requirement is set
const USE_QUOTA = (
    MIN_DAILY_TRADES > 0 ||
    TARGET_DAILY_VOLUME > 0 ||
    AGGRESSIVE_MODE ||
    VOLUME_BOOST_MODE
);

// Map chain names to recall API parameters
function getRecallParams(chain) {
    const chainMap = {
        'eth': { chain: 'evm', specificChain: 'eth' },
        'base': { chain: 'evm', specificChain: 'base' },
        'arbitrum': { chain: 'evm', specificChain: 'arbitrum' },
        'optimism': { chain: 'evm', specificChain: 'optimism' },
        'polygon': { chain: 'evm', specificChain: 'polygon' },
        'solana': { chain: 'solana', specificChain: 'mainnet' }
    };
    
    return chainMap[chain] || { chain: 'evm', specificChain: 'eth' };
}

// Fallback to old format if TRADE_PAIRS not specified
const TRADE_TOKENS = parseTokensFromEnv(env.TRADE_TOKENS ?? "ETH,WBTC,SOL,ARB,OP,MATIC");
const CHAINS = (env.CHAINS ?? "eth,base,arbitrum,optimism,polygon,svm").split(",").map(c => c.trim().toLowerCase());
const BASE = getBaseTokenFromEnv(env.BASE ?? "USDC");

// Get normalized instruments using the new module
const INSTRUMENTS = getInstruments({ CHAINS, TRADE_TOKENS });

// Use TRADE_PAIRS for quota if available, otherwise fallback to QUOTA_TOKENS
const QUOTA_INSTRUMENTS = INSTRUMENTS.map(i => i.symbol);

console.log("🚀 ENHANCED CRYPTO TRADING STRATEGY v2.0 STARTING 🚀");

if (USE_QUOTA) {
    console.log(`🚀 CONTEST MODE: ${AGGRESSIVE_MODE ? 'ENABLED' : 'DISABLED'}`);
    console.log(`🚀 VOLUME BOOST MODE: ${VOLUME_BOOST_MODE ? 'ENABLED' : 'DISABLED'}`);
    console.log(`🎯 TARGET DAILY VOLUME: $${TARGET_DAILY_VOLUME.toLocaleString()}`);
    console.log(`🛡️ Quota system: ${MIN_DAILY_TRADES} trades/day, $${QUOTA_TRADE_USD} per trade`);
    console.log(`🕐 Quota check: every ${QUOTA_CHECK_EVERY_MIN} min, safe window ends: ${QUOTA_WINDOW_END}`);
    console.log(`⚡ Contest settings: Min volume $${MIN_VOLUME_USD}, Max daily trades: ${NO_DAILY_CAP ? 'UNLIMITED' : MAX_DAILY_TRADES}`);
} else {
    console.log("🚀 Contest/Quota features: DISABLED");
}

// Always show daily trade limit configuration
console.log(`📅 Daily Trade Limit: ${NO_DAILY_CAP ? 'UNLIMITED' : `${MAX_DAILY_TRADES} trades/day`}`);

// Show trading configuration
if (env.TRADE_PAIRS) {
    console.log(`🚀 Trading pairs: ${INSTRUMENTS.map(i => `${i.chain}:${i.symbol}`).join(', ')}`);
    console.log(`💡 Using explicit TRADE_PAIRS format (chain:symbol)`);
} else {
    console.log(`🚀 Trading tokens: ${INSTRUMENTS.map(i => i.symbol).join(', ')} on chains: ${INSTRUMENTS.map(i => i.chain).join(', ')}`);
    console.log(`💡 Using fallback cartesian product (TRADE_TOKENS × CHAINS)`);
    console.log(`💡 To use explicit pairs, set TRADE_PAIRS=eth:ETH,base:WBTC,solana:SOL`);
}
console.log(`🔧 Normalized instruments: ${INSTRUMENTS.map(i => `${i.chain}:${i.symbol}${i.address ? `(${i.address.substring(0, 8)}...)` : ''}`).join(', ')}`);
console.log(`💰 Available Capital: $${AVAILABLE_CAPITAL.toLocaleString()}`);
console.log(`🎯 TP/SL Configuration: TP=${TP_BPS}bps, SL=${SL_BPS}bps, Trailing=${USE_TRAILING ? TRAIL_BPS + 'bps' : 'OFF'}`);
console.log(`🚀 Startup Mode: ${ON_START_MODE.toUpperCase()}`);

// Initialize the enhanced strategy
const strategy = new EnhancedCryptoStrategy(
    USE_QUOTA ? {
        aggressiveMode: AGGRESSIVE_MODE,
        volumeBoostMode: VOLUME_BOOST_MODE,
        minVolumeUsd: MIN_VOLUME_USD,
        maxDailyTrades: MAX_DAILY_TRADES,
        targetDailyVolume: TARGET_DAILY_VOLUME
    } : {}
);

// Initialize advanced features
const costEstimator = new CostEstimator();
const logger = new StructuredLogger();
const retryManager = new RetryManager();

// Load existing state
let state = loadState();
console.log(`📁 Loaded existing state: ${Object.keys(state.pos || {}).length} positions`);

// Configure Recall API with fallback to working key
const apiKey = env.RECALL_API_KEY || "3899c1633fc11947_32ccac99ebfb407e";
const apiUrl = env.RECALL_API_URL || "https://api.sandbox.competitions.recall.network";

console.log(`🔑 API Key: ${apiKey.substring(0, 10)}...`);
console.log(`🌐 API URL: ${apiUrl}`);

configureRecall(apiKey, apiUrl);

// Schedule quota guard only when enabled
if (USE_QUOTA) {
    scheduleQuotaGuard(async () => {
        const res = await ensureDailyQuota(recall, {
            dryRun: (env.DRY_RUN === "true"),
            minDailyTrades: MIN_DAILY_TRADES,
            quotaTradeUsd: Number(env.QUOTA_TRADE_USD ?? "150"),
            tokensCsv: String(QUOTA_INSTRUMENTS.join(",")),
            targetDailyVolume: TARGET_DAILY_VOLUME,
            checkEveryMin: QUOTA_CHECK_EVERY_MIN,
        });
        if (res?.action && res?.action !== "enough") console.log("[QUOTA]", res);
        else console.log("[QUOTA] OK - quota satisfied/disabled");
    }, { everyMin: QUOTA_CHECK_EVERY_MIN });
}

console.log(`🚀 Enhanced Crypto Strategy starting…`, {
    DRY_RUN,
    POLL_SEC,
    QUOTA_TRADE_USD,
    QUOTA_CHECK_EVERY_MIN,
    QUOTA_WINDOW_END,
    AVAILABLE_CAPITAL
});

// Display enhanced strategy summary
const strategySummary = strategy.getStrategySummary();
console.log(`\n📊 Strategy: ${strategySummary.name} v${strategySummary.version}`);
console.log(`✨ Features: ${strategySummary.features.join(', ')}`);
console.log(`🔧 Components: ${Object.values(strategySummary.components).join(', ')}`);

// Display initial risk status
const initialRiskReport = strategy.riskManager.getRiskReport();
console.log(`🔥 Portfolio Heat: ${initialRiskReport.portfolioHeat.color} ${initialRiskReport.portfolioHeat.percentage.toFixed(1)}%`);
console.log(`📊 Risk Metrics: Win Rate ${(initialRiskReport.riskMetrics.winRate * 100).toFixed(1)}%, Avg Win $${initialRiskReport.riskMetrics.avgWin.toFixed(2)}, Avg Loss $${initialRiskReport.riskMetrics.avgLoss.toFixed(2)}`);

// Main trading loop
async function main() {
    let iteration = 0;
    let dailyTradeCount = 0;
    let lastTradeDate = null;
    
    while (true) {
        iteration++;
        const now = dayjs();
        
        // Reset daily trade count at midnight
        if (lastTradeDate !== now.format('YYYY-MM-DD')) {
            dailyTradeCount = 0;
            lastTradeDate = now.format('YYYY-MM-DD');
        }
        
        try {
            console.log(`\n🔄 Iteration ${iteration} - ${now.format('YYYY-MM-DD HH:mm:ss')}`);
            
            // Check daily trade limit
            if (!NO_DAILY_CAP && dailyTradeCount >= MAX_DAILY_TRADES) {
                console.log(`[Guard] Daily trade limit reached: ${dailyTradeCount}/${MAX_DAILY_TRADES}`);
                await sleep(POLL_SEC * 1000);
                continue;
            }
            
            // Process normalized instruments
            for (const instrument of INSTRUMENTS) {
                try {
                    const { chain, symbol, address } = instrument;
                    const recallParams = getRecallParams(chain);
                    
                    // Use address if available, otherwise use symbol
                    const tokenToQuery = address || symbol;
                    
                    // Get current price with retry mechanism using correct API parameters
                    console.log(`[DEBUG] Calling recall.price(${tokenToQuery}, ${recallParams.chain}, ${recallParams.specificChain})`);
                    const price = await retryManager.retry(
                        () => recall.price(tokenToQuery, recallParams.chain, recallParams.specificChain),
                        `Getting price for ${tokenToQuery} on ${recallParams.chain}/${recallParams.specificChain}`
                    );
                    
                    console.log(`[DEBUG] Price result:`, price);
                    
                    if (!price) {
                        console.log(`[${now.format('HH:mm:ss')}] Failed to get price for ${symbol} on ${recallParams.chain}/${recallParams.specificChain} - No price data`);
                        continue;
                    }
                    
                    const volume = null; // recall.price doesn't return volume
                    
                    // Update strategy with new price data
                    strategy.updatePrice(symbol, price, volume);
                    
                    // Get enhanced trading decision
                    const decision = strategy.targetPosition(symbol, AVAILABLE_CAPITAL);
                    
                    if (decision.position !== 0) {
                        console.log(`[${now.format('HH:mm:ss')}] ${symbol}: ${decision.reason}`);
                        
                        if (!DRY_RUN) {
                            // Execute trade logic here
                            console.log(`[${symbol}] Would execute ${decision.position > 0 ? 'BUY' : 'SELL'} of ${Math.abs(decision.position).toFixed(6)}`);
                            
                            // Update portfolio heat (simulate position opening)
                            if (decision.sizing && decision.sizing.risk) {
                                strategy.openPosition(symbol, decision.sizing.risk, price, decision.position);
                            }
                            
                            // Increment daily trade count
                            dailyTradeCount++;
                            console.log(`[Trade] Daily trade count: ${dailyTradeCount}/${MAX_DAILY_TRADES}`);
                        }
                    } else if (decision.reason && decision.reason !== 'Insufficient data') {
                        console.log(`[${now.format('HH:mm:ss')}] ${symbol}: ${decision.reason}`);
                    }
                    
                } catch (error) {
                    const recallParams = getRecallParams(instrument.chain);
                    console.log(`[PRICE] Skip ${instrument.symbol} on ${recallParams.chain}/${recallParams.specificChain}: ${error?.message || error}`);
                    if (error.response) {
                        console.log(`[PRICE] API Response: Status ${error.response.status}, Data: ${JSON.stringify(error.response.data)}`);
                    }
                }
            }
            
            // Display current portfolio heat and risk status
            const currentHeatStatus = strategy.riskManager.getPortfolioHeatStatus();
            const currentRiskReport = strategy.riskManager.getRiskReport();
            
            console.log(`\n🔥 Portfolio Heat Status: ${currentHeatStatus.color} ${currentHeatStatus.status} (${currentHeatStatus.percentage.toFixed(1)}%)`);
            console.log(`📊 Risk Summary: ${currentRiskReport.openPositions} open positions, ${currentRiskReport.closedPositions} closed`);
            console.log(`💰 Performance: ${strategy.performanceMetrics.totalTrades} total trades, ${(strategy.performanceMetrics.winRate * 100).toFixed(1)}% win rate, P&L $${strategy.performanceMetrics.totalPnl.toFixed(2)}`);
            console.log(`📅 Daily Trades: ${dailyTradeCount}/${NO_DAILY_CAP ? 'UNLIMITED' : MAX_DAILY_TRADES}`);
            
            // Show contest status only when enabled
            if (USE_QUOTA) {
                console.log(`🎯 Contest Status: Volume $${strategy.performanceMetrics.totalVolume?.toFixed(2) || '0.00'}, Trades ${strategy.performanceMetrics.totalTrades}`);
            }
            
            // Save state periodically
            if (iteration % 10 === 0) {
                saveState(state);
                console.log(`💾 State saved at iteration ${iteration}`);
                
                // Display detailed strategy summary every 10 iterations
                const detailedSummary = strategy.getStrategySummary();
                console.log(`\n📈 Strategy Performance Summary:`);
                console.log(`   • Total Trades: ${detailedSummary.performance.totalTrades}`);
                console.log(`   • Win Rate: ${(detailedSummary.performance.winRate * 100).toFixed(1)}%`);
                console.log(`   • Total P&L: $${detailedSummary.performance.totalPnl.toFixed(2)}`);
                console.log(`   • Max Drawdown: $${detailedSummary.performance.maxDrawdown.toFixed(2)}`);
                console.log(`   • Current Heat: ${detailedSummary.currentStatus.portfolioHeat.color} ${detailedSummary.currentStatus.portfolioHeat.percentage.toFixed(1)}%`);
                
                // Show contest metrics only when enabled
                if (USE_QUOTA) {
                    console.log(`   • Contest Volume: $${detailedSummary.performance.totalVolume?.toFixed(2) || '0.00'}`);
                    console.log(`   • Contest Trades: ${detailedSummary.performance.totalTrades}`);
                }
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
    
    // Display final strategy summary
    const finalSummary = strategy.getStrategySummary();
    console.log(`\n📊 FINAL STRATEGY SUMMARY:`);
    console.log(`   • Strategy: ${finalSummary.name} v${finalSummary.version}`);
    console.log(`   • Total Trades: ${finalSummary.performance.totalTrades}`);
    console.log(`   • Win Rate: ${(finalSummary.performance.winRate * 100).toFixed(1)}%`);
    console.log(`   • Total P&L: $${finalSummary.performance.totalPnl.toFixed(2)}`);
    console.log(`   • Final Heat: ${finalSummary.currentStatus.portfolioHeat.color} ${finalSummary.currentStatus.portfolioHeat.percentage.toFixed(1)}%`);
    
    // Show contest metrics only when enabled
    if (USE_QUOTA) {
        console.log(`   • Contest Volume: $${finalSummary.performance.totalVolume?.toFixed(2) || '0.00'}`);
        console.log(`   • Contest Trades: ${finalSummary.performance.totalTrades}`);
    }
    
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

// Start the enhanced trading bot
main().catch(error => {
    console.error('💥 Fatal error in main loop:', error);
    saveState(state);
    process.exit(1);
});
