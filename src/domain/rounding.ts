import { err, ok, SUPPORTED_ROUNDING_UNITS, type Result } from './types';

export type RoundedBalance = {
  originalBalance: number;
  settlementBalance: number;
  /** settlementBalance - originalBalance。正は得、負は損。 */
  delta: number;
};

/**
 * - grouped: 元の収支が同額の人を同額にそろえた丸め（通常はこちら）
 * - individual: そろえると損が (2*unit - 1) 円を超えるため、個人ごとに丸めた結果
 */
export type RoundingMethod = 'grouped' | 'individual';

export type RoundingResult = {
  method: RoundingMethod;
  balances: RoundedBalance[];
};

/** 丸め単位として計算上有効か（正の安全な整数） */
export function isValidRoundingUnit(unit: unknown): unit is number {
  return typeof unit === 'number' && Number.isSafeInteger(unit) && unit > 0;
}

/** UI で選択可能な丸め単位か */
export function isSupportedRoundingUnit(unit: unknown): boolean {
  return isValidRoundingUnit(unit) && (SUPPORTED_ROUNDING_UNITS as readonly number[]).includes(unit);
}

const floorTo = (b: number, unit: number) => Math.floor(b / unit) * unit + 0; // +0 で -0 を正規化
const ceilTo = (b: number, unit: number) => Math.ceil(b / unit) * unit + 0;

/** 支払総額が多い順（同額なら表示順）の参加者インデックス */
export function payerPriority(paidAmounts: readonly number[]): number[] {
  return paidAmounts.map((_, i) => i).sort((a, b) => paidAmounts[b] - paidAmounts[a] || a - b);
}

/**
 * 各人の純残高を unit の倍数へ丸める（仕様 8.2〜8.4、v1.2 改訂方針）。
 * balances / paidAmounts は参加者の表示順。
 *
 * 共通の必須条件: 合計0、unit の倍数、符号反転なし（元の0円は0円のまま）。
 *
 * 1) 同額そろえ方式（grouped）
 *    必須: 元の収支が同額の人は同額。払う側（収支マイナス）の得は unit 円まで。
 *          受け取る側（収支プラス）の得は上限なし。
 *    選択: (1) 最大の損を最小化 → (2) 損の合計を最小化
 *          → (3) 支払総額が多い人ほど得が大きい（支払総額の降順に差額を辞書式で最大化）。
 *    (1) の最大の損が 2*unit - 1 円（50円丸めなら99円）を超える場合は 2) へ切り替える。
 *
 * 2) 個人方式（individual）
 *    必須: 各人は直近の下側・上側の倍数のみ（|差額| <= unit - 1）。同額の人が分かれることがある。
 *    選択: (1) 最大の |差額| を最小化 → (2) |差額| の合計を最小化
 *          → (3) 支払総額が多い人ほど得が大きい。
 */
export function roundBalances(
  balances: readonly number[],
  paidAmounts: readonly number[],
  unit: number,
): Result<RoundingResult> {
  if (!isValidRoundingUnit(unit)) return err('丸め単位が不正です');
  if (balances.length !== paidAmounts.length) return err('入力の長さが一致しません');
  if (!balances.every((b) => Number.isSafeInteger(b))) return err('純残高が整数ではありません');
  if (!paidAmounts.every((p) => Number.isSafeInteger(p))) return err('支払額が不正です');
  if (balances.reduce((s, b) => s + b, 0) !== 0) return err('純残高の合計が0ではありません');

  const grouped = roundGrouped(balances, paidAmounts, unit);
  if (grouped) {
    return validate(balances, grouped, unit, 'grouped') ? ok({ method: 'grouped', balances: grouped }) : invalid();
  }
  const individual = roundIndividually(balances, paidAmounts, unit);
  if (!individual) return err('丸め候補の組み合わせを構成できません（内部不整合）');
  return validate(balances, individual, unit, 'individual')
    ? ok({ method: 'individual', balances: individual })
    : invalid();
}

function invalid<T>(): Result<T> {
  return err('丸め結果の検証に失敗しました（内部不整合）');
}

