import { err, ok, type Result, type Share } from './types';

/**
 * 支払額を負担額へ配分する（仕様 6.1 / 6.2）。
 * shares は参加者の表示順に並んでいる前提。fixed / excluded は保持し、auto のみ再計算する。
 *
 * 割り切れない場合の端数: 支払者だけが得をするよう、支払者以外の auto は切り上げ額
 * `ceil(R/m)` を負担し、支払者（auto の場合）が残りを負担する。
 * 例: 1,000円を3人（支払者含む）→ 支払者 332円、他 334円ずつ。
 * 支払者が auto でない場合や、金額が小さく支払者の負担が負になる場合は、
 * 余りを表示順に1円ずつ配分する。
 */
export function allocateShares(
  amount: number,
  shares: Share[],
  payerId: string | null = null,
): Result<Share[]> {
  if (!Number.isSafeInteger(amount) || amount <= 0) {
    return err('支払額は1円以上の整数で入力してください');
  }
  let fixedTotal = 0;
  let autoCount = 0;
  for (const s of shares) {
    if (s.mode === 'fixed') {
      if (!Number.isSafeInteger(s.amount) || s.amount < 0) return err('負担額が不正です');
      fixedTotal += s.amount;
    } else if (s.mode === 'auto') {
      autoCount++;
    }
  }
  const rest = amount - fixedTotal;
  if (rest < 0) {
    return err(`固定負担額の合計（${fixedTotal.toLocaleString('ja-JP')}円）が支払額を超えています`);
  }
  if (autoCount === 0 && rest !== 0) {
    return err(
      shares.every((s) => s.mode === 'excluded')
        ? '全員が対象外のため負担者がいません'
        : `未配分の残額（${rest.toLocaleString('ja-JP')}円）があります。固定を解除するか金額を見直してください`,
    );
  }

  const payerIsAuto = shares.some((s) => s.personId === payerId && s.mode === 'auto');
  const ceil = autoCount > 0 ? Math.ceil(rest / autoCount) : 0;
  const payerAmount = rest - (autoCount - 1) * ceil;
  if (payerIsAuto && payerAmount >= 0) {
    return ok(
      shares.map((s): Share => {
        if (s.mode === 'excluded') return { ...s, amount: 0 };
        if (s.mode === 'fixed') return { ...s };
        return { ...s, amount: s.personId === payerId ? payerAmount : ceil };
      }),
    );
  }

  // 表示順に余りを1円ずつ配分
  const base = autoCount > 0 ? Math.floor(rest / autoCount) : 0;
  let remainder = autoCount > 0 ? rest - base * autoCount : 0;
  return ok(
    shares.map((s): Share => {
      if (s.mode === 'excluded') return { ...s, amount: 0 };
      if (s.mode === 'fixed') return { ...s };
      const extra = remainder > 0 ? 1 : 0;
      remainder -= extra;
      return { ...s, amount: base + extra };
    }),
  );
}
