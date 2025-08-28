export class EnhancedRiskManager {
    constructor() {
        this.portfolioHeat = 0;
        this.maxPortfolioHeat = 0.15; // 15% maximum portfolio risk
        this.positionHistory = new Map(); // Track all positions
        this.riskMetrics = {
            totalRisk: 0,
            maxDrawdown: 0,
            currentDrawdown: 0,
            sharpeRatio: 0,
            winRate: 0.55, // Initial estimate, will be updated
            avgWin: 0.03,  // 3% average win
            avgLoss: 0.02  // 2% average loss
        };
    }

    // Enhanced Kelly Criterion with regime adjustment
    calculateKellyPosition(winRate, avgWin, avgLoss, regime, confidence) {
        // Base Kelly calculation
        const kellyFraction = (winRate * avgWin - (1 - winRate) * avgLoss) / avgWin;
        
        // Regime-based adjustments
        const regimeMultipliers = {
            'trending': 1.0,      // Full Kelly in trending markets
            'weak_trend': 0.8,    // 80% of Kelly in weak trends
            'sideways': 0.6,      // 60% of Kelly in sideways markets
            'choppy': 0.3,        // 30% of Kelly in choppy markets
            'volatile': 0.2       // 20% of Kelly in volatile markets
        };
        
        const regimeMultiplier = regimeMultipliers[regime] || 0.5;
        
        // Confidence-based adjustment
        const confidenceMultiplier = Math.max(0.5, Math.min(1.5, confidence));
        
        // Calculate final position size
        let positionSize = kellyFraction * regimeMultiplier * confidenceMultiplier;
        
        // Apply safety limits
        positionSize = Math.max(0, Math.min(positionSize, 0.25)); // Cap at 25%
        
        return {
            size: positionSize,
            kellyFraction,
            regimeMultiplier,
            confidenceMultiplier,
            finalSize: positionSize
        };
    }

    // Volatility-adjusted position sizing
    calculateVolatilityPosition(atr, price, volatility, regime) {
        if (!atr || !price) return { size: 0, reason: 'Insufficient volatility data' };
        
        const currentVolatility = atr / price;
        const volatilityRatio = currentVolatility / volatility;
        
        // Base position size
        let baseSize = 0.2; // 20% base position
        
        // Adjust for volatility regime
        if (regime === 'volatile') {
            baseSize *= 0.5; // Reduce position in volatile markets
        } else if (regime === 'trending') {
            baseSize *= 1.2; // Increase position in trending markets
        }
        
        // Volatility adjustment
        if (volatilityRatio > 1.5) {
            baseSize *= 0.7; // Reduce position in high volatility
        } else if (volatilityRatio < 0.7) {
            baseSize *= 1.3; // Increase position in low volatility
        }
        
        return {
            size: Math.max(0.05, Math.min(0.4, baseSize)),
            volatilityRatio,
            adjustedSize: baseSize
        };
    }

    // Dynamic stop-loss calculation
    calculateDynamicStopLoss(atr, price, regime, signalStrength) {
        if (!atr) return { stopLoss: 0, takeProfit: 0, trailingStop: 0 };
        
        // Base multipliers by regime
        const baseMultipliers = {
            'trending': { stop: 2.0, profit: 4.0, trail: 1.5 },
            'weak_trend': { stop: 2.5, profit: 3.5, trail: 2.0 },
            'sideways': { stop: 1.8, profit: 2.5, trail: 1.2 },
            'choppy': { stop: 1.5, profit: 2.0, trail: 1.0 },
            'volatile': { stop: 3.0, profit: 5.0, trail: 2.5 }
        };
        
        const multipliers = baseMultipliers[regime] || baseMultipliers['sideways'];
        
        // Adjust based on signal strength
        const strengthMultiplier = 1 + (signalStrength - 0.5) * 0.5; // ±25% adjustment
        
        const stopDistance = atr * multipliers.stop * strengthMultiplier;
        const profitDistance = atr * multipliers.profit * strengthMultiplier;
        const trailDistance = atr * multipliers.trail * strengthMultiplier;
        
        return {
            stopLoss: price - stopDistance,
            takeProfit: price + profitDistance,
            trailingStop: price - trailDistance,
            stopDistance,
            profitDistance,
            trailDistance,
            multipliers: {
                stop: multipliers.stop * strengthMultiplier,
                profit: multipliers.profit * strengthMultiplier,
                trail: multipliers.trail * strengthMultiplier
            }
        };
    }

    // Portfolio heat management
    canTakePosition(requiredRisk, availableCapital, symbol) {
        const currentHeat = this.portfolioHeat;
        const maxHeat = this.maxPortfolioHeat * availableCapital;
        
        // Check if adding this position would exceed limits
        if (currentHeat + requiredRisk > maxHeat) {
            return {
                canTake: false,
                reason: `Portfolio heat limit exceeded (${(currentHeat / availableCapital * 100).toFixed(1)}% + ${(requiredRisk / availableCapital * 100).toFixed(1)}%)`,
                currentHeat: currentHeat,
                maxHeat: maxHeat,
                requiredRisk: requiredRisk
            };
        }
        
        // Check individual position limits
        const maxPositionRisk = availableCapital * 0.05; // Max 5% per position
        if (requiredRisk > maxPositionRisk) {
            return {
                canTake: false,
                reason: `Position risk too high (${(requiredRisk / availableCapital * 100).toFixed(1)}% > 5%)`,
                currentHeat: currentHeat,
                maxHeat: maxHeat,
                requiredRisk: requiredRisk
            };
        }
        
        return {
            canTake: true,
            reason: 'Position approved',
            currentHeat: currentHeat,
            maxHeat: maxHeat,
            requiredRisk: requiredRisk
        };
    }

    // Add position to portfolio heat
    addPosition(symbol, risk, entryPrice, quantity) {
        this.portfolioHeat += risk;
        
        this.positionHistory.set(symbol, {
            risk,
            entryPrice,
            quantity,
            timestamp: Date.now(),
            status: 'open'
        });
        
        this.updateRiskMetrics();
        
        return {
            success: true,
            newHeat: this.portfolioHeat,
            message: `Position added: ${symbol} risk $${risk.toFixed(2)}`
        };
    }

    // Close position and reduce portfolio heat
    closePosition(symbol, exitPrice, pnl) {
        const position = this.positionHistory.get(symbol);
        if (!position) {
            return { success: false, message: 'Position not found' };
        }
        
        // Reduce portfolio heat
        this.portfolioHeat = Math.max(0, this.portfolioHeat - position.risk);
        
        // Update position status
        position.status = 'closed';
        position.exitPrice = exitPrice;
        position.pnl = pnl;
        position.closeTimestamp = Date.now();
        
        // Update risk metrics
        this.updateRiskMetrics();
        
        return {
            success: true,
            newHeat: this.portfolioHeat,
            message: `Position closed: ${symbol} P&L $${pnl.toFixed(2)}`
        };
    }

    // Update risk metrics based on position history
    updateRiskMetrics() {
        const closedPositions = Array.from(this.positionHistory.values())
            .filter(p => p.status === 'closed');
        
        if (closedPositions.length === 0) return;
        
        // Calculate win rate and average win/loss
        const wins = closedPositions.filter(p => p.pnl > 0);
        const losses = closedPositions.filter(p => p.pnl < 0);
        
        this.riskMetrics.winRate = wins.length / closedPositions.length;
        
        if (wins.length > 0) {
            this.riskMetrics.avgWin = wins.reduce((sum, p) => sum + p.pnl, 0) / wins.length;
        }
        
        if (losses.length > 0) {
            this.riskMetrics.avgLoss = Math.abs(losses.reduce((sum, p) => sum + p.pnl, 0) / losses.length);
        }
        
        // Calculate current drawdown
        const totalPnl = closedPositions.reduce((sum, p) => sum + p.pnl, 0);
        if (totalPnl < this.riskMetrics.maxDrawdown) {
            this.riskMetrics.maxDrawdown = totalPnl;
        }
        this.riskMetrics.currentDrawdown = totalPnl;
        
        // Update total risk
        this.riskMetrics.totalRisk = this.portfolioHeat;
    }

    // Get portfolio heat status
    getPortfolioHeatStatus() {
        const heatPercentage = (this.portfolioHeat / this.maxPortfolioHeat) * 100;
        
        let status = 'LOW';
        let color = '🟢';
        
        if (heatPercentage > 80) {
            status = 'CRITICAL';
            color = '🔴';
        } else if (heatPercentage > 60) {
            status = 'HIGH';
            color = '🟠';
        } else if (heatPercentage > 40) {
            status = 'MEDIUM';
            color = '🟡';
        }
        
        return {
            status,
            color,
            percentage: heatPercentage,
            current: this.portfolioHeat,
            max: this.maxPortfolioHeat,
            available: this.maxPortfolioHeat - this.portfolioHeat
        };
    }

    // Reset portfolio heat (for testing or reset)
    resetPortfolioHeat() {
        this.portfolioHeat = 0;
        this.positionHistory.clear();
        this.updateRiskMetrics();
        
        return {
            success: true,
            message: 'Portfolio heat reset to 0%',
            newHeat: this.portfolioHeat
        };
    }

    // Get comprehensive risk report
    getRiskReport() {
        return {
            portfolioHeat: this.getPortfolioHeatStatus(),
            riskMetrics: this.riskMetrics,
            positionCount: this.positionHistory.size,
            openPositions: Array.from(this.positionHistory.values()).filter(p => p.status === 'open').length,
            closedPositions: Array.from(this.positionHistory.values()).filter(p => p.status === 'closed').length
        };
    }

    // Validate risk parameters
    validateRiskParameters(risk, availableCapital, symbol) {
        const errors = [];
        
        if (risk <= 0) {
            errors.push('Risk must be positive');
        }
        
        if (risk > availableCapital * 0.1) {
            errors.push('Risk exceeds 10% of available capital');
        }
        
        if (this.portfolioHeat + risk > this.maxPortfolioHeat * availableCapital) {
            errors.push('Risk would exceed maximum portfolio heat');
        }
        
        return {
            isValid: errors.length === 0,
            errors,
            warnings: []
        };
    }
}
