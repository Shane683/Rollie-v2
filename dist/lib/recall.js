import axios from "axios";
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
        const { data } = await axios.get(`${API_URL}/api/price`, {
            headers: HEADERS,
            params: { token, chain, specificChain },
            timeout: 10000,
        });
        return data.price;
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
                        const px = await recall.price(b.tokenAddress, b.chain || "evm", b.specificChain || "eth");
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
