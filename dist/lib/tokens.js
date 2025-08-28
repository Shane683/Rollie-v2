export const TOKEN_CONFIGS = {
    WETH: {
        symbol: "WETH",
        address: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2",
        chain: "evm",
        specificChain: "eth",
        decimals: 18,
    },
    WBTC: {
        symbol: "WBTC",
        address: "0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599",
        chain: "evm",
        specificChain: "eth",
        decimals: 8,
    },
    SOL: {
        symbol: "SOL",
        address: "So11111111111111111111111111111111111111112",
        chain: "solana",
        specificChain: "mainnet",
        decimals: 9,
    },
    XRP: {
        symbol: "XRP",
        address: "r9cZA1lkHfzCxqTbNQk7qHwM9qHwM9qHwM9",
        chain: "xrp",
        specificChain: "mainnet",
        decimals: 6,
    },
    SUI: {
        symbol: "SUI",
        address: "0x2::sui::SUI",
        chain: "sui",
        specificChain: "mainnet",
        decimals: 9,
    },
    USDC: {
        symbol: "USDC",
        address: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
        chain: "evm",
        specificChain: "eth",
        decimals: 6,
    },
};
export function getTokenConfig(symbol) {
    return TOKEN_CONFIGS[symbol.toUpperCase()] || null;
}
export function parseTokensFromEnv(tokensEnv) {
    return tokensEnv.split(',').map(t => {
        const trimmed = t.trim();
        // If it's a contract address (starts with 0x), don't convert to uppercase
        if (trimmed.startsWith('0x')) {
            return trimmed;
        }
        // If it's a symbol, convert to uppercase
        return trimmed.toUpperCase();
    }).filter(Boolean);
}
export function getBaseTokenFromEnv(baseEnv) {
    const trimmed = baseEnv.trim();
    // If it's a contract address (starts with 0x), don't convert to uppercase
    if (trimmed.startsWith('0x')) {
        return trimmed;
    }
    // If it's a symbol, convert to uppercase
    return trimmed.toUpperCase();
}
