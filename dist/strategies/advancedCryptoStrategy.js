import { ema, stdev, adx, rsi, bollingerBands, macd, atr } from "../lib/math.js";
import fs from "fs";
import path from "path";

export class AdvancedCryptoStrategy {
    constructor(cfg) {
        this.cfg = cfg;
        this.tokenStates = new Map();
        this.maxReturns = 240; // ~4h with 1min polling
        this.tokenConfigs = this.loadTokenConfigs();
        this.lastTradeAt = new Map();
        this.portfolioHeat = 0; // Track total portfolio risk
        this.maxPortfolioHeat = 0.15; // Max 15% portfolio risk
    }

    loadTokenConfigs() {
        try {
            const configPath = path.join(process.cwd(), 'config', 'tokens.json');
            if (fs.existsSync(configPath)) {
                const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
                console.log(`📁 Loaded advanced config for ${Object.keys(config).length} tokens`);
                return config;
            }
        } catch (error) {
            console.warn(`⚠️ Failed to load token configs: ${error.message}, using global defaults`);
        }
        return {};
    }

    getTokenConfig(symbol) {
        const symbolConfig = this.tokenConfigs[symbol] || {};
        return {
            // Multi-timeframe EMAs
            emaFast: symbolConfig.emaFast ?? 8,
            emaSlow: symbolConfig.emaSlow ?? 21,
            emaTrend: symbolConfig.emaTrend ?? 50,
            
            // Volatility and risk
            atrPeriod: symbolConfig.atrPeriod ?? 14,
            volatilityMultiplier: symbolConfig.volatilityMultiplier ?? 2.0,
            maxRiskPerTrade: symbolConfig.maxRiskPerTrade ?? 0.02, // 2% max risk per trade
            
            // Position sizing
            minLotUsd: symbolConfig.minLotUsd ?? 100,
            maxLotUsd: symbolConfig.maxLotUsd ?? 1000,
            positionSizing: symbolConfig.positionSizing ?? 'kelly', // 'kelly', 'fixed', 'volatility'
            
            // Technical indicators
            rsiPeriod: symbolConfig.rsiPeriod ?? 14,
            rsiOverbought: symbolConfig.rsiOverbought ?? 70,
            rsiOversold: symbolConfig.rsiOversold ?? 30,
            
            bollingerPeriod: symbolConfig.bollingerPeriod ?? 20,
            bollingerStdDev: symbolConfig.bollingerStdDev ?? 2,
            
            macdFast: symbolConfig.macdFast ?? 12,
            macdSlow: symbolConfig.macdSlow ?? 26,
            macdSignal: symbolConfig.macdSignal ?? 9,
            
            // Risk management
            stopLossMultiplier: symbolConfig.stopLossMultiplier ?? 2.0, // ATR multiplier
            takeProfitMultiplier: symbolConfig.takeProfitMultiplier ?? 3.0,
            trailingStopMultiplier: symbolConfig.trailingStopMultiplier ?? 1.5,
            
            // Market regime
            adxPeriod: symbolConfig.adxPeriod ?? 14,
            adxThreshold: symbolConfig.adxThreshold ?? 25,
            
            // Cooldowns
            cooldownSec: symbolConfig.cooldownSec ?? 30,
            
            // Volume analysis
            volumePeriod: symbolConfig.volumePeriod ?? 20,
            volumeThreshold: symbolConfig.volumeThreshold ?? 1.5
        };
    }

    ensureTokenState(symbol) {
        if (!this.tokenStates.has(symbol)) {
            this.tokenStates.set(symbol, {
                symbol,
                prices: [],
                volumes: [],
                returns: [],
                emaFast: null,
                emaSlow: null,
                emaTrend: null,
                rsi: null,
                bollinger: null,
                macd: null,
                atr: null,
                adx: null,
                lastPrice: null,
                lastVolume: null,
                maxReturns: this.maxReturns,
                maxPrices: 100,
                maxVolumes: 100
            });
        }
        return this.tokenStates.get(symbol);
    }

