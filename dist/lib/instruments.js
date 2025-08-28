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
    WBTC:  "0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599"
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
    WMATIC:"0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270"
  },
  solana: {
    SOL:   "So11111111111111111111111111111111111111112" // WSOL if needed
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
      list.push({ chain: c, symbol: s, address: addr });
    }
  }
  return list;
}
