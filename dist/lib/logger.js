// G. Reliability & telemetry - Structured JSON logging
import fs from "fs";
import path from "path";
import dayjs from "dayjs";

export class StructuredLogger {
    constructor(logDir = "logs") {
        this.logDir = logDir;
        this.ensureLogDirectory();
        this.currentDate = dayjs().format('YYYY-MM-DD');
        this.logFile = this.getLogFilePath();
    }
    
    ensureLogDirectory() {
        if (!fs.existsSync(this.logDir)) {
            fs.mkdirSync(this.logDir, { recursive: true });
        }
    }
    
    getLogFilePath() {
        return path.join(this.logDir, `trading-${this.currentDate}.jsonl`);
    }
    
    // Log trading decision
    logDecision(symbol, price, drift, target, qty, estCost, reason, outcome) {
        const logEntry = {
            timestamp: new Date().toISOString(),
            type: 'decision',
            symbol,
            price: Number(price.toFixed(6)),
            drift: Number(drift.toFixed(6)),
            target: Number(target.toFixed(6)),
            qty: Number(qty.toFixed(6)),
            estCost: estCost ? {
                spreadCost: Number(estCost.spreadCost.toFixed(4)),
                feeCost: Number(estCost.feeCost.toFixed(4)),
                totalCost: Number(estCost.totalCost.toFixed(4)),
                totalCostPct: Number(estCost.totalCostPct.toFixed(6))
            } : null,
            reason,
            outcome,
            metadata: {
                version: '2.0.0',
                feature: 'advanced-trading-bot'
            }
        };
        
        this.writeLog(logEntry);
    }
    
    // Log trade execution
    logTrade(symbol, fromToken, toToken, qty, value, success, error = null) {
        const logEntry = {
            timestamp: new Date().toISOString(),
            type: 'trade',
            symbol,
            fromToken,
            toToken,
            qty: Number(qty.toFixed(6)),
            value: Number(value.toFixed(2)),
            success,
            error: error?.message || error,
            metadata: {
                version: '2.0.0',
                feature: 'advanced-trading-bot'
            }
        };
        
        this.writeLog(logEntry);
    }
    
    // Log protective exit
    logProtectiveExit(symbol, exitType, reason, price, entryPrice) {
        const logEntry = {
            timestamp: new Date().toISOString(),
            type: 'protective_exit',
            symbol,
            exitType,
            reason,
            price: Number(price.toFixed(6)),
            entryPrice: Number(entryPrice.toFixed(6)),
            pnl: Number(((price - entryPrice) / entryPrice * 100).toFixed(4)),
            metadata: {
                version: '2.0.0',
                feature: 'advanced-trading-bot'
            }
        };
        
        this.writeLog(logEntry);
    }
    
    // Log regime detection
    logRegime(symbol, adx, regime, action) {
        const logEntry = {
            timestamp: new Date().toISOString(),
            type: 'regime',
            symbol,
            adx: Number(adx.toFixed(2)),
            regime,
            action,
            metadata: {
                version: '2.0.0',
                feature: 'advanced-trading-bot'
            }
        };
        
        this.writeLog(logEntry);
    }
    
    // Write log entry to file
    writeLog(logEntry) {
        try {
            // Check if we need to rotate to a new day
            const currentDate = dayjs().format('YYYY-MM-DD');
            if (currentDate !== this.currentDate) {
                this.currentDate = currentDate;
                this.logFile = this.getLogFilePath();
            }
            
            const logLine = JSON.stringify(logEntry) + '\n';
            fs.appendFileSync(this.logFile, logLine);
        } catch (error) {
            console.error('Failed to write log:', error);
        }
    }
    
    // Get recent logs for analysis
    getRecentLogs(limit = 100) {
        try {
            if (!fs.existsSync(this.logFile)) return [];
            
            const content = fs.readFileSync(this.logFile, 'utf8');
            const lines = content.trim().split('\n').filter(line => line.trim());
            const logs = lines.slice(-limit).map(line => JSON.parse(line));
            
            return logs;
        } catch (error) {
            console.error('Failed to read logs:', error);
            return [];
        }
    }
    
    // Clean old log files (keep last 7 days)
    cleanOldLogs() {
        try {
            const files = fs.readdirSync(this.logDir);
            const cutoffDate = dayjs().subtract(7, 'day');
            
            for (const file of files) {
                if (file.startsWith('trading-') && file.endsWith('.jsonl')) {
                    const filePath = path.join(this.logDir, file);
                    const stats = fs.statSync(filePath);
                    const fileDate = dayjs(stats.mtime);
                    
                    if (fileDate.isBefore(cutoffDate)) {
                        fs.unlinkSync(filePath);
                        console.log(`🗑️ Cleaned old log file: ${file}`);
                    }
                }
            }
        } catch (error) {
            console.error('Failed to clean old logs:', error);
        }
    }
}