    updatePrice(symbol, price, volume = null) {
        const state = this.ensureTokenState(symbol);
        const tokenConfig = this.getTokenConfig(symbol);
        
        // Update price arrays
        state.prices.push(price);
        if (state.prices.length > state.maxPrices) {
            state.prices.shift();
        }
        
        if (volume) {
            state.volumes.push(volume);
            if (state.volumes.length > state.maxVolumes) {
                state.volumes.shift();
            }
            state.lastVolume = volume;
        }
        
        // Calculate EMAs
        state.emaFast = ema(state.emaFast, price, tokenConfig.emaFast);
        state.emaSlow = ema(state.emaSlow, price, tokenConfig.emaSlow);
        state.emaTrend = ema(state.emaTrend, price, tokenConfig.emaTrend);
        
        // Calculate returns for volatility
        if (state.lastPrice != null) {
            const r = Math.log(price / state.lastPrice);
            state.returns.push(r);
            if (state.returns.length > state.maxReturns) {
                state.returns.shift();
            }
        }
        
        // Calculate technical indicators
        if (state.prices.length >= tokenConfig.rsiPeriod) {
            state.rsi = rsi(state.prices, tokenConfig.rsiPeriod);
        }
        
        if (state.prices.length >= tokenConfig.bollingerPeriod) {
            state.bollinger = bollingerBands(state.prices, tokenConfig.bollingerPeriod, tokenConfig.bollingerStdDev);
        }
        
        if (state.prices.length >= tokenConfig.macdSlow) {
            state.macd = macd(state.prices, tokenConfig.macdFast, tokenConfig.macdSlow, tokenConfig.macdSignal);
        }
        
        if (state.prices.length >= tokenConfig.atrPeriod) {
            state.atr = atr(state.prices, tokenConfig.atrPeriod);
        }
        
        if (state.returns.length >= tokenConfig.adxPeriod) {
            state.adx = adx(state.returns, tokenConfig.adxPeriod);
        }
        
        state.lastPrice = price;
    }

    // Market regime detection
    detectMarketRegime(symbol) {
        const state = this.tokenStates.get(symbol);
        if (!state || !state.adx) return 'unknown';
        
        if (state.adx > 40) return 'trending';
        if (state.adx > 25) return 'weak_trend';
        if (state.adx > 15) return 'sideways';
        return 'choppy';
    }

    // Volume analysis
    analyzeVolume(symbol) {
        const state = this.tokenStates.get(symbol);
        const tokenConfig = this.getTokenConfig(symbol);
        
        if (!state.volumes || state.volumes.length < tokenConfig.volumePeriod) {
            return { isHigh: false, ratio: 1.0 };
        }
        
        const recentVolumes = state.volumes.slice(-tokenConfig.volumePeriod);
        const avgVolume = recentVolumes.reduce((a, b) => a + b, 0) / recentVolumes.length;
        const currentVolume = state.lastVolume || avgVolume;
        const volumeRatio = currentVolume / avgVolume;
        
        return {
            isHigh: volumeRatio > tokenConfig.volumeThreshold,
            ratio: volumeRatio
        };
    }

    // Multi-indicator signal generation
    generateSignal(symbol) {
        const state = this.tokenStates.get(symbol);
        const tokenConfig = this.getTokenConfig(symbol);
        
        if (!state || !state.emaFast || !state.emaSlow || !state.emaTrend) {
            return { signal: 'wait', strength: 0, reason: 'Insufficient data' };
        }
        
        const regime = this.detectMarketRegime(symbol);
        const volume = this.analyzeVolume(symbol);
        
        // Skip trading in choppy markets
        if (regime === 'choppy') {
            return { signal: 'wait', strength: 0, reason: `Choppy market (ADX: ${state.adx?.toFixed(2)})` };
        }
        
        let signal = 'wait';
        let strength = 0;
        let reasons = [];
        
        // Trend analysis
        const trendBull = state.emaFast > state.emaSlow && state.emaSlow > state.emaTrend;
        const trendBear = state.emaFast < state.emaSlow && state.emaSlow < state.emaTrend;
        const trendStrength = Math.abs(state.emaFast - state.emaSlow) / state.emaSlow;
        
        // RSI analysis
        let rsiSignal = 0;
        if (state.rsi) {
            if (state.rsi < tokenConfig.rsiOversold) rsiSignal = 1; // Oversold
            else if (state.rsi > tokenConfig.rsiOverbought) rsiSignal = -1; // Overbought
        }
        
        // Bollinger Bands analysis
        let bbSignal = 0;
        if (state.bollinger) {
            const currentPrice = state.lastPrice;
            if (currentPrice < state.bollinger.lower) bbSignal = 1; // Below lower band
            else if (currentPrice > state.bollinger.upper) bbSignal = -1; // Above upper band
        }
        
        // MACD analysis
        let macdSignal = 0;
        if (state.macd) {
            if (state.macd.histogram > 0 && state.macd.histogram > state.macd.previousHistogram) {
                macdSignal = 1; // Bullish momentum
            } else if (state.macd.histogram < 0 && state.macd.histogram < state.macd.previousHistogram) {
                macdSignal = -1; // Bearish momentum
            }
        }
        
        // Combine signals
        let bullishScore = 0;
        let bearishScore = 0;
        
        if (trendBull) bullishScore += 2;
        if (trendBear) bearishScore += 2;
        
        if (rsiSignal === 1) bullishScore += 1;
        if (rsiSignal === -1) bearishScore += 1;
        
        if (bbSignal === 1) bullishScore += 1;
        if (bbSignal === -1) bearishScore += 1;
        
        if (macdSignal === 1) bullishScore += 1;
        if (macdSignal === -1) bearishScore += 1;
        
        // Volume confirmation
        if (volume.isHigh) {
            if (bullishScore > bearishScore) bullishScore += 1;
            if (bearishScore > bullishScore) bearishScore += 1;
        }
        
        // Generate final signal
        if (bullishScore >= 3 && bullishScore > bearishScore) {
            signal = 'buy';
            strength = Math.min(bullishScore / 6, 1.0);
            reasons.push('Strong bullish signals across multiple indicators');
        } else if (bearishScore >= 3 && bearishScore > bullishScore) {
            signal = 'sell';
            strength = Math.min(bearishScore / 6, 1.0);
            reasons.push('Strong bearish signals across multiple indicators');
        }
        
        return {
            signal,
            strength,
            regime,
            volume: volume.ratio,
            reasons: reasons.join('; '),
            indicators: {
                trend: trendBull ? 'bullish' : trendBear ? 'bearish' : 'neutral',
                rsi: state.rsi?.toFixed(2),
                bb: bbSignal,
                macd: macdSignal,
                adx: state.adx?.toFixed(2)
            }
        };
    }

