import axios from "axios";
import { getInstruments } from "./instruments.js";
let API_URL = "https://api.sandbox.competitions.recall.network";
let HEADERS = {
    Authorization: "",
    "Content-Type": "application/json",
};
export function configureRecall(apiKey, apiUrl) {
    HEADERS.Authorization = `Bearer ${apiKey}`;
    if (apiUrl)
        API_URL = apiUrl;
}
export const recall = {
    async price(token, chain = "evm", specificChain = "eth") {
        try {
            const { data } = await axios.get(`${API_URL}/api/price`, {
                headers: HEADERS,
                params: { token, chain, specificChain },
                timeout: 10000,
            });
            return data.price;
        } catch (error) {
            console.log(`[RECALL API] Price request failed for ${token} on ${chain}/${specificChain}: ${error?.message || error}`);
            if (error.response) {
                console.log(`[RECALL API] Status: ${error.response.status}, Data: ${JSON.stringify(error.response.data)}`);
            }
            return null; // Return null instead of throwing
        }
    },
    async portfolio() {
        try {
            const { data } = await axios.get(`${API_URL}/api/agent/portfolio`, {
                headers: HEADERS,
                timeout: 10000,
            });
            return data;
        }
        catch (err) {
            // Fallback for environments where /api/agent/portfolio is not available.
            // Use /api/agent/balances and compute total value via price quotes.
            if (err?.response?.status === 404) {
                const { data } = await axios.get(`${API_URL}/api/agent/balances`, {
                    headers: HEADERS,
                    timeout: 10000,
                });
                const balances = data.balances || [];
                let totalValue = 0;
                const tokens = [];
                // Compute token values using current prices
                for (const b of balances) {
                    try {
                        // Get normalized instruments for proper chain/symbol mapping
                        const CHAINS = ["eth", "base", "arbitrum", "optimism", "polygon", "solana"];
                        const TRADE_TOKENS = [b.symbol || "UNKNOWN"];
                        const INSTRUMENTS = getInstruments({ CHAINS, TRADE_TOKENS });
                        const instrument = INSTRUMENTS[0];
                        
                        let px;
                        if (instrument) {
                            // Use address if available, otherwise use symbol
                            const tokenToQuery = instrument.address || instrument.symbol;
                            px = await recall.price(tokenToQuery, instrument.chain, instrument.chain === "solana" ? "mainnet" : instrument.chain);
                        } else {
                            // Fallback to original method
                            px = await recall.price(b.tokenAddress, b.chain || "evm", b.specificChain || "eth");
                        }
                        
                        const value = (b.amount || 0) * (px || 0);
                        totalValue += value;
                        tokens.push({
                            token: b.tokenAddress,
                            amount: b.amount,
                            price: px,
                            value,
                            chain: b.chain,
                            symbol: b.symbol,
                        });
                    }
                    catch {
                        // If price fails, still include the balance without value to avoid crashing callers
                        tokens.push({
                            token: b.tokenAddress,
                            amount: b.amount,
                            chain: b.chain,
                            symbol: b.symbol,
                        });
                    }
                }
                return {
                    success: true,
                    agentId: data.agentId,
                    totalValue,
                    tokens,
                    snapshotTime: new Date().toISOString(),
                };
            }
            throw err;
        }
    },
    async trades() {
        const { data } = await axios.get(`${API_URL}/api/agent/trades`, {
            headers: HEADERS,
            timeout: 10000,
        });
        return data;
    },
    async tradeExecute(params) {
        const { data } = await axios.post(`${API_URL}/api/trade/execute`, params, {
            headers: HEADERS,
            timeout: 30000,
        });
        return data;
    },
};
