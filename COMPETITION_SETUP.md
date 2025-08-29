# 🏆 Competition Setup Guide - Live Trading

## 🚀 **Ready for Live Trading!**

Your crypto trading bot is now **100% competition-ready** with:
- ✅ **Real API Integration** - No more simulation
- ✅ **Live Price Feeds** - Real-time market data
- ✅ **Automatic TP/SL** - Risk management built-in
- ✅ **Buy/Sell Signals** - Both entry and exit logic
- ✅ **Multi-Chain Support** - Ethereum, Solana, and more
- ✅ **Competition Optimized** - 2000+ volume target ready

## 🔑 **Required Setup**

### 1. **Get Your Recall API Key**
- Visit: [https://recall.ai](https://recall.ai)
- Sign up and get your API key
- **This is required** - no API key = no trading

### 2. **Create .env File**
Create a file named `.env` in your project root with:

```bash
# REQUIRED - Your API key from Recall
RECALL_API_KEY=your_actual_api_key_here

# Trading Configuration
DRY_RUN=false                    # Set to false for LIVE TRADING
PRICE_POLL_SEC=10               # Price update frequency
TP_BPS=100                      # Take profit: 1% (100 basis points)
SL_BPS=50                       # Stop loss: 0.5% (50 basis points)
USE_TRAILING=true               # Enable trailing stops
TRAIL_BPS=30                    # Trailing stop: 0.3% (30 basis points)

# Competition Settings
AGGRESSIVE_MODE=true            # Enable for competition
VOLUME_BOOST_MODE=true          # Boost trading volume
MIN_VOLUME_USD=150             # Minimum trade size
MAX_DAILY_TRADES=50            # Maximum trades per day
TARGET_DAILY_VOLUME=2000       # Target volume for competition

# Trading Tokens
TRADE_TOKENS=WETH,WBTC,SOL,MATIC,AVAX,UNI,AAVE,LINK
BASE=USDC                       # Base trading currency
```

## 🚨 **IMPORTANT WARNINGS**

### **LIVE TRADING = REAL MONEY AT RISK**
- ⚠️ **Real trades will be executed**
- ⚠️ **Real money can be lost**
- ⚠️ **Start with small amounts**
- ⚠️ **Test thoroughly first**

### **Safety First**
1. **Start with DRY_RUN=true** to test
2. **Use small position sizes** initially
3. **Monitor closely** during first runs
4. **Have stop-losses configured**

## 🎯 **How to Start**

### **Step 1: Test Mode (Safe)**
```bash
# Set in .env file
DRY_RUN=true

# Run the bot
cd dist
node run-advanced.js
```

### **Step 2: Live Mode (Real Trading)**
```bash
# Set in .env file
DRY_RUN=false

# Run the bot
cd dist
node run-advanced.js
```

## 📊 **What You'll See**

### **Startup Display**
```
🚀 ADVANCED CRYPTO TRADING STRATEGY STARTING 🚀
🏆 COMPETITION MODE: READY FOR LIVE TRADING 🏆
🔑 Trading Mode: LIVE TRADING (Real money at risk!)
```

### **Live Trading Logs**
```
💰 WETH on eth: $3019.9678
🚀 EXECUTING BUY: 0.0331 WETH at $3019.97 ($100.00)
✅ SUCCESS: Bought 0.0331 at $3019.97
```

### **TP/SL Execution**
```
🚀 EXECUTING EXIT: 0.0331 WETH at $3050.00 ($100.85) - Reason: Take Profit triggered
✅ SUCCESS: Exited position of 0.0331 at $3050.00
```

## 🔧 **Competition Features**

### **Volume Optimization**
- **Target**: $2000+ daily volume
- **Strategy**: Aggressive mode enabled
- **Tokens**: 8 major cryptocurrencies
- **Chains**: Multi-chain support

### **Risk Management**
- **Stop Loss**: Automatic 0.5% stops
- **Take Profit**: Automatic 1% targets
- **Trailing Stops**: Dynamic 0.3% trailing
- **Portfolio Heat**: Max 15% risk exposure

### **Technical Analysis**
- **Multi-timeframe EMAs**
- **RSI divergence detection**
- **MACD momentum confirmation**
- **Bollinger Bands mean reversion**
- **Volume-weighted signals**

## 🚀 **Ready to Compete?**

1. **Get your API key** from Recall
2. **Set up your .env file**
3. **Start with DRY_RUN=true**
4. **Switch to DRY_RUN=false** when ready
5. **Monitor and adjust** as needed

## 🆘 **Need Help?**

- **API Issues**: Check your Recall API key
- **Trading Problems**: Verify your .env configuration
- **Strategy Questions**: Review the strategy logs
- **Emergency Stop**: Press Ctrl+C to stop the bot

**Good luck in the competition! 🏆🚀**