    // Advanced position sizing using Kelly Criterion
    calculatePositionSize(symbol, signal, availableCapital) {
        const state = this.tokenStates.get(symbol);
        const tokenConfig = this.getTokenConfig(symbol);
        
        if (!state || !state.atr) {
            return { size: 0, risk: 0, reason: 'Insufficient volatility data' };
        }
        
        let positionSize = 0;
        let riskAmount = 0;
        
        switch (tokenConfig.positionSizing) {
            case 'kelly':
                // Kelly Criterion for optimal position sizing
                const winRate = 0.55; // Estimated win rate
                const avgWin = 0.03; // 3% average win
                const avgLoss = 0.02; // 2% average loss
                const kellyFraction = (winRate * avgWin - (1 - winRate) * avgLoss) / avgWin;
                positionSize = Math.max(0, Math.min(kellyFraction, 0.25)); // Cap at 25%
                break;
                
            case 'volatility':
                // Volatility-adjusted sizing
                const volatility = state.atr / state.lastPrice;
                positionSize = Math.max(0.1, Math.min(0.5, 0.3 / volatility));
                break;
                
            case 'fixed':
            default:
                positionSize = 0.2; // 20% of available capital
                break;
        }
        
        // Apply risk limits
        const maxRiskAmount = availableCapital * tokenConfig.maxRiskPerTrade;
        const stopLossDistance = state.atr * tokenConfig.stopLossMultiplier;
        const riskPerUnit = stopLossDistance;
        
        const maxSizeByRisk = maxRiskAmount / riskPerUnit;
        const maxSizeByCapital = availableCapital * positionSize / state.lastPrice;
        
        positionSize = Math.min(maxSizeByRisk, maxSizeByCapital);
        
        // Ensure minimum and maximum lot sizes
        const minLot = tokenConfig.minLotUsd / state.lastPrice;
        const maxLot = tokenConfig.maxLotUsd / state.lastPrice;
        
        positionSize = Math.max(minLot, Math.min(maxLot, positionSize));
        
        riskAmount = positionSize * riskPerUnit;
        
        return {
            size: positionSize,
            risk: riskAmount,
            stopLoss: state.lastPrice - stopLossDistance,
            takeProfit: state.lastPrice + (stopLossDistance * tokenConfig.takeProfitMultiplier),
            trailingStop: state.lastPrice - (stopLossDistance * tokenConfig.trailingStopMultiplier)
        };
    }

