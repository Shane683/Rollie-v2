import dayjs from "dayjs";
import "dotenv/config";
function midnightISO() {
    return dayjs().startOf("day").toISOString();
}
function withinToday(ts) {
    const t = dayjs(ts);
    return t.isAfter(dayjs().startOf("day"));
}
export async function ensureDailyQuota(api, opts) {
    const MIN_DAILY = Number(process.env.MIN_DAILY_TRADES ?? "5");
    const LOT_USD = Number(process.env.QUOTA_TRADE_USD ?? "150"); // Increased for contest
    const TOKEN_LIST = (process.env.QUOTA_TOKENS ?? "WETH,WBTC,SOL")
        .split(",")
        .map((s) => s.trim().toUpperCase())
        .filter(Boolean);
    const BASE_SYM = (process.env.QUOTA_BASE ?? "USDC").toUpperCase();
    const AGGRESSIVE_MODE = process.env.AGGRESSIVE_MODE === "true";
    const baseAddr = api.addrOf(BASE_SYM);
    const basePrice = 1; // USDC ~ $1
    // 1) Lấy lịch sử lệnh hôm nay
    const { trades } = await api.recentTrades();
    // Contest mode: Better trade filtering
    const today = trades.filter((t) => {
        const isToday = withinToday(t.timestamp);
        const isSuccessful = t.status === "completed" || t.success === true;
        return isToday && isSuccessful;
    });
    const count = today.length;
    if (count >= MIN_DAILY) {
        return { ok: true, action: "enough", count };
    }
    const deficit = MIN_DAILY - count;
    const dry = !!opts?.dryRun;
    // Contest mode: More aggressive quota management
    console.log(`[QUOTA] Contest mode: Need ${deficit} more trades to meet daily minimum of ${MIN_DAILY}`);
    // 2) Bắn các lệnh "nhẹ" để bù quota - Contest optimized
    //    Chiến lược: vòng qua các token trong QUOTA_TOKENS, mỗi token thực hiện cặp BUY/SELL nhỏ
    //    đến khi đủ số lệnh. Mỗi BUY/SELL ~ LOT_USD (giá trị khoảng).
    let placed = 0;
    const actions = [];
    // Contest mode: Rotate through tokens more efficiently
    const tokenRotation = AGGRESSIVE_MODE ?
        [...TOKEN_LIST, ...TOKEN_LIST, ...TOKEN_LIST] : // More aggressive rotation
        TOKEN_LIST;
    for (const sym of tokenRotation) {
        if (placed >= deficit)
            break;
        const quoteAddr = api.addrOf(sym);
        const px = sym === BASE_SYM ? 1 : await api.price(quoteAddr);
        // Contest mode: Ensure minimum trade size
        const effectiveLotSize = Math.max(LOT_USD, 100); // At least 100 USDC
        const qty = Number((effectiveLotSize / px).toFixed(6));
        // BUY: BASE -> QUOTE
        if (placed < deficit) {
            if (dry) {
                actions.push(`[DRY] BUY ${sym} qty=${qty} @~${px} ($${effectiveLotSize})`);
            }
            else {
                await api.execute(baseAddr, quoteAddr, qty, `Contest quota buy ${sym} LOT=${effectiveLotSize}`);
                console.log(`[QUOTA] Executed BUY ${sym} for quota: $${effectiveLotSize}`);
            }
            placed += 1;
            // Contest mode: Small delay between trades
            if (AGGRESSIVE_MODE && !dry) {
                await new Promise(resolve => setTimeout(resolve, 2000));
            }
        }
        // SELL: QUOTE -> BASE
        if (placed < deficit) {
            if (dry) {
                actions.push(`[DRY] SELL ${sym} qty=${qty} @~${px} ($${effectiveLotSize})`);
            }
            else {
                await api.execute(quoteAddr, baseAddr, qty, `Contest quota sell ${sym} LOT=${effectiveLotSize}`);
                console.log(`[QUOTA] Executed SELL ${sym} for quota: $${effectiveLotSize}`);
            }
            placed += 1;
            // Contest mode: Small delay between trades
            if (AGGRESSIVE_MODE && !dry) {
                await new Promise(resolve => setTimeout(resolve, 2000));
            }
        }
    }
    // Contest mode: If still not enough, try additional strategies
    if (placed < deficit && AGGRESSIVE_MODE) {
        console.log(`[QUOTA] Contest mode: Still need ${deficit - placed} more trades, trying additional strategies...`);
        // Try smaller trades with different token pairs
        for (let i = 0; i < deficit - placed; i++) {
            const sym = TOKEN_LIST[i % TOKEN_LIST.length];
            const quoteAddr = api.addrOf(sym);
            const px = sym === BASE_SYM ? 1 : await api.price(quoteAddr);
            const qty = Number((100 / px).toFixed(6)); // Minimum 100 USDC
            if (dry) {
                actions.push(`[DRY] Additional BUY ${sym} qty=${qty} @~${px} ($100)`);
            }
            else {
                await api.execute(baseAddr, quoteAddr, qty, `Contest additional quota ${sym}`);
                console.log(`[QUOTA] Additional quota trade: BUY ${sym} for $100`);
                await new Promise(resolve => setTimeout(resolve, 1500));
            }
            placed += 1;
        }
    }
    return {
        ok: true,
        action: dry ? "dry-run" : "executed",
        countBefore: count,
        added: placed,
        details: actions,
        contestMode: AGGRESSIVE_MODE,
    };
}
/**
 * Lập lịch kiểm tra quota theo phút - Contest optimized.
 * - Mỗi QUOTA_CHECK_EVERY_MIN phút kiểm tra 1 lần.
 * - Nếu gần QUOTA_WINDOW_END (vd 23:30) mà vẫn thiếu → bù ngay.
 * - Contest mode: More frequent checks
 */
export function scheduleQuotaGuard(runOnce) {
    const INTERVAL_MIN = Number(process.env.QUOTA_CHECK_EVERY_MIN ?? "10"); // More frequent for contest
    const WINDOW_END = (process.env.QUOTA_WINDOW_END ?? "23:30").trim();
    const AGGRESSIVE_MODE = process.env.AGGRESSIVE_MODE === "true";
    const tick = async () => {
        const now = dayjs();
        const [hh, mm] = WINDOW_END.split(":").map((x) => Number(x));
        const end = now.hour(hh).minute(mm).second(0).millisecond(0);
        // Kiểm tra định kỳ
        await runOnce();
        // Contest mode: More aggressive end-of-day check
        if (AGGRESSIVE_MODE) {
            // Check 2 hours before window end
            const earlyCheck = end.subtract(2, 'hour');
            if (now.isAfter(earlyCheck) && now.isBefore(end)) {
                console.log(`[QUOTA] Contest mode: Early end-of-day quota check`);
                await runOnce();
            }
        }
        // Nếu đã qua giờ cửa sổ cuối ngày → kiểm tra lần nữa cho chắc
        if (now.isAfter(end)) {
            console.log(`[QUOTA] End-of-day quota check`);
            await runOnce();
        }
    };
    // Chạy ngay 1 lần khi start
    tick().catch(() => { });
    // Lặp theo phút - Contest mode: More frequent
    const interval = AGGRESSIVE_MODE ? Math.min(INTERVAL_MIN, 5) : INTERVAL_MIN;
    setInterval(() => tick().catch(() => { }), interval * 60 * 1000);
    console.log(`[QUOTA] Contest mode: ${AGGRESSIVE_MODE ? 'ENABLED' : 'DISABLED'}, checking every ${interval} minutes`);
}
