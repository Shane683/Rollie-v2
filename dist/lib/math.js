export function ema(prevEma, price, length) {
    const k = 2 / (length + 1);
    return prevEma === null ? price : (price - prevEma) * k + prevEma;
}
export function stdev(values) {
    if (values.length < 2)
        return 0;
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    const variance = values.reduce((acc, v) => acc + (v - mean) ** 2, 0) / (values.length - 1);
    return Math.sqrt(variance);
}
export function sleep(ms) {
    return new Promise((res) => setTimeout(res, ms));
}
