import { ema, stdev, adx, rsi, bollingerBands, macd, atr } from "../lib/math.js";

export class EnhancedSignalGenerator {
    constructor() {
        this.marketRegimes = {
            TRENDING: 'trending',
            WEAK_TREND: 'weak_trend',
            SIDEWAYS: 'sideways',
            CHOPPY: 'choppy',
            VOLATILE: 'volatile'
        };
        
        this.signalTypes = {
            BUY: 'buy',
            SELL: 'sell',
            WAIT: 'wait',
            STRONG_BUY: 'strong_buy',
            STRONG_SELL: 'strong_sell'
        };
    }

    // Enhanced market regime detection with volatility consideration
    detectMarketRegime(adx, atr, price, avgPrice) {
        if (!adx || !atr) return this.marketRegimes.CHOPPY;
        
        const volatility = atr / price;
        const priceDeviation = Math.abs(price - avgPrice) / avgPrice;
        
        // High volatility with low ADX = choppy volatile market
        if (volatility > 0.05 && adx < 20) {
            return this.marketRegimes.VOLATILE;
        }
        
        // Very high ADX = strong trending market
        if (adx > 45) {
            return this.marketRegimes.TRENDING;
        }
        
        // High ADX = trending market
        if (adx > 30) {
            return this.marketRegimes.TRENDING;
        }
        
        // Medium ADX = weak trend
        if (adx > 20) {
            return this.marketRegimes.WEAK_TREND;
        }
        
        // Low ADX = sideways market
        if (adx > 15) {
            return this.marketRegimes.SIDEWAYS;
        }
        
        // Very low ADX = choppy market
        return this.marketRegimes.CHOPPY;
    }

    // Dynamic signal weights based on market regime
    getSignalWeights(regime) {
        const weights = {
            [this.marketRegimes.TRENDING]: {
                trend: 3.0,      // Strong trend signals
                momentum: 2.0,    // MACD confirmation
                meanReversion: 1.0, // RSI/Bollinger
                volume: 1.5,      // Volume confirmation
                volatility: 1.0   // ATR consideration
            },
            [this.marketRegimes.WEAK_TREND]: {
                trend: 2.0,
                momentum: 2.5,    // Higher momentum weight
                meanReversion: 1.5,
                volume: 2.0,      // Volume more important
                volatility: 1.5
            },
            [this.marketRegimes.SIDEWAYS]: {
                trend: 1.0,       // Lower trend weight
                momentum: 1.5,
                meanReversion: 3.0, // Mean reversion primary
                volume: 2.5,      // Volume crucial
                volatility: 2.0
            },
            [this.marketRegimes.CHOPPY]: {
                trend: 0.5,       // Minimal trend signals
                momentum: 1.0,
                meanReversion: 2.0,
                volume: 3.0,      // Volume most important
                volatility: 2.5
            },
            [this.marketRegimes.VOLATILE]: {
                trend: 0.0,       // No trend signals
                momentum: 0.5,
                meanReversion: 1.5,
                volume: 3.0,      // Volume critical
                volatility: 3.0   // Volatility primary
            }
        };
        
        return weights[regime] || weights[this.marketRegimes.CHOPPY];
    }

    // Enhanced trend analysis with strength measurement
    analyzeTrend(emaFast, emaSlow, emaTrend, price) {
        const trendBull = emaFast > emaSlow && emaSlow > emaTrend;
        const trendBear = emaFast < emaSlow && emaSlow < emaTrend;
        
        // Calculate trend strength (0-1)
        const fastSlowDiff = Math.abs(emaFast - emaSlow) / emaSlow;
        const slowTrendDiff = Math.abs(emaSlow - emaTrend) / emaTrend;
        const trendStrength = Math.min(1.0, (fastSlowDiff + slowTrendDiff) * 10);
        
        // Price position relative to EMAs
        const priceVsFast = (price - emaFast) / emaFast;
        const priceVsSlow = (price - emaSlow) / emaSlow;
        
        return {
            direction: trendBull ? 'bullish' : trendBear ? 'bearish' : 'neutral',
            strength: trendStrength,
            alignment: trendBull || trendBear ? 'aligned' : 'mixed',
            pricePosition: {
                vsFast: priceVsFast,
                vsSlow: priceVsSlow,
                aboveAll: price > emaFast && emaFast > emaSlow && emaSlow > emaTrend,
                belowAll: price < emaFast && emaFast < emaSlow && emaSlow < emaTrend
            }
        };
    }

