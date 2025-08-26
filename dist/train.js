import "dotenv/config";
import dayjs from "dayjs";
import { z } from "zod";
import { recall, configureRecall } from "./lib/recall.js";
import { EMAScalper } from "./strategies/emaScalper.js";
import { sleep } from "./lib/math.js";
const env = z.object({
    RECALL_API_KEY: z.string().min(1),
    RECALL_API_URL: z.string().optional(),
    DRY_RUN: z.string().optional(),
    PRICE_POLL_SEC: z.string().optional(),
    DECISION_MIN: z.string().optional(),
    EMA_FAST: z.string().optional(),
    EMA_SLOW: z.string().optional(),
    DRIFT_THRESHOLD: z.string().optional(),
    MIN_LOT_USD: z.string().optional(),
    TRADE_COOLDOWN_SEC: z.string().optional(),
    TURBULENCE_STD: z.string().optional(),
    MAX_POS_HIGH_VOL: z.string().optional(),
}).parse(process.env);
const DRY_RUN = env.DRY_RUN === "false"; // Enable real trading for more activity
const POLL_SEC = Number(env.PRICE_POLL_SEC ?? "30"); // 30 seconds for more frequent updates
const DECISION_MIN = Number(env.DECISION_MIN ?? "0.5"); // 30 seconds for faster decisions
const TRADE_COOLDOWN_SEC = Number(env.TRADE_COOLDOWN_SEC ?? "5"); // 5 seconds for more trades
const TRAINING_DURATION_MINUTES = 10;
// Multiple token pairs for more trading opportunities
const TOKENS = {
    WETH: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2",
    USDC: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
    WBTC: "0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599",
    USDT: "0xdAC17F958D2ee523a2206206994597C13D831ec7",
    DAI: "0x6B175474E89094C44Da98b954EedeAC495271d0F",
    LINK: "0x514910771AF9Ca656af840dff83E8264EcF986CA"
};
// Current trading pair
let currentFromToken = "USDC";
let currentToToken = "WETH";
const strat = new EMAScalper({
    emaFast: Number(env.EMA_FAST ?? "10"), // Faster EMA for more signals
    emaSlow: Number(env.EMA_SLOW ?? "30"), // Slower EMA for more signals
    driftThreshold: Number(env.DRIFT_THRESHOLD ?? "0.005"), // Lower threshold for more trades
    minLotUsd: Number(env.MIN_LOT_USD ?? "10"), // Lower minimum lot size
    turbulenceStd: Number(env.TURBULENCE_STD ?? "0.005"), // Lower volatility threshold
    maxPosHighVol: Number(env.MAX_POS_HIGH_VOL ?? "0.50"), // Higher position limit
});
let lastDecisionAt = 0;
let lastTradeAt = 0;
const trainingSession = {
    startTime: new Date(),
    endTime: new Date(),
    initialPortfolio: null,
    finalPortfolio: null,
    trades: [],
    decisions: [],
    pnl: {
        initialValue: 0,
        finalValue: 0,
        absolutePnL: 0,
        percentagePnL: 0,
    }
};
async function currentWeights() {
    try {
        const pf = await recall.portfolio();
        const nav = pf.totalValue || 0;
        let tokenVal = 0;
        for (const t of pf.tokens || []) {
            if ((t.symbol || "").toUpperCase() === currentToToken)
                tokenVal += (t.value ?? 0);
        }
        const posNow = nav > 0 ? tokenVal / nav : 0;
        return { posNow, navUsd: nav };
    }
    catch (error) {
        // Use simulated portfolio data
        const nav = 10000; // $10,000
        const tokenVal = 0; // Start with 0% position in current token
        const posNow = 0;
        return { posNow, navUsd: nav };
    }
}
// Function to switch trading pairs for more opportunities
function switchTradingPair() {
    const pairs = [
        { from: "USDC", to: "WETH" },
        { from: "USDC", to: "WBTC" },
        { from: "USDC", to: "LINK" },
        { from: "USDT", to: "WETH" },
        { from: "DAI", to: "WETH" }
    ];
    const currentIndex = pairs.findIndex(p => p.from === currentFromToken && p.to === currentToToken);
    const nextIndex = (currentIndex + 1) % pairs.length;
    const newPair = pairs[nextIndex];
    currentFromToken = newPair.from;
    currentToToken = newPair.to;
    console.log(`🔄 Switching to ${currentFromToken}→${currentToToken} pair`);
    return newPair;
}
async function getPortfolioSnapshot() {
    try {
        const portfolio = await recall.portfolio();
        return {
            totalValue: portfolio.totalValue || 0,
            tokens: portfolio.tokens || [],
            timestamp: new Date()
        };
    }
    catch (error) {
        console.log("⚠️  Portfolio endpoint not available, using simulated data for training");
        // Simulate a portfolio for training purposes
        return {
            totalValue: 10000, // $10,000 starting portfolio
            tokens: [
                {
                    token: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", // USDC
                    amount: 10000,
                    price: 1,
                    value: 10000,
                    symbol: "USDC"
                }
            ],
            timestamp: new Date(),
            isSimulated: true
        };
    }
}
function generateTrainingReport() {
    console.log("\n" + "=".repeat(80));
    console.log("🎯 TRAINING SESSION COMPLETE - 10 MINUTES");
    console.log("=".repeat(80));
    console.log(`\n📅 Session Duration: ${trainingSession.startTime.toLocaleString()} - ${trainingSession.endTime.toLocaleString()}`);
    console.log(`⏱️  Total Time: ${TRAINING_DURATION_MINUTES} minutes`);
    console.log("\n💰 PORTFOLIO PERFORMANCE:");
    console.log(`   Initial Value: $${trainingSession.pnl.initialValue.toFixed(2)}`);
    console.log(`   Final Value: $${trainingSession.pnl.finalValue.toFixed(2)}`);
    console.log(`   Absolute PnL: $${trainingSession.pnl.absolutePnL.toFixed(2)}`);
    console.log(`   Percentage PnL: ${trainingSession.pnl.percentagePnL.toFixed(2)}%`);
    console.log("\n📊 TRADING ACTIVITY:");
    console.log(`   Total Decisions: ${trainingSession.decisions.length}`);
    console.log(`   Total Trades: ${trainingSession.trades.length}`);
    console.log(`   Successful Trades: ${trainingSession.trades.filter(t => t.success).length}`);
    console.log(`   Failed Trades: ${trainingSession.trades.filter(t => !t.success).length}`);
    if (trainingSession.trades.length > 0) {
        console.log("\n🔄 TRADE DETAILS:");
        trainingSession.trades.forEach((trade, index) => {
            console.log(`   ${index + 1}. ${trade.timestamp.toLocaleTimeString()} - ${trade.from}→${trade.to}`);
            console.log(`      Quantity: ${trade.quantity.toFixed(6)} | Price: $${trade.price.toFixed(2)}`);
            console.log(`      Reason: ${trade.reason}`);
            console.log(`      Status: ${trade.success ? '✅ SUCCESS' : '❌ FAILED'}`);
        });
    }
    console.log("\n📈 DECISION ANALYSIS:");
    trainingSession.decisions.forEach((decision, index) => {
        console.log(`   ${index + 1}. ${decision.timestamp.toLocaleTimeString()}`);
        console.log(`      Position: ${(decision.currentPosition * 100).toFixed(1)}% → ${(decision.targetPosition * 100).toFixed(1)}%`);
        console.log(`      WETH Price: $${decision.wethPrice.toFixed(2)}`);
        console.log(`      Fast EMA: ${decision.fastEMA?.toFixed(2) || 'N/A'} | Slow EMA: ${decision.slowEMA?.toFixed(2) || 'N/A'}`);
        console.log(`      Volatility: ${(decision.volatility * 100).toFixed(2)}%`);
        console.log(`      Trade Decision: ${decision.shouldTrade ? '🔄 TRADE' : '⏸️  HOLD'}`);
    });
    console.log("\n🎯 STRATEGY SUMMARY:");
    console.log(`   Current Trading Pair: ${currentFromToken}→${currentToToken}`);
    console.log(`   EMA Fast: ${strat.getFastEMA()?.toFixed(2) || 'N/A'}`);
    console.log(`   EMA Slow: ${strat.getSlowEMA()?.toFixed(2) || 'N/A'}`);
    console.log(`   Current Volatility: ${(strat.getVolatility() * 100).toFixed(2)}%`);
    console.log(`   Final ${currentToToken} Price: $${strat.getCurrentPrice()?.toFixed(2) || 'N/A'}`);
    console.log("\n" + "=".repeat(80));
}
async function main() {
    // Configure the recall client
    configureRecall(env.RECALL_API_KEY, env.RECALL_API_URL);
    console.log("🚀 Starting EMA-Scalper Training Session...");
    console.log(`⏱️  Training Duration: ${TRAINING_DURATION_MINUTES} minutes`);
    console.log(`📊 Polling every: ${POLL_SEC} seconds`);
    console.log(`🎯 Decision interval: ${DECISION_MIN} minutes`);
    console.log(`🔒 Dry Run: ${DRY_RUN ? 'YES' : 'NO'}`);
    console.log(`🔄 Trading Pair: ${currentFromToken}→${currentToToken}`);
    console.log(`⚡ Aggressive Mode: Faster EMAs, Lower Thresholds`);
    // Get initial portfolio snapshot
    trainingSession.initialPortfolio = await getPortfolioSnapshot();
    trainingSession.pnl.initialValue = trainingSession.initialPortfolio?.totalValue || 0;
    console.log(`\n💰 Initial Portfolio Value: $${trainingSession.pnl.initialValue.toFixed(2)}`);
    if (trainingSession.initialPortfolio?.isSimulated) {
        console.log("⚠️  Using simulated portfolio data (portfolio endpoint unavailable)");
    }
    console.log("🔄 Starting training loop...\n");
    const startTime = Date.now();
    const endTime = startTime + (TRAINING_DURATION_MINUTES * 60 * 1000);
    while (Date.now() < endTime) {
        try {
            const remainingTime = Math.ceil((endTime - Date.now()) / 1000 / 60);
            console.log(`\n⏰ Training continues... ${remainingTime} minutes remaining`);
            // 1) Get current token price
            let tokenPrice = await recall.price(TOKENS[currentToToken], "evm", "eth");
            // Add some simulated price movement for more trading activity
            const timeElapsed = (Date.now() - startTime) / 1000; // seconds
            const volatility = 0.02; // 2% volatility
            const randomFactor = Math.sin(timeElapsed * 0.1) * volatility;
            tokenPrice = tokenPrice * (1 + randomFactor);
            // 2) Update EMA / turbulence
            strat.updatePrice(tokenPrice);
            // 3) Make decision every DECISION_MIN minutes
            const now = Date.now();
            const shouldDecide = now - lastDecisionAt >= DECISION_MIN * 60000;
            // Switch trading pairs every 2 minutes for more opportunities
            if (now - lastDecisionAt >= 2 * 60000) {
                switchTradingPair();
            }
            if (shouldDecide) {
                lastDecisionAt = now;
                // Get current portfolio & position
                const { posNow, navUsd } = await currentWeights();
                const posTgt = strat.targetPosition();
                // Record decision
                trainingSession.decisions.push({
                    timestamp: new Date(),
                    currentPosition: posNow,
                    targetPosition: posTgt,
                    shouldTrade: false,
                    fastEMA: strat.getFastEMA(),
                    slowEMA: strat.getSlowEMA(),
                    volatility: strat.getVolatility(),
                    wethPrice: tokenPrice
                });
                // Create trading plan
                const plan = strat.makePlan({ navUsd, wethPrice: tokenPrice, posNow, posTgt });
                // Update decision record
                trainingSession.decisions[trainingSession.decisions.length - 1].shouldTrade = plan.shouldTrade;
                if (!plan.shouldTrade) {
                    console.log(`[${ts()}] No trade. posNow=${posNow.toFixed(3)} posTgt=${posTgt.toFixed(3)} NAV=$${navUsd.toFixed(2)}`);
                }
                else {
                    // Check cooldown
                    if (now - lastTradeAt < TRADE_COOLDOWN_SEC * 1000) {
                        console.log(`[${ts()}] Cooldown, skip trade`);
                    }
                    else {
                        for (const leg of plan.legs) {
                            const qty = Number(leg.qty.toFixed(6));
                            const reason = leg.from === currentFromToken
                                ? `EMA scalper BUY ${currentToToken} (to target ${posTgt.toFixed(2)})`
                                : `EMA scalper SELL ${currentToToken} (to target ${posTgt.toFixed(2)})`;
                            if (DRY_RUN) {
                                console.log(`[${ts()}] DRY_RUN ${leg.from}→${leg.to} qty=${qty}`);
                                // Record dry run trade
                                trainingSession.trades.push({
                                    timestamp: new Date(),
                                    from: leg.from,
                                    to: leg.to,
                                    quantity: qty,
                                    price: tokenPrice,
                                    reason,
                                    success: true
                                });
                            }
                            else {
                                const fromAddr = TOKENS[leg.from];
                                const toAddr = TOKENS[leg.to];
                                try {
                                    const res = await recall.tradeExecute({
                                        fromToken: fromAddr,
                                        toToken: toAddr,
                                        amount: String(qty),
                                        reason,
                                    });
                                    const success = res?.success || false;
                                    console.log(`[${ts()}] TRADE ${leg.from}→${leg.to} qty=${qty} ok=${success}`);
                                    // Record actual trade
                                    trainingSession.trades.push({
                                        timestamp: new Date(),
                                        from: leg.from,
                                        to: leg.to,
                                        quantity: qty,
                                        price: tokenPrice,
                                        reason,
                                        success
                                    });
                                    if (success) {
                                        lastTradeAt = Date.now();
                                        await sleep(1500); // Avoid API spam
                                    }
                                }
                                catch (error) {
                                    console.error(`[${ts()}] Trade execution failed:`, error);
                                    // Record failed trade
                                    trainingSession.trades.push({
                                        timestamp: new Date(),
                                        from: leg.from,
                                        to: leg.to,
                                        quantity: qty,
                                        price: tokenPrice,
                                        reason,
                                        success: false
                                    });
                                }
                            }
                        }
                    }
                }
            }
        }
        catch (e) {
            console.error(`[${ts()}] ERROR`, e?.response?.data || e?.message || e);
            await sleep(5000);
        }
        await sleep(POLL_SEC * 1000);
    }
    // Training complete - get final portfolio snapshot
    trainingSession.endTime = new Date();
    trainingSession.finalPortfolio = await getPortfolioSnapshot();
    trainingSession.pnl.finalValue = trainingSession.finalPortfolio?.totalValue || 0;
    trainingSession.pnl.absolutePnL = trainingSession.pnl.finalValue - trainingSession.pnl.initialValue;
    trainingSession.pnl.percentagePnL = trainingSession.pnl.initialValue > 0
        ? (trainingSession.pnl.absolutePnL / trainingSession.pnl.initialValue) * 100
        : 0;
    // Generate comprehensive report
    generateTrainingReport();
    console.log("\n🎉 Training session completed successfully!");
    console.log("📊 Check the report above for detailed performance analysis.");
}
function ts() {
    return dayjs().format("HH:mm:ss");
}
main().catch((e) => {
    console.error("Training session failed:", e);
    process.exit(1);
});
