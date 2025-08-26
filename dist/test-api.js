import "dotenv/config";
import { recall, configureRecall } from "./lib/recall.js";
async function testAPI() {
    console.log("🧪 Testing Recall API Connection...\n");
    try {
        // Configure the recall client
        const apiKey = process.env.RECALL_API_KEY || "3899c1633fc11947_32ccac99ebfb407e";
        const apiUrl = process.env.RECALL_API_URL || "https://api.sandbox.competitions.recall.network";
        console.log(`🔑 API Key: ${apiKey.substring(0, 10)}...`);
        console.log(`🌐 API URL: ${apiUrl}\n`);
        configureRecall(apiKey, apiUrl);
        // Test 1: Get WETH price
        console.log("📊 Testing price endpoint...");
        try {
            const wethPrice = await recall.price("0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2", "evm", "eth");
            console.log(`✅ WETH Price: $${wethPrice}`);
        }
        catch (error) {
            console.log(`❌ Price endpoint failed: ${error.message}`);
        }
        // Test 2: Get portfolio
        console.log("\n💼 Testing portfolio endpoint...");
        try {
            const portfolio = await recall.portfolio();
            console.log(`✅ Portfolio: $${portfolio.totalValue}`);
            console.log(`   Tokens: ${portfolio.tokens?.length || 0}`);
        }
        catch (error) {
            console.log(`❌ Portfolio endpoint failed: ${error.message}`);
            if (error.response?.status) {
                console.log(`   Status: ${error.response.status}`);
            }
        }
        // Test 3: Test trade endpoint (dry run)
        console.log("\n🔄 Testing trade endpoint...");
        try {
            const tradeResult = await recall.tradeExecute({
                fromToken: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", // USDC
                toToken: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2", // WETH
                amount: "0.001",
                reason: "API test"
            });
            console.log(`✅ Trade endpoint: ${JSON.stringify(tradeResult)}`);
        }
        catch (error) {
            console.log(`❌ Trade endpoint failed: ${error.message}`);
            if (error.response?.status) {
                console.log(`   Status: ${error.response.status}`);
            }
        }
    }
    catch (error) {
        console.error("💥 API test failed:", error.message);
    }
}
testAPI().catch(console.error);
