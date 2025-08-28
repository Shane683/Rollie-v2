import dayjs from "dayjs";
import "dotenv/config";
function midnightISO() {
    return dayjs().startOf("day").toISOString();
}
function withinToday(ts) {
    const t = dayjs(ts);
    return t.isAfter(dayjs().startOf("day"));
}
export async function ensureDailyQuota(adapter, opts = {}) {
  const minDailyTrades    = Number(opts.minDailyTrades ?? 0);
  const quotaTradeUsd     = Number(opts.quotaTradeUsd ?? 150);
  const tokensCsv         = String(opts.tokensCsv ?? "");
  const targetDailyVolume = Number(opts.targetDailyVolume ?? 0);
  const dryRun            = Boolean(opts.dryRun);

  // disabled? exit silently
  if ((minDailyTrades <= 0) && (targetDailyVolume <= 0)) {
    return { ok: true, action: "disabled" };
  }

  const TOKEN_LIST = tokensCsv
    .split(",")
    .map(s => s.trim().toUpperCase())
    .filter(Boolean);

  // --- read today's trades via adapter (your existing implementation) ---
  const trades = await adapter.listTrades?.({ sinceStartOfDay: true }).catch(()=>[]);
  const done = Array.isArray(trades) ? trades.filter(t =>
    (t.status === "completed" || t.success === true)
  ) : [];

  const count = done.length;
  if (count >= minDailyTrades) {
    return { ok: true, action: "enough", count };
  }

  const deficit = Math.max(0, minDailyTrades - count);
  console.log(`[QUOTA] Need ${deficit} more trades to meet daily minimum of ${minDailyTrades}`);

  // simple filler logic (respect your rate limits / cool-down):
  if (deficit > 0 && TOKEN_LIST.length) {
    // choose tokens in round-robin and trade 'quotaTradeUsd' each
    for (let i = 0; i < deficit; i++) {
      const sym = TOKEN_LIST[i % TOKEN_LIST.length];
      try {
        if (!dryRun) {
          await adapter.tradeExecute?.({
            fromToken: "USDC",
            toToken: sym,
            notionalUsd: quotaTradeUsd,
            reason: "quota-fill"
          });
        }
      } catch (e) {
        console.log("[QUOTA] filler trade failed:", e?.message ?? e);
      }
    }
  }

  return { ok: true, action: "filled", filled: deficit };
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
