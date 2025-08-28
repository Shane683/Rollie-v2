import { EnhancedRiskManager } from './enhancedRiskManager.js';

export class EnhancedPositionSizer {
    constructor(riskManager) {
        this.riskManager = riskManager || new EnhancedRiskManager();
        this.positionMethods = {
            KELLY: 'kelly',
            VOLATILITY: 'volatility',
            FIXED: 'fixed',
            HYBRID: 'hybrid'
        };
    }

    // Main position sizing method
    calculatePosition(symbol, signal, state, tokenConfig, availableCapital) {
        if (!signal || signal.signal === 'wait') {
            return {
                size: 0,
                reason: 'No trading signal',
                risk: 0,
                method: 'none'
            };
        }

        // Get base position size based on method
        let baseSize = 0;
        let method = 'none';
        let sizingDetails = {};

        switch (tokenConfig.positionSizing) {
            case this.positionMethods.KELLY:
                const kellyResult = this.calculateKellyPosition(signal, state, tokenConfig, availableCapital);
                baseSize = kellyResult.size;
                method = this.positionMethods.KELLY;
                sizingDetails = kellyResult;
                break;

            case this.positionMethods.VOLATILITY:
                const volatilityResult = this.calculateVolatilityPosition(signal, state, tokenConfig, availableCapital);
                baseSize = volatilityResult.size;
                method = this.positionMethods.VOLATILITY;
                sizingDetails = volatilityResult;
                break;

            case this.positionMethods.HYBRID:
                const hybridResult = this.calculateHybridPosition(signal, state, tokenConfig, availableCapital);
                baseSize = hybridResult.size;
                method = this.positionMethods.HYBRID;
                sizingDetails = hybridResult;
                break;

            case this.positionMethods.FIXED:
            default:
                const fixedResult = this.calculateFixedPosition(signal, state, tokenConfig, availableCapital);
                baseSize = fixedResult.size;
                method = this.positionMethods.FIXED;
                sizingDetails = fixedResult;
                break;
        }

        // Apply risk management constraints
        const riskAdjustedSize = this.applyRiskConstraints(
            baseSize, 
            signal, 
            state, 
            tokenConfig, 
            availableCapital,
            symbol
        );

        return {
            size: riskAdjustedSize.finalSize,
            reason: riskAdjustedSize.reason,
            risk: riskAdjustedSize.risk,
            method: method,
            sizingDetails: sizingDetails,
            riskAdjustments: riskAdjustedSize.adjustments
        };
    }

    // Kelly Criterion position sizing
    calculateKellyPosition(signal, state, tokenConfig, availableCapital) {
        const { winRate, avgWin, avgLoss } = this.riskManager.riskMetrics;
        
        // Get Kelly position from risk manager
        const kellyResult = this.riskManager.calculateKellyPosition(
            winRate,
            avgWin,
            avgLoss,
            signal.regime,
            signal.confidence
        );

        // Convert percentage to actual position size
        const positionValue = availableCapital * kellyResult.finalSize;
        const positionSize = positionValue / state.lastPrice;

        return {
            size: positionSize,
            kellyFraction: kellyResult.finalSize,
            regimeMultiplier: kellyResult.regimeMultiplier,
            confidenceMultiplier: kellyResult.confidenceMultiplier,
            positionValue: positionValue,
            method: 'Kelly Criterion'
        };
    }

    // Volatility-adjusted position sizing
    calculateVolatilityPosition(signal, state, tokenConfig, availableCapital) {
        if (!state.atr) {
            return {
                size: 0,
                reason: 'Insufficient volatility data',
                method: 'Volatility Adjusted'
            };
        }

        // Get volatility position from risk manager
        const volatilityResult = this.riskManager.calculateVolatilityPosition(
            state.atr,
            state.lastPrice,
            tokenConfig.turbulenceStd || 0.02,
            signal.regime
        );

        // Convert percentage to actual position size
        const positionValue = availableCapital * volatilityResult.size;
        const positionSize = positionValue / state.lastPrice;

        return {
            size: positionSize,
            volatilityRatio: volatilityResult.volatilityRatio,
            adjustedSize: volatilityResult.size,
            positionValue: positionValue,
            method: 'Volatility Adjusted'
        };
    }

    // Hybrid position sizing (combines multiple methods)
    calculateHybridPosition(signal, state, tokenConfig, availableCapital) {
        // Calculate positions using different methods
        const kellyResult = this.calculateKellyPosition(signal, state, tokenConfig, availableCapital);
        const volatilityResult = this.calculateVolatilityPosition(signal, state, tokenConfig, availableCapital);

        // Weight the results based on market regime
        const regimeWeights = {
            'trending': { kelly: 0.7, volatility: 0.3 },
            'weak_trend': { kelly: 0.6, volatility: 0.4 },
            'sideways': { kelly: 0.4, volatility: 0.6 },
            'choppy': { kelly: 0.3, volatility: 0.7 },
            'volatile': { kelly: 0.2, volatility: 0.8 }
        };

        const weights = regimeWeights[signal.regime] || regimeWeights['sideways'];

        // Calculate weighted average
        const weightedSize = (kellyResult.size * weights.kelly) + (volatilityResult.size * weights.volatility);
        const positionValue = availableCapital * (kellyResult.kellyFraction * weights.kelly + volatilityResult.adjustedSize * weights.volatility);

        return {
            size: weightedSize,
            kellyWeight: weights.kelly,
            volatilityWeight: weights.volatility,
            kellySize: kellyResult.size,
            volatilitySize: volatilityResult.size,
            positionValue: positionValue,
            method: 'Hybrid (Kelly + Volatility)'
        };
    }

