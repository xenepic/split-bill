import { err, ok, type Result, type Share } from './types';

/**
 * 支払額を負担額へ配分する（仕様 6.1 / 6.2）。
 * shares は参加者の表示順に並んでいる前提。fixed / excluded は保持し、auto のみ再計算する。
 *
 * ここで求める auto の負担額は表示用の整数円。割り切れない場合は切り捨てた額を基本に、
 * 余りを表示順の後ろの人から1円ずつ足す（例: 1,000円を3人 → 333 / 333 / 334）。
 * 集計には整数ではなく正確な値（autoShareExact）を使い、端数は最終収支でまとめて扱う（balance.ts）。
 *
 * 支払額が負（収益）の場合は負担額も0以下になる（例: −1,000円を3人 → −334 / −333 / −333）。
 */
export function allocateShares(amount: number, shares: Share[]): Result<Share[]> {
  const split = autoShareExact(amount, shares);
  if (!split.ok) return split;
  const { rest, autoCount } = split.value;
  const base = (autoCount > 0 ? Math.floor(rest / autoCount) : 0) || 0; // -0 を正規化
  // 余り（0〜autoCount−1）を受け取る auto は表示順の後ろから
  let skip = autoCount - (autoCount > 0 ? rest - base * autoCount : 0);
  return ok(
    shares.map((s): Share => {
      if (s.mode === 'excluded') return { ...s, amount: 0 };
      if (s.mode === 'fixed') return { ...s };
      const extra = skip > 0 ? 0 : 1;
      skip--;
      return { ...s, amount: base + extra };
    }),
  );
}

/**
 * auto の正確な負担額 `rest / autoCount`（各 auto が同額）を分子・分母で返す。
 * fixed / excluded の検証もここで行う。
 */
export function autoShareExact(
  amount: number,
  shares: readonly Share[],
): Result<{ rest: number; autoCount: number }> {
  if (!Number.isSafeInteger(amount) || amount === 0) {
    return err('支払額は0以外の整数で入力してください');
  }
  // 負担額は支払額と同じ符号（または0）に揃える。sign を掛けると正の場合と同じ判定になる
  const sign = amount > 0 ? 1 : -1;
  let fixedTotal = 0;
  let autoCount = 0;
  for (const s of shares) {
    if (s.mode === 'fixed') {
      if (!Number.isSafeInteger(s.amount) || s.amount * sign < 0) return err('負担額が不正です');
      fixedTotal += s.amount;
    } else if (s.mode === 'auto') {
      autoCount++;
    }
  }
  const rest = amount - fixedTotal;
  if (rest * sign < 0) {
    return err(`固定負担額の合計（${fixedTotal.toLocaleString('ja-JP')}円）が支払額を超えています`);
  }
  if (autoCount === 0 && rest !== 0) {
    return err(
      shares.every((s) => s.mode === 'excluded')
        ? '全員が対象外のため負担者がいません'
        : `未配分の残額（${rest.toLocaleString('ja-JP')}円）があります。固定を解除するか金額を見直してください`,
    );
  }

  return ok({ rest, autoCount });
}