function validate(balances: readonly number[], result: RoundedBalance[], unit: number, method: RoundingMethod) {
  if (result.reduce((s, r) => s + r.delta, 0) !== 0) return false;
  const byBalance = new Map<number, number>();
  return result.every((r) => {
    const { originalBalance: b, settlementBalance: s, delta } = r;
    if (s % unit !== 0) return false;
    if ((b > 0 && s < 0) || (b < 0 && s > 0) || (b === 0 && s !== 0)) return false;
    if (method === 'individual') return Math.abs(delta) <= unit - 1;
    if (-delta > 2 * unit - 1) return false;
    if (b < 0 && delta > unit) return false;
    const prev = byBalance.get(b);
    byBalance.set(b, s);
    return prev === undefined || prev === s;
  }) && result.length === balances.length;
}

type Group = {
  members: number[];
  size: number;
  balance: number;
  lo: number; // 下側の倍数
  c: number; // balance - lo（0 <= c < unit）
  receiver: boolean;
};

/**
 * 同額そろえ方式。各グループは settlement = lo + unit * t（t は整数）とし、
 * sum(size * t) = K を満たす t を探す。最大の損が 2*unit-1 を超えるなら null。
 */
function roundGrouped(
  balances: readonly number[],
  paidAmounts: readonly number[],
  unit: number,
): RoundedBalance[] | null {
  const priority = payerPriority(paidAmounts);
  const byBalance = new Map<number, number[]>();
  for (const i of priority) {
    if (balances[i] === 0) continue;
    const list = byBalance.get(balances[i]) ?? [];
    list.push(i);
    byBalance.set(balances[i], list);
  }
  // グループは「最も支払総額が多いメンバー」の優先順に並ぶ（Map は挿入順）
  const groups: Group[] = [...byBalance.entries()].map(([balance, members]) => {
    const lo = floorTo(balance, unit);
    return { members, size: members.length, balance, lo, c: balance - lo, receiver: balance > 0 };
  });
  const K = -groups.reduce((s, g) => s + g.size * g.lo, 0) / unit;

  const maxAllowedLoss = 2 * unit - 1;
  // 最大の損の候補値（c + unit*j）を小さい順に試す
  const candidates = Array.from(
    new Set([0, ...groups.flatMap((g) => [0, 1, 2].map((j) => g.c + unit * j))]),
  )
    .filter((l) => l <= maxAllowedLoss)
    .sort((a, b) => a - b);

  for (const maxLoss of candidates) {
    const ts = solveGroups(groups, K, unit, maxLoss);
    if (!ts) continue;
    const result: RoundedBalance[] = balances.map((b) => ({ originalBalance: b, settlementBalance: 0, delta: -b }));
    groups.forEach((g, gi) => {
      const s = g.lo + unit * ts[gi] + 0;
      for (const i of g.members) result[i] = { originalBalance: g.balance, settlementBalance: s, delta: s - g.balance };
    });
    return result;
  }
  return null;
}

type Best = { loss: number; ts: number[] };

function better(a: Best, b: Best | undefined): boolean {
  if (!b) return true;
  if (a.loss !== b.loss) return a.loss < b.loss;
  for (let i = 0; i < a.ts.length; i++) if (a.ts[i] !== b.ts[i]) return a.ts[i] > b.ts[i];
  return false;
}

/**
 * 最大の損 maxLoss 以内で sum(size * t) = K となる t を、
 * 損の合計最小 → 優先順の先頭グループほど t（= 得）が大きい、の順で選ぶ。
 */
