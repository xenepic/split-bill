import { err, ok, SUPPORTED_ROUNDING_UNITS, type Result } from './types';

export type RoundedBalance = {
  originalBalance: number;
  settlementBalance: number;
  /** settlementBalance - originalBalance。正は得、負は損。 */
  delta: number;
};

/** 丸め単位として計算上有効か（正の安全な整数） */
export function isValidRoundingUnit(unit: unknown): unit is number {
  return typeof unit === 'number' && Number.isSafeInteger(unit) && unit > 0;
}

/** UI で選択可能な丸め単位か */
export function isSupportedRoundingUnit(unit: unknown): boolean {
  return isValidRoundingUnit(unit) && (SUPPORTED_ROUNDING_UNITS as readonly number[]).includes(unit);
}

const floorTo = (b: number, unit: number) => Math.floor(b / unit) * unit;
const ceilTo = (b: number, unit: number) => Math.ceil(b / unit) * unit;

type Score = [sumAbs: number, negPayerBenefit: number, negReceiverBenefit: number];

function addScore(a: Score, b: Score): Score {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

function compareScore(a: Score, b: Score): number {
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] - b[i];
  return 0;
}

/**
 * 各人の純残高を unit の倍数へ丸める（仕様 8.2〜8.4）。
 * balances / paidAmounts は参加者の表示順。
 *
 * 必須条件: 各人は直近の下側・上側の倍数のみ、sum = 0、|delta| <= unit - 1、符号反転なし。
 * 選択順位: (1) max|delta| 最小 → (2) sum|delta| 最小 → (3) 立替支払者の利益合計最大
 *          → (4) 純受取人の利益合計最大 → (5) 表示順で先頭ほど下側候補を優先。
 */
export function roundBalances(
  balances: readonly number[],
  paidAmounts: readonly number[],
  unit: number,
): Result<RoundedBalance[]> {
  if (!isValidRoundingUnit(unit)) return err('丸め単位が不正です');
  if (balances.length !== paidAmounts.length) return err('入力の長さが一致しません');
  if (!balances.every((b) => Number.isSafeInteger(b))) return err('純残高が整数ではありません');
  if (!paidAmounts.every((p) => Number.isSafeInteger(p) && p >= 0)) return err('支払額が不正です');
  if (balances.reduce((s, b) => s + b, 0) !== 0) return err('純残高の合計が0ではありません');

  const n = balances.length;
  const lo = balances.map((b) => floorTo(b, unit) + 0); // +0 で -0 を正規化
  const hi = balances.map((b) => ceilTo(b, unit) + 0);
  const dLo = balances.map((b, i) => lo[i] - b); // <= 0
  const dHi = balances.map((b, i) => hi[i] - b); // >= 0
  const switchable = balances.map((_, i) => lo[i] !== hi[i]);
  const k = -lo.reduce((s, v) => s + v, 0) / unit;
  const switchableCount = switchable.filter(Boolean).length;
  if (!Number.isInteger(k) || k < 0 || k > switchableCount) {
    return err('丸め候補の組み合わせを構成できません（内部不整合）');
  }

  // (1) 最大差額の最小値 T を求める
  const thresholds = Array.from(
    new Set([0, ...balances.flatMap((_, i) => (switchable[i] ? [-dLo[i], dHi[i]] : []))]),
  ).sort((a, b) => a - b);
  const feasible = (t: number) => {
    let must = 0;
    let can = 0;
    for (let i = 0; i < n; i++) {
      if (!switchable[i]) continue;
      const allowLo = -dLo[i] <= t;
      const allowHi = dHi[i] <= t;
      if (!allowLo && !allowHi) return false;
      if (allowHi) can++;
      if (!allowLo) must++;
    }
    return must <= k && k <= can;
  };
  const threshold = thresholds.find(feasible);
  if (threshold === undefined) return err('丸め候補の組み合わせを構成できません（内部不整合）');

  // (2)〜(5) 閾値内の候補で DP。best[i][j] = 人 i 以降で j 人を上側へ切り替える最良スコア。
  // 後ろから計算し、同点時は下側を選ぶことで表示順に辞書式最小の選択列となる。
  const scoreOf = (i: number, d: number): Score => [
    Math.abs(d),
    paidAmounts[i] > 0 ? -d : 0,
    balances[i] > 0 ? -d : 0,
  ];
  const INF: Score = [Infinity, Infinity, Infinity];
  const best: Score[][] = Array.from({ length: n + 1 }, () => Array<Score>(k + 1).fill(INF));
  const choice: (0 | 1)[][] = Array.from({ length: n + 1 }, () => Array<0 | 1>(k + 1).fill(0));
  best[n][0] = [0, 0, 0];
  for (let i = n - 1; i >= 0; i--) {
    for (let j = 0; j <= k; j++) {
      let bestHere = INF;
      let pick: 0 | 1 = 0;
      const loAllowed = !switchable[i] || -dLo[i] <= threshold;
      if (loAllowed && best[i + 1][j][0] !== Infinity) {
        bestHere = addScore(scoreOf(i, dLo[i]), best[i + 1][j]);
      }
      if (switchable[i] && dHi[i] <= threshold && j > 0 && best[i + 1][j - 1][0] !== Infinity) {
        const cand = addScore(scoreOf(i, dHi[i]), best[i + 1][j - 1]);
        if (compareScore(cand, bestHere) < 0) {
          bestHere = cand;
          pick = 1;
        }
      }
      best[i][j] = bestHere;
      choice[i][j] = pick;
    }
  }
  if (best[0][k][0] === Infinity) return err('丸め候補の組み合わせを構成できません（内部不整合）');

  const result: RoundedBalance[] = [];
  let j = k;
  for (let i = 0; i < n; i++) {
    const r = choice[i][j] === 1 ? hi[i] : lo[i];
    if (choice[i][j] === 1) j--;
    result.push({ originalBalance: balances[i], settlementBalance: r, delta: r - balances[i] });
  }

  // 事後検証
  const sumDelta = result.reduce((s, r) => s + r.delta, 0);
  const valid =
    sumDelta === 0 &&
    result.every(
      (r) =>
        r.settlementBalance % unit === 0 &&
        Math.abs(r.delta) <= unit - 1 &&
        !(r.originalBalance > 0 && r.settlementBalance < 0) &&
        !(r.originalBalance < 0 && r.settlementBalance > 0) &&
        !(r.originalBalance === 0 && r.settlementBalance !== 0),
    );
  if (!valid) return err('丸め結果の検証に失敗しました（内部不整合）');
  return ok(result);
}
