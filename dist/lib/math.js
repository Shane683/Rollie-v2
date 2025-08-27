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
