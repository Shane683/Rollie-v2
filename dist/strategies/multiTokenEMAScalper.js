import { ema, stdev } from "../lib/math.js";
export class MultiTokenEMAScalper {
    constructor(cfg) {
        this.cfg = cfg;
        this.tokenStates = new Map();
        this.maxReturns = 240; // ~4h với poll 1p
    }
    // Initialize token state if not exists
    ensureTokenState(symbol) {
        if (!this.tokenStates.has(symbol)) {
            this.tokenStates.set(symbol, {
                symbol,
                fast: null,
                slow: null,
                lastPrice: null,
                returns: [],
                maxReturns: this.maxReturns,
            });
        }
        return this.tokenStates.get(symbol);
    }
    // cập nhật giá mỗi phút cho một token
    updatePrice(symbol, price) {
        const state = this.ensureTokenState(symbol);
        state.fast = ema(state.fast, price, this.cfg.emaFast);
        state.slow = ema(price, price, this.cfg.emaSlow);
        if (state.lastPrice != null) {
            const r = Math.log(price / state.lastPrice);
            state.returns.push(r);
            if (state.returns.length > state.maxReturns)
                state.returns.shift();
        }
        state.lastPrice = price;
    }
    // pos target: 0..1 (tỷ trọng token) cho một token cụ thể - Contest 2000+ volume optimized
    targetPosition(symbol) {
        const state = this.tokenStates.get(symbol);
        if (!state || state.fast == null || state.slow == null)
            return 0; // chờ đủ EMA
        const trendBull = state.fast > state.slow;
        const trendStrength = Math.abs(state.fast - state.slow) / state.slow;
        // Contest mode: more aggressive position sizing for 2000+ volume
        let pos = trendBull ? 1 : 0;
        if (this.cfg.aggressiveMode) {
            // Adjust position based on trend strength - more aggressive for volume
            if (trendStrength > 0.015) { // Strong trend - reduced threshold
                pos = trendBull ? 1 : 0;
            }
            else if (trendStrength > 0.008) { // Medium trend - reduced threshold
                pos = trendBull ? 0.9 : 0.1;
            }
            else if (trendStrength > 0.004) { // Weak trend - more neutral but still active
                pos = trendBull ? 0.7 : 0.3;
            }
            else { // Very weak trend - still trade but smaller positions
                pos = trendBull ? 0.6 : 0.4;
            }
        }
        // Volume boost mode: even more aggressive for 2000+ target
        if (this.cfg.volumeBoostMode) {
            // Force minimum position changes to increase trading frequency
            if (Math.abs(pos - 0.5) < 0.1) {
                pos = trendBull ? 0.6 : 0.4; // Force some position change
            }
        }
        // turbulence guard - optimized for contest 2000+ volume
        const vol = stdev(state.returns);
        if (vol > this.cfg.turbulenceStd) {
            const volAdjustment = Math.min(vol / this.cfg.turbulenceStd, 2.5);
            pos = Math.min(pos, this.cfg.maxPosHighVol / volAdjustment);
        }
        return pos;
    }
    // tạo kế hoạch rebalance cho một token - Contest 2000+ volume optimized
    makePlan(params) {
        const { symbol, navUsd, tokenPrice, posNow, posTgt, baseSymbol } = params;
        const drift = posTgt - posNow;
        const moveUsd = Math.abs(drift) * navUsd;
        // Contest mode: lower threshold for more trading - 2000+ volume target
        const effectiveThreshold = this.cfg.aggressiveMode ?
            this.cfg.driftThreshold * 0.6 : this.cfg.driftThreshold; // Even lower for volume
        if (Math.abs(drift) < effectiveThreshold) {
            // Volume boost mode: force trades even with small drifts
            if (this.cfg.volumeBoostMode && Math.abs(drift) > effectiveThreshold * 0.3) {
                const forcedQty = this.cfg.minLotUsd / tokenPrice;
                if (drift > 0) {
                    return { shouldTrade: true, legs: [{ from: baseSymbol, to: symbol, qty: forcedQty }] };
                }
                else {
                    return { shouldTrade: true, legs: [{ from: symbol, to: baseSymbol, qty: forcedQty }] };
                }
            }
            return { shouldTrade: false, legs: [] };
        }
        // Ensure minimum lot size for contest 2000+ volume
        if (moveUsd < this.cfg.minLotUsd) {
            // Contest mode: force minimum trade size for volume target
            if (this.cfg.aggressiveMode && Math.abs(drift) > effectiveThreshold * 0.4) {
                const forcedQty = this.cfg.minLotUsd / tokenPrice;
                if (drift > 0) {
                    return { shouldTrade: true, legs: [{ from: baseSymbol, to: symbol, qty: forcedQty }] };
                }
                else {
                    return { shouldTrade: true, legs: [{ from: symbol, to: baseSymbol, qty: forcedQty }] };
                }
            }
            return { shouldTrade: false, legs: [] };
        }
        const qty = moveUsd / tokenPrice;
        if (drift > 0) {
            // cần MUA token từ base
            return { shouldTrade: true, legs: [{ from: baseSymbol, to: symbol, qty }] };
        }
        else {
            // cần BÁN token sang base
            return { shouldTrade: true, legs: [{ from: symbol, to: baseSymbol, qty }] };
        }
    }
    // Getter methods for external access
    getTokenState(symbol) {
        return this.tokenStates.get(symbol) || null;
    }
    getFastEMA(symbol) {
        const state = this.tokenStates.get(symbol);
        return state?.fast || null;
    }
    getSlowEMA(symbol) {
        const state = this.tokenStates.get(symbol);
        return state?.slow || null;
    }
    getCurrentPrice(symbol) {
        const state = this.tokenStates.get(symbol);
        return state?.lastPrice || null;
    }
    getVolatility(symbol) {
        const state = this.tokenStates.get(symbol);
        return state ? stdev(state.returns) : 0;
    }
    // Get all tracked symbols
    getTrackedSymbols() {
        return Array.from(this.tokenStates.keys());
    }
    // Contest mode getter
    isAggressiveMode() { return this.cfg.aggressiveMode || false; }
    // Volume boost mode getter
    isVolumeBoostMode() { return this.cfg.volumeBoostMode || false; }
}