    // Main trading decision method
    targetPosition(symbol, availableCapital = 1000) {
        const signal = this.generateSignal(symbol);
        
        if (signal.signal === 'wait') {
            return {
                position: 0,
                reason: signal.reason,
                signal: signal
            };
        }
        
        // Check cooldown
        const now = Date.now();
        const lastTrade = this.lastTradeAt.get(symbol) || 0;
        const tokenConfig = this.getTokenConfig(symbol);
        
        if (now - lastTrade < tokenConfig.cooldownSec * 1000) {
            return {
                position: 0,
                reason: `Cooldown active (${Math.ceil((tokenConfig.cooldownSec * 1000 - (now - lastTrade)) / 1000)}s remaining)`,
                signal: signal
            };
        }
        
        // Calculate position size
        const sizing = this.calculatePositionSize(symbol, signal.signal, availableCapital);
        
        if (sizing.size === 0) {
            return {
                position: 0,
                reason: sizing.reason,
                signal: signal
            };
        }
        
        // Check portfolio heat
        if (this.portfolioHeat + sizing.risk > this.maxPortfolioHeat * availableCapital) {
            return {
                position: 0,
                reason: `Portfolio heat limit exceeded (${(this.portfolioHeat / availableCapital * 100).toFixed(1)}% + ${(sizing.risk / availableCapital * 100).toFixed(1)}%)`,
                signal: signal
            };
        }
        
        // Determine position direction
        const position = signal.signal === 'buy' ? sizing.size : -sizing.size;
        
        // Update portfolio heat
        this.portfolioHeat += sizing.risk;
        
        // Log the decision
        console.log(`[${symbol}] ${signal.signal.toUpperCase()} Signal:`, {
            strength: signal.strength.toFixed(2),
            regime: signal.regime,
            volume: signal.volume.toFixed(2),
            position: position.toFixed(6),
            risk: `$${sizing.risk.toFixed(2)}`,
            stopLoss: `$${sizing.stopLoss.toFixed(4)}`,
            takeProfit: `$${sizing.takeProfit.toFixed(4)}`,
            reasons: signal.reasons
        });
        
        return {
            position,
            reason: `Executing ${signal.signal} signal`,
            signal: signal,
            sizing: sizing
        };
    }

    // Check if we should exit existing positions
    shouldExitPosition(symbol, currentPrice) {
        const state = this.tokenStates.get(symbol);
        if (!state || !state.lastPrice) return null;
        
        const tokenConfig = this.getTokenConfig(symbol);
        
        // Check if we have enough data for ATR calculation
        if (!state.atr) return null;
        
        // Calculate stop loss and take profit levels
        const stopLossDistance = state.atr * tokenConfig.stopLossMultiplier;
        const takeProfitDistance = state.atr * tokenConfig.takeProfitMultiplier;
        
        // For now, we'll use a simple approach - in a real implementation,
        // you'd track entry prices and current positions
        const stopLoss = state.lastPrice - stopLossDistance;
        const takeProfit = state.lastPrice + takeProfitDistance;
        
        if (currentPrice <= stopLoss) {
            return {
                action: 'sell',
                reason: 'Stop Loss triggered',
                price: currentPrice,
                stopLoss: stopLoss,
                takeProfit: takeProfit
            };
        }
        
        if (currentPrice >= takeProfit) {
            return {
                action: 'sell',
                reason: 'Take Profit triggered',
                price: currentPrice,
                stopLoss: stopLoss,
                takeProfit: takeProfit
            };
        }
        
        return null;
    }

    // Generate exit signals for existing positions
    generateExitSignal(symbol, currentPrice) {
        const exitCheck = this.shouldExitPosition(symbol, currentPrice);
        if (!exitCheck) return null;
        
        return {
            signal: 'sell',
            strength: 1.0,
            reason: exitCheck.reason,
            exitInfo: exitCheck
        };
    }

    // Check if we have an existing position that should be managed
    hasExistingPosition(symbol) {
        // This would integrate with your position tracking system
        // For now, we'll assume no existing positions to avoid conflicts
        return false;
    }

    // Enhanced signal generation that considers existing positions
    generateEnhancedSignal(symbol, currentPrice) {
        // First check if we should exit an existing position
        const exitSignal = this.generateExitSignal(symbol, currentPrice);
        if (exitSignal) {
            return exitSignal;
        }
        
        // Then check if we should enter a new position
        const entrySignal = this.generateSignal(symbol);
        
        // If we have an existing position, be more conservative with new entries
        if (this.hasExistingPosition(symbol)) {
            if (entrySignal.signal === 'buy') {
                // Only buy more if signal is very strong
                if (entrySignal.strength < 0.8) {
                    return { signal: 'wait', strength: 0, reason: 'Existing position - waiting for stronger signal' };
                }
            }
        }
        
        return entrySignal;
    }

    // Update portfolio heat when positions are closed
    updatePortfolioHeat(symbol, closedRisk) {
        this.portfolioHeat = Math.max(0, this.portfolioHeat - closedRisk);
    }

    // Get strategy summary
    getStrategySummary() {
        return {
            name: 'Advanced Multi-Indicator Crypto Strategy',
            features: [
                'Multi-timeframe EMA analysis',
                'RSI divergence detection',
                'Bollinger Bands mean reversion',
                'MACD momentum confirmation',
                'Volume-weighted signals',
                'Market regime detection (ADX)',
                'Kelly Criterion position sizing',
                'Dynamic stop-losses (ATR-based)',
                'Portfolio heat management',
                'Volatility-adjusted sizing'
            ],
            currentHeat: this.portfolioHeat,
            maxHeat: this.maxPortfolioHeat
        };
    }
}