    // Enhanced RSI analysis with divergence detection
    analyzeRSI(rsi, price, prevPrice, rsiHistory = []) {
        if (!rsi) return { signal: 0, strength: 0, divergence: null };
        
        let signal = 0;
        let strength = 0;
        let divergence = null;
        
        // Basic RSI signals
        if (rsi < 30) {
            signal = 1; // Oversold
            strength = (30 - rsi) / 30; // Stronger as more oversold
        } else if (rsi > 70) {
            signal = -1; // Overbought
            strength = (rsi - 70) / 30; // Stronger as more overbought
        }
        
        // RSI divergence detection (simplified)
        if (rsiHistory.length >= 5) {
            const recentRSI = rsiHistory.slice(-5);
            const recentPrices = [prevPrice, price]; // Simplified price history
            
            // Bullish divergence: price making lower lows, RSI making higher lows
            if (recentPrices[1] < recentPrices[0] && recentRSI[4] > recentRSI[0]) {
                divergence = 'bullish';
                signal = Math.max(signal, 1);
                strength = Math.max(strength, 0.8);
            }
            
            // Bearish divergence: price making higher highs, RSI making lower highs
            if (recentPrices[1] > recentPrices[0] && recentRSI[4] < recentRSI[0]) {
                divergence = 'bearish';
                signal = Math.min(signal, -1);
                strength = Math.max(strength, 0.8);
            }
        }
        
        return { signal, strength, divergence, value: rsi };
    }

    // Enhanced Bollinger Bands analysis
    analyzeBollingerBands(bb, price, volume, avgVolume) {
        if (!bb) return { signal: 0, strength: 0, position: 'middle' };
        
        let signal = 0;
        let strength = 0;
        let position = 'middle';
        
        // Calculate position within bands (0-1)
        const bandWidth = bb.upper - bb.lower;
        const positionInBand = (price - bb.lower) / bandWidth;
        
        // Signal generation
        if (price < bb.lower) {
            signal = 1; // Below lower band
            strength = Math.min(1.0, (bb.lower - price) / (bandWidth * 0.1));
            position = 'below_lower';
        } else if (price > bb.upper) {
            signal = -1; // Above upper band
            strength = Math.min(1.0, (price - bb.upper) / (bandWidth * 0.1));
            position = 'above_upper';
        } else if (positionInBand < 0.2) {
            signal = 0.5; // Near lower band
            strength = 0.5;
            position = 'near_lower';
        } else if (positionInBand > 0.8) {
            signal = -0.5; // Near upper band
            strength = 0.5;
            position = 'near_upper';
        }
        
        // Volume confirmation
        const volumeRatio = volume / avgVolume;
        if (volumeRatio > 1.5) {
            strength = Math.min(1.0, strength * 1.5);
        }
        
        return { signal, strength, position, bandWidth, positionInBand };
    }

    // Enhanced MACD analysis
    analyzeMACD(macd, prevMacd = null) {
        if (!macd) return { signal: 0, strength: 0, momentum: 'neutral' };
        
        let signal = 0;
        let strength = 0;
        let momentum = 'neutral';
        
        // MACD line signals
        if (macd.macd > 0 && macd.macd > macd.signal) {
            signal = 1; // Bullish
            strength = Math.min(1.0, Math.abs(macd.macd) / 0.01);
            momentum = 'bullish';
        } else if (macd.macd < 0 && macd.macd < macd.signal) {
            signal = -1; // Bearish
            strength = Math.min(1.0, Math.abs(macd.macd) / 0.01);
            momentum = 'bearish';
        }
        
        // Histogram momentum
        if (prevMacd && macd.histogram > prevMacd.histogram && macd.histogram > 0) {
            signal = Math.max(signal, 0.5);
            strength = Math.max(strength, 0.7);
            momentum = 'accelerating_bullish';
        } else if (prevMacd && macd.histogram < prevMacd.histogram && macd.histogram < 0) {
            signal = Math.min(signal, -0.5);
            strength = Math.max(strength, 0.7);
            momentum = 'accelerating_bearish';
        }
        
        return { signal, strength, momentum, histogram: macd.histogram };
    }

    // Volume analysis with trend confirmation
    analyzeVolume(volume, avgVolume, price, prevPrice) {
        if (!volume || !avgVolume) return { isHigh: false, ratio: 1.0, confirmation: 0 };
        
        const volumeRatio = volume / avgVolume;
        const priceChange = (price - prevPrice) / prevPrice;
        
        let confirmation = 0;
        
        // Volume confirmation of price movement
        if (volumeRatio > 1.5) {
            if (priceChange > 0 && volumeRatio > 2.0) {
                confirmation = 1; // High volume on price increase
            } else if (priceChange < 0 && volumeRatio > 2.0) {
                confirmation = -1; // High volume on price decrease
            } else if (Math.abs(priceChange) < 0.001) {
                confirmation = 0.5; // High volume but no price change (accumulation)
            }
        }
        
        return {
            isHigh: volumeRatio > 1.5,
            ratio: volumeRatio,
            confirmation: confirmation,
            strength: Math.min(1.0, (volumeRatio - 1) / 2)
        };
    }

