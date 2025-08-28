export function ema(prevEma, price, length) {
    const k = 2 / (length + 1);
    return prevEma === null ? price : (price - prevEma) * k + prevEma;
}
export function stdev(values) {
    if (values.length < 2)
        return 0;
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    const variance = values.reduce((acc, v) => acc + (v - mean) ** 2, 0) / (values.length - 1);
    return Math.sqrt(variance);
}
export function sleep(ms) {
    return new Promise((res) => setTimeout(res, ms));
}

// Calculate ADX (Average Directional Index) for regime detection
export function adx(returns, period = 30) {
    if (returns.length < period) return null;
    
    const recentReturns = returns.slice(-period);
    let plusDM = 0;
    let minusDM = 0;
    let trueRange = 0;
    
    for (let i = 1; i < recentReturns.length; i++) {
        const prevReturn = Math.exp(recentReturns[i - 1]);
        const currReturn = Math.exp(recentReturns[i]);
        
        if (currReturn > prevReturn) {
            plusDM += currReturn - prevReturn;
        } else if (currReturn < prevReturn) {
            minusDM += prevReturn - currReturn;
        }
        
        trueRange += Math.abs(currReturn);
    }
    
    const diPlus = (plusDM / trueRange) * 100;
    const diMinus = (minusDM / trueRange) * 100;
    const dx = Math.abs(diPlus - diMinus) / (diPlus + diMinus) * 100;
    
    return dx;
}

// Calculate RSI (Relative Strength Index)
export function rsi(prices, period = 14) {
    if (prices.length < period + 1) return null;
    
    let gains = 0;
    let losses = 0;
    
    // Calculate initial gains and losses
    for (let i = 1; i <= period; i++) {
        const change = prices[i] - prices[i - 1];
        if (change > 0) {
            gains += change;
        } else {
            losses += Math.abs(change);
        }
    }
    
    let avgGain = gains / period;
    let avgLoss = losses / period;
    
    // Calculate RSI
    const rs = avgGain / avgLoss;
    const rsi = 100 - (100 / (1 + rs));
    
    return rsi;
}

// Calculate Bollinger Bands
export function bollingerBands(prices, period = 20, stdDev = 2) {
    if (prices.length < period) return null;
    
    const recentPrices = prices.slice(-period);
    const sma = recentPrices.reduce((a, b) => a + b, 0) / period;
    const std = stdev(recentPrices);
    
    return {
        upper: sma + (stdDev * std),
        middle: sma,
        lower: sma - (stdDev * std),
        std: std
    };
}

// Calculate MACD (Moving Average Convergence Divergence)
export function macd(prices, fastPeriod = 12, slowPeriod = 26, signalPeriod = 9) {
    if (prices.length < slowPeriod) return null;
    
    let fastEMA = null;
    let slowEMA = null;
    
    // Calculate fast and slow EMAs
    for (let i = 0; i < prices.length; i++) {
        fastEMA = ema(fastEMA, prices[i], fastPeriod);
        slowEMA = ema(slowEMA, prices[i], slowPeriod);
    }
    
    const macdLine = fastEMA - slowEMA;
    
    // Calculate signal line (EMA of MACD line)
    // For simplicity, we'll use the current MACD value
    // In a real implementation, you'd maintain a history of MACD values
    const signalLine = macdLine; // Simplified
    
    const histogram = macdLine - signalLine;
    
    return {
        macd: macdLine,
        signal: signalLine,
        histogram: histogram,
        previousHistogram: histogram // Simplified - in real implementation, track previous value
    };
}

// Calculate ATR (Average True Range)
export function atr(prices, period = 14) {
    if (prices.length < period + 1) return null;
    
    let trueRanges = [];
    
    for (let i = 1; i < prices.length; i++) {
        const high = prices[i];
        const low = prices[i];
        const prevClose = prices[i - 1];
        
        const tr1 = high - low;
        const tr2 = Math.abs(high - prevClose);
        const tr3 = Math.abs(low - prevClose);
        
        const trueRange = Math.max(tr1, tr2, tr3);
        trueRanges.push(trueRange);
    }
    
    // Calculate average of true ranges
    const atr = trueRanges.slice(-period).reduce((a, b) => a + b, 0) / period;
    
    return atr;
}