    // Fixed percentage position sizing
    calculateFixedPosition(signal, state, tokenConfig, availableCapital) {
        const fixedPercentage = tokenConfig.fixedPositionSize || 0.2; // Default 20%
        
        // Adjust based on signal confidence
        const confidenceMultiplier = 0.5 + (signal.confidence * 0.5); // 0.5x to 1.0x
        
        const adjustedPercentage = fixedPercentage * confidenceMultiplier;
        const positionValue = availableCapital * adjustedPercentage;
        const positionSize = positionValue / state.lastPrice;

        return {
            size: positionSize,
            fixedPercentage: fixedPercentage,
            confidenceMultiplier: confidenceMultiplier,
            adjustedPercentage: adjustedPercentage,
            positionValue: positionValue,
            method: 'Fixed Percentage'
        };
    }

    // Apply risk management constraints
    applyRiskConstraints(baseSize, signal, state, tokenConfig, availableCapital, symbol) {
        const adjustments = [];
        let finalSize = baseSize;
        let reason = 'Position size calculated';

        // 1. Minimum lot size constraint
        const minLot = tokenConfig.minLotUsd / state.lastPrice;
        if (finalSize < minLot) {
            adjustments.push(`Increased from ${finalSize.toFixed(6)} to minimum lot ${minLot.toFixed(6)}`);
            finalSize = minLot;
        }

        // 2. Maximum lot size constraint
        const maxLot = tokenConfig.maxLotUsd / state.lastPrice;
        if (finalSize > maxLot) {
            adjustments.push(`Reduced from ${finalSize.toFixed(6)} to maximum lot ${maxLot.toFixed(6)}`);
            finalSize = maxLot;
        }

        // 3. Maximum risk per trade constraint
        const maxRiskPerTrade = tokenConfig.maxRiskPerTrade || 0.02; // 2% default
        const maxRiskAmount = availableCapital * maxRiskPerTrade;
        
        // Calculate stop loss distance for risk calculation
        const stopLossInfo = this.riskManager.calculateDynamicStopLoss(
            state.atr,
            state.lastPrice,
            signal.regime,
            signal.strength
        );
        
        const riskPerUnit = stopLossInfo.stopDistance;
        const maxSizeByRisk = maxRiskAmount / riskPerUnit;
        
        if (finalSize > maxSizeByRisk) {
            adjustments.push(`Reduced from ${finalSize.toFixed(6)} to risk limit ${maxSizeByRisk.toFixed(6)}`);
            finalSize = maxSizeByRisk;
        }

        // 4. Portfolio heat constraint
        const positionRisk = finalSize * riskPerUnit;
        const heatCheck = this.riskManager.canTakePosition(positionRisk, availableCapital, symbol);
        
        if (!heatCheck.canTake) {
            adjustments.push(`Reduced due to portfolio heat: ${heatCheck.reason}`);
            // Calculate maximum size that fits within heat limits
            const maxHeatSize = (heatCheck.maxHeat - heatCheck.currentHeat) / riskPerUnit;
            finalSize = Math.min(finalSize, maxHeatSize);
        }

        // 5. Signal strength adjustment
        if (signal.confidence < 0.7) {
            const confidenceMultiplier = 0.5 + (signal.confidence * 0.5); // 0.5x to 1.0x
            const adjustedSize = finalSize * confidenceMultiplier;
            adjustments.push(`Reduced by ${((1 - confidenceMultiplier) * 100).toFixed(1)}% due to low confidence`);
            finalSize = adjustedSize;
        }

        // 6. Market regime adjustment
        const regimeMultipliers = {
            'trending': 1.0,
            'weak_trend': 0.9,
            'sideways': 0.8,
            'choppy': 0.6,
            'volatile': 0.4
        };
        
        const regimeMultiplier = regimeMultipliers[signal.regime] || 0.7;
        if (regimeMultiplier < 1.0) {
            const adjustedSize = finalSize * regimeMultiplier;
            adjustments.push(`Reduced by ${((1 - regimeMultiplier) * 100).toFixed(1)}% due to ${signal.regime} market`);
            finalSize = adjustedSize;
        }

        // Final validation
        if (finalSize < minLot) {
            finalSize = 0;
            reason = 'Position too small after risk adjustments';
        }

        // Calculate final risk
        const finalRisk = finalSize * riskPerUnit;

        return {
            finalSize,
            reason,
            risk: finalRisk,
            adjustments,
            constraints: {
                minLot,
                maxLot,
                maxRiskPerTrade,
                portfolioHeat: heatCheck.canTake,
                signalConfidence: signal.confidence,
                marketRegime: signal.regime
            }
        };
    }

    // Get position sizing summary
    getPositionSummary(symbol, signal, state, tokenConfig, availableCapital) {
        const position = this.calculatePosition(symbol, signal, state, tokenConfig, availableCapital);
        
        return {
            symbol,
            signal: signal.signal,
            confidence: signal.confidence,
            regime: signal.regime,
            positionSize: position.size,
            positionValue: position.size * state.lastPrice,
            risk: position.risk,
            riskPercentage: (position.risk / availableCapital) * 100,
            method: position.method,
            reason: position.reason,
            adjustments: position.adjustments,
            constraints: position.constraints,
            sizingDetails: position.sizingDetails
        };
    }
}
