// D. Costs & spread guard utilities
export class CostEstimator {
    constructor() {
        // Conservative cost estimates (can be updated based on API data)
        this.defaultSpread = 0.001; // 0.1% default spread
        this.defaultFees = 0.002;   // 0.2% default fees
        this.minEdgeThreshold = 0.005; // 0.5% minimum edge required
    }
    
    // Estimate total cost (spread + fees) for a trade
    estimateCost(tokenPrice, tradeValue, customSpread = null, customFees = null) {
        const spread = customSpread ?? this.defaultSpread;
        const fees = customFees ?? this.defaultFees;
        
        const spreadCost = tradeValue * spread;
        const feeCost = tradeValue * fees;
        const totalCost = spreadCost + feeCost;
        
        return {
            spreadCost,
            feeCost,
            totalCost,
            totalCostPct: totalCost / tradeValue
        };
    }
    
    // Check if trade has sufficient edge to cover costs
    hasSufficientEdge(expectedReturn, estimatedCost) {
        return expectedReturn > (estimatedCost.totalCostPct + this.minEdgeThreshold);
    }
    
    // Calculate expected return based on position drift
    calculateExpectedReturn(drift, volatility) {
        // Simple model: expected return based on drift and volatility
        const baseReturn = Math.abs(drift) * 0.5; // Assume 50% of drift is captured
        const volatilityAdjustment = Math.max(0, 1 - volatility * 2); // Reduce expectation in high vol
        return baseReturn * volatilityAdjustment;
    }
    
    // Get cost estimate for a specific token (can be extended with API data)
    async getTokenCosts(symbol, tradeValue) {
        // TODO: Integrate with API to get real-time spread and fee data
        // For now, return conservative estimates
        return this.estimateCost(0, tradeValue);
    }
}
