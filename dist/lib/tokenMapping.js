// Token mapping for Recall API
// Maps contract addresses to readable symbol names
export const TOKEN_MAPPING = {
    // Wrapped Ether
    '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2': 'WETH',
    
    // Wrapped Bitcoin
    '0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599': 'WBTC',
    
    // Solana (Wrapped)
    '0x95aD61b0a150d79219dCF64E1E6Cc01f0B64C4cE': 'WSOL',
    
    // Polygon (Wrapped)
    '0x7D1AfA7B718fb893dB30A3aBc0Cfc608aCafEBB0': 'WMATIC',
    
    // Avalanche (Wrapped)
    '0x85f138bfEE4eF8e5408903bF6F9a7aA1B3b4e8f5': 'WAVAX',
    
    // Uniswap
    '0x1f9840a85d5aF5bf1D1762F925BDADdC4201F984': 'UNI',
    
    // Aave
    '0x7Fc66500c84A76Ad7e9c93437bFc5Ac33E2DDaE9': 'AAVE',
    
    // Chainlink
    '0x514910771AF9Ca656af840dff83E8264EcF986CA': 'LINK',
    
    // USD Coin
    '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48': 'USDC',
    
    // Tether USD
    '0xdAC17F958D2ee523a2206206994597C13D831ec7': 'USDT',
    
    // Dai
    '0x6B175474E89094C44Da98b954EedeAC495271d0F': 'DAI'
};

// Reverse mapping (symbol to contract address)
export const REVERSE_TOKEN_MAPPING = Object.fromEntries(
    Object.entries(TOKEN_MAPPING).map(([address, symbol]) => [symbol, address])
);

// Get symbol from contract address or symbol name
export function getTokenSymbol(token) {
    // If it's a contract address (starts with 0x)
    if (token.startsWith('0x')) {
        return TOKEN_MAPPING[token] || token.substring(0, 8) + '...';
    }
    // If it's a symbol name, return it as is
    return SYMBOL_MAPPING[token.toUpperCase()] || token;
}

// Get contract address from symbol
export function getContractAddress(symbol) {
    return REVERSE_TOKEN_MAPPING[symbol] || symbol;
}

// Check if a token is available
export function isTokenAvailable(contractAddress) {
    return TOKEN_MAPPING.hasOwnProperty(contractAddress);
}

// Get all available token symbols
export function getAvailableTokenSymbols() {
    return Object.values(TOKEN_MAPPING);
}

// Get all available contract addresses
export function getAvailableContractAddresses() {
    return Object.keys(TOKEN_MAPPING);
}

// Symbol mapping for when we're using symbol names directly
export const SYMBOL_MAPPING = {
    'ETH': 'ETH',
    'WETH': 'WETH',
    'WBTC': 'WBTC',
    'SOL': 'SOL',
    'ARB': 'ARB',
    'OP': 'OP',
    'MATIC': 'MATIC',
    'USDC': 'USDC',
    'USDT': 'USDT',
    'DAI': 'DAI',
    'UNI': 'UNI',
    'AAVE': 'AAVE',
    'LINK': 'LINK',
    'CRV': 'CRV',
    'COMP': 'COMP',
    'SUSHI': 'SUSHI'
};
