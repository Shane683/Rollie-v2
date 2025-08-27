// G. Reliability & telemetry - Retry with exponential backoff
export class RetryManager {
    constructor(maxRetries = 3, baseDelay = 1000) {
        this.maxRetries = maxRetries;
        this.baseDelay = baseDelay;
    }
    
    // Retry function with exponential backoff
    async retry(operation, context = '') {
        let lastError;
        
        for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
            try {
                return await operation();
            } catch (error) {
                lastError = error;
                
                // Don't retry on client errors (4xx) except rate limits
                if (error.response?.status >= 400 && error.response?.status < 500 && error.response?.status !== 429) {
                    throw error;
                }
                
                // Don't retry on last attempt
                if (attempt === this.maxRetries) {
                    break;
                }
                
                // Calculate delay with exponential backoff
                const delay = this.baseDelay * Math.pow(2, attempt);
                const jitter = Math.random() * 0.1 * delay; // Add 10% jitter
                const totalDelay = delay + jitter;
                
                console.warn(`⚠️ [${context}] Attempt ${attempt + 1} failed: ${error.message}. Retrying in ${totalDelay.toFixed(0)}ms...`);
                
                await this.sleep(totalDelay);
            }
        }
        
        console.error(`❌ [${context}] All ${this.maxRetries + 1} attempts failed. Last error:`, lastError?.message);
        throw lastError;
    }
    
    // Sleep utility
    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
    
    // Retry specific HTTP operations
    async retryHttpRequest(requestFn, context = '') {
        return this.retry(async () => {
            try {
                return await requestFn();
            } catch (error) {
                // Log specific error details for debugging
                if (error.response) {
                    console.warn(`[${context}] HTTP ${error.response.status}: ${error.response.statusText}`);
                    if (error.response.status === 429) {
                        console.warn(`[${context}] Rate limited, will retry with backoff`);
                    }
                }
                throw error;
            }
        }, context);
    }
    
    // Retry trade execution specifically
    async retryTradeExecution(tradeFn, symbol, context = '') {
        return this.retry(async () => {
            try {
                return await tradeFn();
            } catch (error) {
                console.warn(`[${context}] Trade execution failed for ${symbol}: ${error.message}`);
                
                // Special handling for different error types
                if (error.response?.status === 429) {
                    console.warn(`[${context}] Rate limited on trade execution for ${symbol}`);
                } else if (error.response?.status >= 500) {
                    console.warn(`[${context}] Server error on trade execution for ${symbol}, will retry`);
                }
                
                throw error;
            }
        }, `trade-${symbol}`);
    }
}
