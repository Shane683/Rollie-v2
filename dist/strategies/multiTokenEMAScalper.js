import { ema, stdev, adx } from "../lib/math.js";
import fs from "fs";
import path from "path";

export class MultiTokenEMAScalper {
    constructor(cfg) {
        this.cfg = cfg;
        this.tokenStates = new Map();
        this.maxReturns = 240; // ~4h với poll 1p
        this.tokenConfigs = this.loadTokenConfigs();
        this.lastTradeAt = new Map(); // Per-symbol cooldown tracking
    }

    // Load per-symbol configuration with fallback to global defaults
    loadTokenConfigs() {
        try {
            const configPath = path.join(process.cwd(), 'config', 'tokens.json');
            if (fs.existsSync(configPath)) {
                const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
                console.log(`📁 Loaded per-symbol config for ${Object.keys(config).length} tokens`);
                return config;
            }
        } catch (error) {
            console.warn(`⚠️ Failed to load token configs: ${error.message}, using global defaults`);
        }
        return {};
    }

    // Get per-symbol config with fallback to global defaults
    getTokenConfig(symbol) {
        const symbolConfig = this.tokenConfigs[symbol] || {};
        return {
            emaFast: symbolConfig.emaFast ?? this.cfg.emaFast,
            emaSlow: symbolConfig.emaSlow ?? this.cfg.emaSlow,
            driftThreshold: symbolConfig.driftThreshold ?? this.cfg.driftThreshold,
            minLotUsd: symbolConfig.minLotUsd ?? this.cfg.minLotUsd,
            turbulenceStd: symbolConfig.turbulenceStd ?? this.cfg.turbulenceStd,
            maxPosHighVol: symbolConfig.maxPosHighVol ?? this.cfg.maxPosHighVol,
            cooldownSec: symbolConfig.cooldownSec ?? this.cfg.tradeCooldownSec,
            stopLossPct: symbolConfig.stopLossPct ?? 0.05,
            takeProfitPct: symbolConfig.takeProfitPct ?? 0.10,
            trailingStopPct: symbolConfig.trailingStopPct ?? 0.03
        };
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
        const tokenConfig = this.getTokenConfig(symbol);
        
        state.fast = ema(state.fast, price, tokenConfig.emaFast);
        state.slow = ema(price, price, tokenConfig.emaSlow);
        
        if (state.lastPrice != null) {
            const r = Math.log(price / state.lastPrice);
            state.returns.push(r);
            if (state.returns.length > state.maxReturns)
                state.returns.shift();
            
            // Calculate ADX for regime detection
            if (state.returns.length >= 30) {
                state.adx = adx(state.returns, 30);
            }
        }
        state.lastPrice = price;
    }
    // pos target: 0..1 (tỷ trọng token) cho một token cụ thể - Contest 2000+ volume optimized
    targetPosition(symbol) {
        const state = this.tokenStates.get(symbol);
        if (!state || state.fast == null || state.slow == null)
            return 0; // chờ đủ EMA
        
        const tokenConfig = this.getTokenConfig(symbol);
        const trendBull = state.fast > state.slow;
        const trendStrength = Math.abs(state.fast - state.slow) / state.slow;
        
        // B. Regime filter - disable trading in choppy markets
        if (state.adx && state.adx < 20) {
            console.log(`[${symbol}] Regime filter: ADX=${state.adx.toFixed(2)} < 20 (choppy), skipping`);
            return 0;
        }
        
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
        
        // C. Volatility-scaled sizing with per-symbol config
        const vol = stdev(state.returns);
        if (vol > tokenConfig.turbulenceStd) {
            const volAdjustment = Math.min(vol / tokenConfig.turbulenceStd, 2.5);
            pos = Math.min(pos, tokenConfig.maxPosHighVol / volAdjustment);
        }
        
        return pos;
    }
    // tạo kế hoạch rebalance cho một token - Contest 2000+ volume optimized
    makePlan(params) {
        const { symbol, navUsd, tokenPrice, posNow, posTgt, baseSymbol } = params;
        const tokenConfig = this.getTokenConfig(symbol);
        const drift = posTgt - posNow;
        const moveUsd = Math.abs(drift) * navUsd;
        
        // Contest mode: lower threshold for more trading - 2000+ volume target
        const effectiveThreshold = this.cfg.aggressiveMode ?
            tokenConfig.driftThreshold * 0.6 : tokenConfig.driftThreshold; // Even lower for volume
        
        if (Math.abs(drift) < effectiveThreshold) {
            // Volume boost mode: force trades even with small drifts
            if (this.cfg.volumeBoostMode && Math.abs(drift) > effectiveThreshold * 0.3) {
                const forcedQty = tokenConfig.minLotUsd / tokenPrice;
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
        if (moveUsd < tokenConfig.minLotUsd) {
            // Contest mode: force minimum trade size for volume target
            if (this.cfg.aggressiveMode && Math.abs(drift) > effectiveThreshold * 0.4) {
                const forcedQty = tokenConfig.minLotUsd / tokenPrice;
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
    
    // F. Per-symbol cooldown check
    isInCooldown(symbol) {
        const lastTrade = this.lastTradeAt.get(symbol);
        if (!lastTrade) return false;
        
        const tokenConfig = this.getTokenConfig(symbol);
        const cooldownMs = tokenConfig.cooldownSec * 1000;
        return (Date.now() - lastTrade) < cooldownMs;
    }
    
    // Update last trade time for a symbol
    updateLastTradeTime(symbol) {
        this.lastTradeAt.set(symbol, Date.now());
    }
    
    // E. Protective exits - check stop loss and take profit
    checkProtectiveExits(symbol, currentPrice) {
        const state = this.tokenStates.get(symbol);
        if (!state || !state.entryPrice) return null;
        
        const tokenConfig = this.getTokenConfig(symbol);
        const priceChange = (currentPrice - state.entryPrice) / state.entryPrice;
        
        // Check stop loss
        if (priceChange <= -tokenConfig.stopLossPct) {
            return {
                type: 'stopLoss',
                reason: `Stop loss triggered at ${(-priceChange * 100).toFixed(2)}%`,
                action: 'SELL'
            };
        }
        
        // Check take profit
        if (priceChange >= tokenConfig.takeProfitPct) {
            return {
                type: 'takeProfit',
                reason: `Take profit triggered at ${(priceChange * 100).toFixed(2)}%`,
                action: 'SELL'
            };
        }
        
        // Check trailing stop
        if (state.highestPrice && currentPrice < state.highestPrice * (1 - tokenConfig.trailingStopPct)) {
            return {
                type: 'trailingStop',
                reason: `Trailing stop triggered at ${((currentPrice - state.highestPrice) / state.highestPrice * 100).toFixed(2)}%`,
                action: 'SELL'
            };
        }
        
        // Update highest price for trailing stop
        if (!state.highestPrice || currentPrice > state.highestPrice) {
            state.highestPrice = currentPrice;
        }
        
        return null;
    }
    
    // Set entry price when buying
    setEntryPrice(symbol, price) {
        const state = this.ensureTokenState(symbol);
        state.entryPrice = price;
        state.highestPrice = price;
    }
    
    // Contest mode getter
    isAggressiveMode() { return this.cfg.aggressiveMode || false; }
    // Volume boost mode getter
    isVolumeBoostMode() { return this.cfg.volumeBoostMode || false; }
}
