const env = process.env;

function parsePairs(csv) {
  return (csv || "")
    .split(",")
    .map(s => s.trim())
    .filter(Boolean)
    .map(p => {
      const [chain, sym] = p.split(":").map(x => x.trim());
      return { chain: (chain || "").toLowerCase(), symbol: (sym || "").toUpperCase() };
    });
}

// Chain alias normalization for adapters
export function normalizeChain(chain) {
  const c = (chain || "").toLowerCase();
  if (c === "svm") return "solana";
  if (c === "eth" || c === "ethereum" || c === "mainnet") return "eth";
  if (c === "matic") return "polygon";
  return c; // base, arbitrum, optimism, polygon, avalanche, linea...
}

// Symbol normalization per chain
export function normalizeSymbol(symbol, chain) {
  const c = normalizeChain(chain);
  const s = (symbol || "").toUpperCase();

  // EVM conventions
  if (c === "polygon" && (s === "MATIC")) return "WMATIC";
  if ((c === "eth" || c === "base" || c === "optimism" || c === "arbitrum") && s === "ETH") return "WETH";

  // Leave SOL on Solana
  return s;
}

// Optional: addresses to fix providers that need contract addresses
export const TOKEN_ADDR = {
  eth: {
    WETH:  "0xC02aaa39b223FE8D0A0e5C4F27eAD9083C756Cc2",
    WBTC:  "0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599",
    USDC:  "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
    UNI:   "0x1f9840a85d5aF5bf1D1762F925BDADdC4201F984",
    AAVE:  "0x7Fc66500c84A76Ad7e9c93437bFc5Ac33E2DDaE9",
    LINK:  "0x514910771AF9Ca656af840dff83E8264EcF986CA",
    DOT:   "0x9C2C5fd7b07E95EE044DDdba0c4Cfa3654cA4C5b", // Polkadot (Wrapped)
    ATOM:  "0x8D983cb9388EaC77afFe4E8B695B5d6E0b3280d0"  // Cosmos (Wrapped)
  },
  base: {
    WETH:  "0x4200000000000000000000000000000000000006"
  },
  arbitrum: {
    ARB:   "0x912CE59144191C1204E64559FE8253a0e49E6548",
    WETH:  "0x82aF49447D8a07e3bd95BD0d56f35241523fBab1"
  },
  optimism: {
    OP:    "0x4200000000000000000000000000000000000042",
    WETH:  "0x4200000000000000000000000000000000000006"
  },
  polygon: {
    WMATIC:"0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270",
    MATIC: "0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270"
  },
  avalanche: {
    AVAX:  "0xB31f66AA3C1e785363F0875A1B74E27b85FD66c7"
  },
  solana: {
    SOL:   "So11111111111111111111111111111111111111112", // Native SOL
    WSOL:  "So11111111111111111111111111111111111111112"  // Wrapped SOL (same as native on Solana)
  }
};

// Build the final list of instruments to use across the app
export function getInstruments({ CHAINS = [], TRADE_TOKENS = [] } = {}) {
  const fromEnv = parsePairs(env.TRADE_PAIRS);
  if (fromEnv.length) {
    return fromEnv.map(({ chain, symbol }) => {
      const c = normalizeChain(chain);
      const s = normalizeSymbol(symbol, c);
      const addr = TOKEN_ADDR[c]?.[s];
      return { chain: c, symbol: s, address: addr };
    });
  }
  // fallback: cartesian (not recommended) but normalized
  const list = [];
  for (const rawC of CHAINS) {
    for (const rawS of TRADE_TOKENS) {
      const c = normalizeChain(rawC);
      const s = normalizeSymbol(rawS, c);
      const addr = TOKEN_ADDR[c]?.[s];
      
      // Special handling for SOL on Solana
      if (c === "solana" && s === "SOL") {
        list.push({ chain: c, symbol: s, address: addr });
        console.log(`✅ Added SOL on Solana with address: ${addr}`);
        continue;
      }
      
      // Only add instruments that have valid addresses
      if (addr) {
        list.push({ chain: c, symbol: s, address: addr });
        console.log(`✅ Added ${s} on ${c} with address: ${addr}`);
      } else {
        console.warn(`⚠️ Skipping ${s} on ${c} - no address configured`);
      }
    }
  }
  return list;
}
