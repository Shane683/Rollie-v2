// Token chain mapping for Recall API
// Maps symbol names to their correct chain and specificChain parameters
export const TOKEN_CHAIN_MAPPING = {
    // Ethereum tokens
    'ETH': { chain: 'evm', specificChain: 'eth' },
    'WETH': { chain: 'evm', specificChain: 'eth' },
    'WBTC': { chain: 'evm', specificChain: 'eth' },
    'USDC': { chain: 'evm', specificChain: 'eth' },
    'USDT': { chain: 'evm', specificChain: 'eth' },
    'DAI': { chain: 'evm', specificChain: 'eth' },
    'UNI': { chain: 'evm', specificChain: 'eth' },
    'AAVE': { chain: 'evm', specificChain: 'eth' },
    'LINK': { chain: 'evm', specificChain: 'eth' },
    'CRV': { chain: 'evm', specificChain: 'eth' },
    'COMP': { chain: 'evm', specificChain: 'eth' },
    'SUSHI': { chain: 'evm', specificChain: 'eth' },
    
    // Base tokens
    'ARB': { chain: 'evm', specificChain: 'base' },
    
    // Arbitrum tokens
    'OP': { chain: 'evm', specificChain: 'arbitrum' },
    
    // Polygon tokens
    'MATIC': { chain: 'evm', specificChain: 'polygon' },
    
    // Solana tokens
    'SOL': { chain: 'solana', specificChain: 'mainnet' },
    
    // Default fallback
    'DEFAULT': { chain: 'evm', specificChain: 'eth' }
};

export function getTokenChainParams(symbol) {
    const upperSymbol = symbol.toUpperCase();
    return TOKEN_CHAIN_MAPPING[upperSymbol] || TOKEN_CHAIN_MAPPING['DEFAULT'];
}

export function getTokenChain(symbol) {
    return getTokenChainParams(symbol).chain;
}

export function getTokenSpecificChain(symbol) {
    return getTokenChainParams(symbol).specificChain;
}
