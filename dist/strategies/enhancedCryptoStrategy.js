import { ema, stdev, adx, rsi, bollingerBands, macd, atr } from "../lib/math.js";
import { EnhancedSignalGenerator } from "./enhancedSignalGenerator.js";
import { EnhancedRiskManager } from "./enhancedRiskManager.js";
import { EnhancedPositionSizer } from "./enhancedPositionSizer.js";
import fs from "fs";
import path from "path";

export class EnhancedCryptoStrategy {
    constructor(cfg) {
        this.cfg = cfg;
        this.tokenStates = new Map();
        this.maxReturns = 240; // ~4h with 1min polling
        this.tokenConfigs = this.loadTokenConfigs();
        this.lastTradeAt = new Map();
        
        // Initialize enhanced components
        this.signalGenerator = new EnhancedSignalGenerator();
        this.riskManager = new EnhancedRiskManager();
        this.positionSizer = new EnhancedPositionSizer(this.riskManager);
        
        // Performance tracking
        this.performanceMetrics = {
            totalTrades: 0,
            winningTrades: 0,
            losingTrades: 0,
            totalPnl: 0,
            maxDrawdown: 0,
            currentDrawdown: 0,
            sharpeRatio: 0,
            winRate: 0.55
        };
    }

    loadTokenConfigs() {
        try {
            const configPath = path.join(process.cwd(), 'config', 'tokens.json');
            if (fs.existsSync(configPath)) {
                const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
                console.log(`📁 Loaded enhanced config for ${Object.keys(config).length} tokens`);
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
            maxRiskPerTrade: symbolConfig.maxRiskPerTrade ?? 0.02,
            turbulenceStd: symbolConfig.turbulenceStd ?? 0.02,
            
            // Position sizing
            minLotUsd: symbolConfig.minLotUsd ?? 100,
            maxLotUsd: symbolConfig.maxLotUsd ?? 1000,
            positionSizing: symbolConfig.positionSizing ?? 'hybrid',
            fixedPositionSize: symbolConfig.fixedPositionSize ?? 0.2,
            
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
            stopLossMultiplier: symbolConfig.stopLossMultiplier ?? 2.0,
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
                prevMacd: null,
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
            state.prevMacd = state.macd;
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

    // Enhanced trading decision method
    targetPosition(symbol, availableCapital = 1000) {
        const state = this.tokenStates.get(symbol);
        if (!state || !state.emaFast || !state.emaSlow || !state.emaTrend) {
            return {
                position: 0,
                reason: 'Insufficient data for analysis',
                signal: null,
                sizing: null
            };
        }

        const tokenConfig = this.getTokenConfig(symbol);
        
        // Generate enhanced signal
        const signal = this.signalGenerator.generateEnhancedSignal(symbol, state, tokenConfig);
        
        if (signal.signal === 'wait') {
            return {
                position: 0,
                reason: signal.reasons,
                signal: signal,
                sizing: null
            };
        }
        
        // Check cooldown
        const now = Date.now();
        const lastTrade = this.lastTradeAt.get(symbol) || 0;
        
        if (now - lastTrade < tokenConfig.cooldownSec * 1000) {
            return {
                position: 0,
                reason: `Cooldown active (${Math.ceil((tokenConfig.cooldownSec * 1000 - (now - lastTrade)) / 1000)}s remaining)`,
                signal: signal,
                sizing: null
            };
        }
        
        // Calculate position size
        const sizing = this.positionSizer.calculatePosition(symbol, signal, state, tokenConfig, availableCapital);
        
        if (sizing.size === 0) {
            return {
                position: 0,
                reason: sizing.reason,
                signal: signal,
                sizing: sizing
            };
        }
        
        // Calculate stop-loss and take-profit levels
        const stopLossInfo = this.riskManager.calculateDynamicStopLoss(
            state.atr,
            state.lastPrice,
            signal.regime,
            signal.strength
        );
        
        // Determine position direction
        const position = signal.signal.includes('buy') ? sizing.size : -sizing.size;
        
        // Log the enhanced decision
        this.logEnhancedDecision(symbol, signal, sizing, stopLossInfo, availableCapital);
        
        return {
            position,
            reason: `Executing ${signal.signal} signal with ${sizing.method} sizing`,
            signal: signal,
            sizing: sizing,
            stopLoss: stopLossInfo,
            confidence: signal.confidence,
            regime: signal.regime
        };
    }

    // Enhanced logging with detailed analysis
    logEnhancedDecision(symbol, signal, sizing, stopLossInfo, availableCapital) {
        const state = this.tokenStates.get(symbol);
        
        console.log(`\n🎯 [${symbol}] ENHANCED TRADING DECISION`);
        console.log(`📊 Signal: ${signal.signal.toUpperCase()} (${(signal.confidence * 100).toFixed(1)}% confidence)`);
        console.log(`🌍 Market Regime: ${signal.regime.toUpperCase()}`);
        console.log(`📈 Signal Strength: ${(signal.strength * 100).toFixed(1)}%`);
        console.log(`💰 Position Size: ${sizing.size.toFixed(6)} ($${(sizing.size * state.lastPrice).toFixed(2)})`);
        console.log(`⚖️ Sizing Method: ${sizing.method}`);
        console.log(`🛡️ Risk: $${sizing.risk.toFixed(2)} (${(sizing.risk / availableCapital * 100).toFixed(2)}%)`);
        console.log(`🛑 Stop Loss: $${stopLossInfo.stopLoss.toFixed(4)}`);
        console.log(`🎯 Take Profit: $${stopLossInfo.takeProfit.toFixed(4)}`);
        console.log(`📊 Portfolio Heat: ${this.riskManager.getPortfolioHeatStatus().color} ${(this.riskManager.portfolioHeat / availableCapital * 100).toFixed(1)}%`);
        
        if (sizing.adjustments && sizing.adjustments.length > 0) {
            console.log(`🔧 Risk Adjustments:`);
            sizing.adjustments.forEach(adj => console.log(`   • ${adj}`));
        }
        
        console.log(`📋 Reasons: ${signal.reasons}`);
        console.log(`📊 Indicator Summary:`);
        console.log(`   • Trend: ${signal.indicators.trend.direction} (${(signal.indicators.trend.strength * 100).toFixed(1)}%)`);
        console.log(`   • RSI: ${signal.indicators.rsi.value || 'N/A'} ${signal.indicators.rsi.divergence ? `(${signal.indicators.rsi.divergence})` : ''}`);
        console.log(`   • BB: ${signal.indicators.bollinger.position} (${(signal.indicators.bollinger.strength * 100).toFixed(1)}%)`);
        console.log(`   • MACD: ${signal.indicators.macd.momentum} (${(signal.indicators.macd.strength * 100).toFixed(1)}%)`);
        console.log(`   • Volume: ${(signal.indicators.volume.ratio).toFixed(2)}x average`);
        console.log(`   • ADX: ${signal.indicators.adx || 'N/A'}`);
    }

    // Update portfolio heat when positions are opened
    openPosition(symbol, risk, entryPrice, quantity) {
        const result = this.riskManager.addPosition(symbol, risk, entryPrice, quantity);
        
        if (result.success) {
            this.lastTradeAt.set(symbol, Date.now());
            console.log(`✅ [${symbol}] Position opened: ${result.message}`);
        }
        
        return result;
    }

    // Update portfolio heat when positions are closed
    closePosition(symbol, exitPrice, pnl) {
        const result = this.riskManager.closePosition(symbol, exitPrice, pnl);
        
        if (result.success) {
            this.updatePerformanceMetrics(pnl);
            console.log(`🔒 [${symbol}] Position closed: ${result.message}`);
        }
        
        return result;
    }

    // Update performance metrics
    updatePerformanceMetrics(pnl) {
        this.performanceMetrics.totalTrades++;
        this.performanceMetrics.totalPnl += pnl;
        
        if (pnl > 0) {
            this.performanceMetrics.winningTrades++;
        } else {
            this.performanceMetrics.losingTrades++;
        }
        
        this.performanceMetrics.winRate = this.performanceMetrics.winningTrades / this.performanceMetrics.totalTrades;
        
        // Update drawdown
        if (pnl < this.performanceMetrics.maxDrawdown) {
            this.performanceMetrics.maxDrawdown = pnl;
        }
        this.performanceMetrics.currentDrawdown = this.performanceMetrics.totalPnl;
        
        // Update risk manager metrics
        this.riskManager.riskMetrics.winRate = this.performanceMetrics.winRate;
        if (pnl > 0) {
            this.riskManager.riskMetrics.avgWin = (this.riskManager.riskMetrics.avgWin + pnl) / 2;
        } else {
            this.riskManager.riskMetrics.avgLoss = (this.riskManager.riskMetrics.avgLoss + Math.abs(pnl)) / 2;
        }
    }

    // Get comprehensive strategy summary
    getStrategySummary() {
        const heatStatus = this.riskManager.getPortfolioHeatStatus();
        const riskReport = this.riskManager.getRiskReport();
        
        return {
            name: 'Enhanced Multi-Indicator Crypto Strategy',
            version: '2.0.0',
            features: [
                'Dynamic signal weighting based on market regime',
                'Enhanced technical indicator analysis',
                'Kelly Criterion + Volatility position sizing',
                'Dynamic stop-losses with regime adjustment',
                'Portfolio heat management',
                'Performance tracking and optimization',
                'Risk-adjusted position sizing',
                'Market regime detection and adaptation'
            ],
            currentStatus: {
                portfolioHeat: heatStatus,
                openPositions: riskReport.openPositions,
                totalPositions: riskReport.positionCount
            },
            performance: this.performanceMetrics,
            riskMetrics: this.riskManager.riskMetrics,
            components: {
                signalGenerator: 'Enhanced Signal Generator v2.0',
                riskManager: 'Enhanced Risk Manager v2.0',
                positionSizer: 'Enhanced Position Sizer v2.0'
            }
        };
    }

    // Reset strategy state (for testing)
    resetStrategy() {
        this.tokenStates.clear();
        this.lastTradeAt.clear();
        this.riskManager.resetPortfolioHeat();
        this.performanceMetrics = {
            totalTrades: 0,
            winningTrades: 0,
            losingTrades: 0,
            totalPnl: 0,
            maxDrawdown: 0,
            currentDrawdown: 0,
            sharpeRatio: 0,
            winRate: 0.55
        };
        
        console.log('🔄 Strategy state reset successfully');
    }

    // Get detailed analysis for a specific token
    getTokenAnalysis(symbol) {
        const state = this.tokenStates.get(symbol);
        if (!state) return null;
        
        const tokenConfig = this.getTokenConfig(symbol);
        const signal = this.signalGenerator.generateEnhancedSignal(symbol, state, tokenConfig);
        
        return {
            symbol,
            currentPrice: state.lastPrice,
            signal: signal,
            technicalIndicators: {
                ema: {
                    fast: state.emaFast,
                    slow: state.emaSlow,
                    trend: state.emaTrend
                },
                rsi: state.rsi,
                bollinger: state.bollinger,
                macd: state.macd,
                atr: state.atr,
                adx: state.adx
            },
            volume: {
                current: state.lastVolume,
                average: state.volumes ? state.volumes.slice(-20).reduce((a, b) => a + b, 0) / 20 : null,
                ratio: state.lastVolume && state.volumes ? state.lastVolume / (state.volumes.slice(-20).reduce((a, b) => a + b, 0) / 20) : null
            },
            lastTrade: this.lastTradeAt.get(symbol) || null
        };
    }
}
