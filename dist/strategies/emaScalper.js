import { ema, stdev } from "../lib/math.js";
export class EMAScalper {
    constructor(cfg) {
        this.cfg = cfg;
        this.fast = null;
        this.slow = null;
        this.lastPrice = null;
        this.returns = []; // log-returns cho turbulence
        this.maxReturns = 240; // ~4h với poll 1p
    }
    // cập nhật giá mỗi phút
    updatePrice(p) {
        this.fast = ema(this.fast, p, this.cfg.emaFast);
        this.slow = ema(this.slow, p, this.cfg.emaSlow);
        if (this.lastPrice != null) {
            const r = Math.log(p / this.lastPrice);
            this.returns.push(r);
            if (this.returns.length > this.maxReturns)
                this.returns.shift();
        }
        this.lastPrice = p;
    }
    // pos target: 0..1 (tỷ trọng WETH) - Tối ưu cho contest 2000+ volume
    targetPosition() {
        if (this.fast == null || this.slow == null)
            return 0; // chờ đủ EMA
        const trendBull = this.fast > this.slow;
        const trendStrength = Math.abs(this.fast - this.slow) / this.slow;
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
        const vol = stdev(this.returns);
        if (vol > this.cfg.turbulenceStd) {
            const volAdjustment = Math.min(vol / this.cfg.turbulenceStd, 2.5);
            pos = Math.min(pos, this.cfg.maxPosHighVol / volAdjustment);
        }
        return pos;
    }
    // tạo kế hoạch rebalance theo drift & min lot - Contest 2000+ volume optimized
    makePlan(params) {
        const { navUsd, wethPrice, posNow, posTgt } = params;
        const drift = posTgt - posNow;
        const moveUsd = Math.abs(drift) * navUsd;
        // Contest mode: lower threshold for more trading - 2000+ volume target
        const effectiveThreshold = this.cfg.aggressiveMode ?
            this.cfg.driftThreshold * 0.6 : this.cfg.driftThreshold; // Even lower for volume
        if (Math.abs(drift) < effectiveThreshold) {
            // Volume boost mode: force trades even with small drifts
            if (this.cfg.volumeBoostMode && Math.abs(drift) > effectiveThreshold * 0.3) {
                const forcedQty = this.cfg.minLotUsd / wethPrice;
                if (drift > 0) {
                    return { shouldTrade: true, legs: [{ from: "USDC", to: "WETH", qty: forcedQty }] };
                }
                else {
                    return { shouldTrade: true, legs: [{ from: "WETH", to: "USDC", qty: forcedQty }] };
                }
            }
            return { shouldTrade: false, legs: [] };
        }
        // Ensure minimum lot size for contest 2000+ volume
        if (moveUsd < this.cfg.minLotUsd) {
            // Contest mode: force minimum trade size for volume target
            if (this.cfg.aggressiveMode && Math.abs(drift) > effectiveThreshold * 0.4) {
                const forcedQty = this.cfg.minLotUsd / wethPrice;
                if (drift > 0) {
                    return { shouldTrade: true, legs: [{ from: "USDC", to: "WETH", qty: forcedQty }] };
                }
                else {
                    return { shouldTrade: true, legs: [{ from: "WETH", to: "USDC", qty: forcedQty }] };
                }
            }
            return { shouldTrade: false, legs: [] };
        }
        const qty = moveUsd / wethPrice;
        if (drift > 0) {
            // cần MUA WETH từ USDC
            return { shouldTrade: true, legs: [{ from: "USDC", to: "WETH", qty }] };
        }
        else {
            // cần BÁN WETH sang USDC
            return { shouldTrade: true, legs: [{ from: "WETH", to: "USDC", qty }] };
        }
    }
    // Getter methods for external access
    getFastEMA() { return this.fast; }
    getSlowEMA() { return this.slow; }
    getCurrentPrice() { return this.lastPrice; }
    getVolatility() { return stdev(this.returns); }
    // Contest mode getter
    isAggressiveMode() { return this.cfg.aggressiveMode || false; }
    // Volume boost mode getter
    isVolumeBoostMode() { return this.cfg.volumeBoostMode || false; }
}
