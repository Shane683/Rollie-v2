import { recall } from "./recall.js";
import { getInstruments } from "./instruments.js";
export class PortfolioCalculator {
    constructor() {
        this.balances = new Map();
        this.lastTradeId = null;
        // Initialize with common tokens
        this.initializeBalances();
    }
    initializeBalances() {
        const commonTokens = [
            { token: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", symbol: "USDC", chain: "evm", specificChain: "eth" },
            { token: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2", symbol: "WETH", chain: "evm", specificChain: "eth" },
            { token: "0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599", symbol: "WBTC", chain: "evm", specificChain: "eth" },
            { token: "So11111111111111111111111111111111111111112", symbol: "SOL", chain: "solana", specificChain: "mainnet" },
        ];
        commonTokens.forEach(({ token, symbol, chain, specificChain }) => {
            this.balances.set(token, {
                token,
                symbol,
                amount: 0,
                price: 0,
                valueUsd: 0,
                chain,
                specificChain,
            });
        });
    }
    async updateFromTrades() {
        try {
            // Get recent trades
            const tradesResponse = await recall.trades();
            const trades = tradesResponse.trades || [];
            // Process trades to calculate current balances
            for (const trade of trades) {
                const isSuccessful = trade.status === "completed" ||
                    ("success" in trade && trade.success === true);
                if (!isSuccessful)
                    continue;
                this.processTrade(trade);
            }
            // Update prices and calculate values
            await this.updatePrices();
            // Calculate total value
            const totalValue = Array.from(this.balances.values())
                .reduce((sum, balance) => sum + balance.valueUsd, 0);
            return {
                totalValue,
                balances: Array.from(this.balances.values()),
                lastUpdated: new Date().toISOString(),
            };
        }
        catch (error) {
            console.error("Error updating portfolio from trades:", error);
            throw error;
        }
    }
    processTrade(trade) {
        const { fromToken, toToken, fromAmount, toAmount } = trade;
        // Guard: some environments return only aggregate amount; skip if leg amounts are missing
        if (fromToken == null || toToken == null || fromAmount == null || toAmount == null) {
            return;
        }
        // Deduct from source token
        if (this.balances.has(fromToken)) {
            const balance = this.balances.get(fromToken);
            balance.amount -= Number(fromAmount);
        }
        else {
            // Add new token if not exists
            this.balances.set(fromToken, {
                token: fromToken,
                symbol: trade.fromTokenSymbol || "UNKNOWN",
                amount: -Number(fromAmount),
                price: 0,
                valueUsd: 0,
                chain: trade.fromChain || "evm",
                specificChain: trade.fromSpecificChain || "eth",
            });
        }
        // Add to destination token
        if (this.balances.has(toToken)) {
            const balance = this.balances.get(toToken);
            balance.amount += Number(toAmount);
        }
        else {
            // Add new token if not exists
            this.balances.set(toToken, {
                token: toToken,
                symbol: trade.toTokenSymbol || "UNKNOWN",
                amount: Number(toAmount),
                price: 0,
                valueUsd: 0,
                chain: trade.toChain || "evm",
                specificChain: trade.toSpecificChain || "eth",
            });
        }
    }
    async updatePrices() {
        const pricePromises = Array.from(this.balances.values()).map(async (balance) => {
            try {
                if (balance.symbol === "USDC") {
                    balance.price = 1; // USDC is always $1
                }
                else {
                    // Get normalized instruments for proper chain/symbol mapping
                    const CHAINS = ["eth", "base", "arbitrum", "optimism", "polygon", "solana"];
                    const TRADE_TOKENS = [balance.symbol];
                    const INSTRUMENTS = getInstruments({ CHAINS, TRADE_TOKENS });
                    const instrument = INSTRUMENTS[0];
                    
                    if (instrument) {
                        // Use address if available, otherwise use symbol
                        const tokenToQuery = instrument.address || instrument.symbol;
                        balance.price = await recall.price(tokenToQuery, instrument.chain, instrument.chain === "solana" ? "mainnet" : instrument.chain);
                    } else {
                        // Fallback to original method
                        balance.price = await recall.price(balance.token, balance.chain, balance.specificChain);
                    }
                }
                balance.valueUsd = balance.amount * balance.price;
            }
            catch (error) {
                console.warn(`Failed to get price for ${balance.symbol}:`, error);
                balance.price = 0;
                balance.valueUsd = 0;
            }
        });
        await Promise.all(pricePromises);
    }
    getBalance(symbol) {
        const balance = Array.from(this.balances.values()).find(b => b.symbol === symbol);
        return balance || null;
    }
    getUsdcBalance() {
        const usdcBalance = this.getBalance("USDC");
        return usdcBalance ? usdcBalance.amount : 0;
    }
    getWethBalance() {
        const wethBalance = this.getBalance("WETH");
        return wethBalance ? wethBalance.amount : 0;
    }
    getWbtcBalance() {
        const wbtcBalance = this.getBalance("WBTC");
        return wbtcBalance ? wbtcBalance.amount : 0;
    }
    getSolBalance() {
        const solBalance = this.getBalance("SOL");
        return solBalance ? solBalance.amount : 0;
    }
}