    // Main signal generation with dynamic weighting
    generateEnhancedSignal(symbol, state, tokenConfig) {
        if (!state || !state.emaFast || !state.emaSlow || !state.emaTrend) {
            return {
                signal: this.signalTypes.WAIT,
                strength: 0,
                reason: 'Insufficient data',
                confidence: 0,
                regime: 'unknown'
            };
        }
        
        // Detect market regime
        const regime = this.detectMarketRegime(
            state.adx, 
            state.atr, 
            state.lastPrice, 
            state.prices[state.prices.length - 10] || state.lastPrice
        );
        
        // Get dynamic weights for this regime
        const weights = this.getSignalWeights(regime);
        
        // Analyze all indicators
        const trend = this.analyzeTrend(state.emaFast, state.emaSlow, state.emaTrend, state.lastPrice);
        const rsi = this.analyzeRSI(state.rsi, state.lastPrice, state.prices[state.prices.length - 2] || state.lastPrice);
        const bb = this.analyzeBollingerBands(state.bollinger, state.lastPrice, state.lastVolume, state.volumes ? state.volumes.slice(-20).reduce((a, b) => a + b, 0) / 20 : 1);
        const macd = this.analyzeMACD(state.macd, state.prevMacd);
        const volume = this.analyzeVolume(state.lastVolume, state.volumes ? state.volumes.slice(-20).reduce((a, b) => a + b, 0) / 20 : 1, state.lastPrice, state.prices[state.prices.length - 2] || state.lastPrice);
        
        // Calculate weighted scores
        let bullishScore = 0;
        let bearishScore = 0;
        let totalWeight = 0;
        
        // Trend scoring
        if (trend.direction === 'bullish') {
            bullishScore += weights.trend * trend.strength;
        } else if (trend.direction === 'bearish') {
            bearishScore += weights.trend * trend.strength;
        }
        totalWeight += weights.trend;
        
        // RSI scoring
        if (rsi.signal > 0) {
            bullishScore += weights.meanReversion * rsi.strength;
        } else if (rsi.signal < 0) {
            bearishScore += weights.meanReversion * rsi.strength;
        }
        totalWeight += weights.meanReversion;
        
        // Bollinger Bands scoring
        if (bb.signal > 0) {
            bullishScore += weights.meanReversion * bb.strength;
        } else if (bb.signal < 0) {
            bearishScore += weights.meanReversion * bb.strength;
        }
        totalWeight += weights.meanReversion;
        
        // MACD scoring
        if (macd.signal > 0) {
            bullishScore += weights.momentum * macd.strength;
        } else if (macd.signal < 0) {
            bearishScore += weights.momentum * macd.strength;
        }
        totalWeight += weights.momentum;
        
        // Volume scoring
        if (volume.confirmation > 0) {
            bullishScore += weights.volume * volume.strength;
        } else if (volume.confirmation < 0) {
            bearishScore += weights.volume * volume.strength;
        }
        totalWeight += weights.volume;
        
        // Normalize scores
        const normalizedBullish = totalWeight > 0 ? bullishScore / totalWeight : 0;
        const normalizedBearish = totalWeight > 0 ? bearishScore / totalWeight : 0;
        
        // Generate final signal
        let signal = this.signalTypes.WAIT;
        let strength = 0;
        let confidence = 0;
        let reasons = [];
        
        // Signal thresholds based on regime
        const thresholds = {
            [this.marketRegimes.TRENDING]: { min: 0.3, strong: 0.6 },
            [this.marketRegimes.WEAK_TREND]: { min: 0.4, strong: 0.7 },
            [this.marketRegimes.SIDEWAYS]: { min: 0.5, strong: 0.8 },
            [this.marketRegimes.CHOPPY]: { min: 0.6, strong: 0.9 },
            [this.marketRegimes.VOLATILE]: { min: 0.7, strong: 0.95 }
        };
        
        const threshold = thresholds[regime] || thresholds[this.marketRegimes.CHOPPY];
        
        if (normalizedBullish > threshold.min && normalizedBullish > normalizedBearish) {
            signal = normalizedBullish > threshold.strong ? this.signalTypes.STRONG_BUY : this.signalTypes.BUY;
            strength = normalizedBullish;
            confidence = Math.min(1.0, normalizedBullish / threshold.strong);
            reasons.push(`Strong bullish signals (${(normalizedBullish * 100).toFixed(1)}%)`);
        } else if (normalizedBearish > threshold.min && normalizedBearish > normalizedBullish) {
            signal = normalizedBearish > threshold.strong ? this.signalTypes.STRONG_SELL : this.signalTypes.SELL;
            strength = normalizedBearish;
            confidence = Math.min(1.0, normalizedBearish / threshold.strong);
            reasons.push(`Strong bearish signals (${(normalizedBearish * 100).toFixed(1)}%)`);
        } else {
            reasons.push(`Insufficient signal strength (Bull: ${(normalizedBullish * 100).toFixed(1)}%, Bear: ${(normalizedBearish * 100).toFixed(1)}%)`);
        }
        
        // Add regime-specific reasoning
        if (regime === this.marketRegimes.CHOPPY) {
            reasons.push('Choppy market - waiting for clearer signals');
        } else if (regime === this.marketRegimes.VOLATILE) {
            reasons.push('High volatility - conservative approach');
        }
        
        return {
            signal,
            strength,
            confidence,
            regime,
            reasons: reasons.join('; '),
            scores: {
                bullish: normalizedBullish,
                bearish: normalizedBearish,
                totalWeight
            },
            indicators: {
                trend: trend,
                rsi: rsi,
                bollinger: bb,
                macd: macd,
                volume: volume
            },
            weights: weights
        };
    }
}