function solveGroups(groups: Group[], K: number, unit: number, maxLoss: number): number[] | null {
  const lower = groups.map((g) => {
    // 損 = c - unit*t <= maxLoss
    let t = Math.ceil((g.c - maxLoss) / unit);
    // 受け取る側は 0 円未満にならない
    if (g.receiver) t = Math.max(t, Math.ceil(-g.lo / unit));
    return t;
  });
  const sumLower = groups.reduce((s, g, i) => s + g.size * lower[i], 0);
  if (sumLower > K) return null;
  const upper = groups.map((g, i) => {
    const byTotal = lower[i] + Math.floor((K - sumLower) / g.size);
    // 払う側: 得は unit 円まで（かつ 0 円を超えない）
    return g.receiver ? byTotal : Math.min(byTotal, 1);
  });
  if (groups.some((_, i) => lower[i] > upper[i])) return null;

  // 後ろのグループから DP。state = 処理済みグループで作る sum(size * t)。
  // 未処理グループ 0..gi-1 で到達できる範囲 [prefixMin, prefixMax] を使い、K に届かない state を捨てる。
  const prefixMin = [0];
  const prefixMax = [0];
  groups.forEach((g, i) => {
    prefixMin.push(prefixMin[i] + g.size * lower[i]);
    prefixMax.push(prefixMax[i] + g.size * upper[i]);
  });
  let next = new Map<number, Best>([[0, { loss: 0, ts: [] }]]);
  for (let gi = groups.length - 1; gi >= 0; gi--) {
    const g = groups[gi];
    const cur = new Map<number, Best>();
    for (const [s, rest] of next) {
      for (let t = lower[gi]; t <= upper[gi]; t++) {
        const total = s + g.size * t;
        const need = K - total;
        if (need < prefixMin[gi] || need > prefixMax[gi]) continue;
        const delta = -g.c + unit * t;
        const cand = { loss: rest.loss + g.size * Math.max(0, -delta), ts: [t, ...rest.ts] };
        if (better(cand, cur.get(total))) cur.set(total, cand);
      }
    }
    next = cur;
  }
  return next.get(K)?.ts ?? null;
}

/** 個人方式（各人は下側・上側の倍数のみ） */
function roundIndividually(
  balances: readonly number[],
  paidAmounts: readonly number[],
  unit: number,
): RoundedBalance[] | null {
  const order = payerPriority(paidAmounts);
  const n = order.length;
  const b = order.map((i) => balances[i]);
  const lo = b.map((x) => floorTo(x, unit));
  const hi = b.map((x) => ceilTo(x, unit));
  const dLo = b.map((x, p) => lo[p] - x); // <= 0
  const dHi = b.map((x, p) => hi[p] - x); // >= 0
  const switchable = b.map((_, p) => lo[p] !== hi[p]);
  const k = -lo.reduce((s, v) => s + v, 0) / unit;
  if (!Number.isInteger(k) || k < 0 || k > switchable.filter(Boolean).length) return null;

  // (1) 最大 |差額| の最小値 T
  const thresholds = Array.from(
    new Set([0, ...b.flatMap((_, p) => (switchable[p] ? [-dLo[p], dHi[p]] : []))]),
  ).sort((x, y) => x - y);
  const feasible = (t: number) => {
    let must = 0;
    let can = 0;
    for (let p = 0; p < n; p++) {
      if (!switchable[p]) continue;
      const allowLo = -dLo[p] <= t;
      const allowHi = dHi[p] <= t;
      if (!allowLo && !allowHi) return false;
      if (allowHi) can++;
      if (!allowLo) must++;
    }
    return must <= k && k <= can;
  };
  const threshold = thresholds.find(feasible);
  if (threshold === undefined) return null;

  // (2) |差額| の合計最小、(3) 優先順（支払総額の降順）の先頭ほど上側（得）を選ぶ。
  // best[p][j] = 優先順 p 番目以降で j 人を上側にするときの |差額| 合計。後ろから計算し、同点なら上側。
  const best: number[][] = Array.from({ length: n + 1 }, () => Array<number>(k + 1).fill(Infinity));
  const choice: (0 | 1)[][] = Array.from({ length: n + 1 }, () => Array<0 | 1>(k + 1).fill(0));
  best[n][0] = 0;
  for (let p = n - 1; p >= 0; p--) {
    for (let j = 0; j <= k; j++) {
      let bestHere = Infinity;
      let pick: 0 | 1 = 0;
      if ((!switchable[p] || -dLo[p] <= threshold) && best[p + 1][j] !== Infinity) {
        bestHere = -dLo[p] + best[p + 1][j];
      }
      if (switchable[p] && dHi[p] <= threshold && j > 0 && best[p + 1][j - 1] !== Infinity) {
        const cand = dHi[p] + best[p + 1][j - 1];
        if (cand <= bestHere) {
          bestHere = cand;
          pick = 1;
        }
      }
      best[p][j] = bestHere;
      choice[p][j] = pick;
    }
  }
  if (best[0][k] === Infinity) return null;

  const result: RoundedBalance[] = new Array(n);
  let j = k;
  for (let p = 0; p < n; p++) {
    const s = choice[p][j] === 1 ? hi[p] : lo[p];
    if (choice[p][j] === 1) j--;
    result[order[p]] = { originalBalance: b[p], settlementBalance: s, delta: s - b[p] };
  }
  return result;
}
