# 🎯 TP/SL System Implementation

## 🚀 **Overview**

This implementation adds comprehensive Take Profit (TP), Stop Loss (SL), and Trailing Stop functionality to the trading bot with the following features:

- **Startup Mode**: Rebalance-only on restart (no flatten)
- **Auto TP/SL**: Based on average entry price and trailing high
- **Persistent State**: Position tracking survives bot restarts
- **Safe Execution**: Chunked selling respecting 25% equity rule

## ⚙️ **Configuration**

Add these environment variables to your `.env` file:

```bash
# Startup Mode
ON_START_MODE=rebalance   # Only rebalance, no flatten

# Take Profit / Stop Loss
TP_BPS=150          # +1.5% from average entry
SL_BPS=80           # -0.8% from average entry

# Trailing Stop
USE_TRAILING=true
TRAIL_BPS=100       # -1.0% from trailing high
```

## 🔧 **How It Works**

### **1. Startup Sequence**
1. Bot loads saved position state from `data/state.json`
2. **Immediate TP/SL check** on existing positions
3. **First decision cycle runs immediately** (no waiting)
4. Portfolio rebalances to strategy targets

### **2. Position State Tracking**
- **BUY trades**: Record quantity, cost basis, update trailing high
- **SELL trades**: Reduce quantity, maintain average cost basis
- **Persistent storage**: State saved to `data/state.json`

### **3. TP/SL Logic**
- **Take Profit**: Trigger when price ≥ avg_entry × (1 + TP_BPS/10000)
- **Stop Loss**: Trigger when price ≤ avg_entry × (1 - SL_BPS/10000)
- **Trailing Stop**: Trigger when price ≤ trailing_high × (1 - TRAIL_BPS/10000)

### **4. Safe Execution**
- **Chunked selling**: Respects 25% equity per trade rule
- **Cooldown spacing**: Configurable delay between chunks
- **Error handling**: Graceful fallback on execution failures

## 📊 **File Structure**

```
dist/
├── lib/
│   ├── state.js          # Position state management
│   ├── tpsl.js           # TP/SL execution logic
│   └── ...
├── run.js                # Main bot with TP/SL integration
└── ...
data/
└── state.json            # Persistent position state
```

## 🧪 **Testing Scenarios**

### **Test 1: TP Trigger on Restart**
1. Open positions, stop bot
2. Bump price up > TP threshold
3. Restart bot → Verify TP triggers sell before rebalance

### **Test 2: SL Trigger on Restart**
1. Open positions, stop bot
2. Bump price down < SL threshold
3. Restart bot → Verify SL triggers sell before rebalance

### **Test 3: Trailing Stop**
1. Open positions, let price rise
2. Price falls from high > trailing threshold
3. Verify trailing stop triggers

### **Test 4: Normal Restart**
1. Restart with no TP/SL hits
2. Verify no immediate sells
3. First loop rebalances to targets

## 🔍 **Monitoring**

### **Console Output**
```
[STARTUP] Checking TP/SL conditions on existing positions...
[TP/SL] WETH qty=2.5 avg=2500.00 px=2537.50 reason=TP
[TP/SL] WETH: Selling 2.5 in 1 chunks (2.500000 per chunk)
[STARTUP] TP/SL check completed
```

### **State File**
```json
{
  "pos": {
    "WETH": {
      "qty": 0,
      "cost": 0,
      "trailingHigh": 2537.50
    }
  }
}
```

## ⚠️ **Important Notes**

1. **First Run**: No TP/SL until position state is established
2. **Equity Calculation**: Based on current portfolio balances
3. **Chunking**: Automatically splits large sells into smaller chunks
4. **Persistence**: State survives bot restarts and crashes

## 🚀 **Next Steps**

1. **Set environment variables** in your `.env` file
2. **Test with DRY_RUN=true** first
3. **Monitor startup behavior** and TP/SL triggers
4. **Switch to live trading** when confident

## 🔧 **Troubleshooting**

### **TP/SL Not Triggering**
- Check position state exists in `data/state.json`
- Verify environment variables are set correctly
- Check console for TP/SL check messages

### **State Not Persisting**
- Ensure `data/` directory is writable
- Check file permissions on `state.json`
- Verify no disk space issues

### **Execution Errors**
- Check API connectivity
- Verify token configurations
- Review chunking logic and cooldowns
