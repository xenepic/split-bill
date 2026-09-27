import { findMinTransferPatterns } from './settlement';
import {
  isSupportedRoundingUnit,
  isValidRoundingUnit,
  roundBalances,
  type RoundedBalance,
  type RoundingResult,
} from './rounding';
import type { Result } from './types';

function unwrap<T>(r: Result<T>): T {
  if (!r.ok) throw new Error(r.error);
  return r.value;
}
const settled = (r: RoundingResult) => r.balances.map((x) => x.settlementBalance);
const deltas = (r: RoundingResult) => r.balances.map((x) => x.delta);

function checkConstraints(b: number[], r: RoundingResult, unit: number) {
  const rows: RoundedBalance[] = r.balances;
  expect(rows.map((x) => x.originalBalance)).toEqual(b);
  expect(rows.reduce((s, x) => s + x.settlementBalance, 0)).toBe(0);
  expect(rows.reduce((s, x) => s + x.delta, 0)).toBe(0);
  const byBalance = new Map<number, number>();
  rows.forEach((x, i) => {
    expect(x.settlementBalance % unit === 0).toBe(true);
    if (b[i] > 0) expect(x.settlementBalance).toBeGreaterThanOrEqual(0);
    if (b[i] < 0) expect(x.settlementBalance).toBeLessThanOrEqual(0);
    if (b[i] === 0) expect(x.settlementBalance).toBe(0);
    if (r.method === 'grouped') {
      // 損は 2*unit-1 まで、払う側の得は unit まで、同額は同額
      expect(-x.delta).toBeLessThanOrEqual(2 * unit - 1);
      if (b[i] < 0) expect(x.delta).toBeLessThanOrEqual(unit);
      if (byBalance.has(b[i])) expect(x.settlementBalance).toBe(byBalance.get(b[i]));
      byBalance.set(b[i], x.settlementBalance);
    } else {
      expect(Math.abs(x.delta)).toBeLessThanOrEqual(unit - 1);
      expect([Math.floor(b[i] / unit) * unit + 0, Math.ceil(b[i] / unit) * unit + 0]).toContain(x.settlementBalance);
    }
  });
}

function compare(a: number[], b: number[]) {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] - b[i];
  return 0;
}

/** 方針をそのまま総当たりで実装した参照解（テスト用） */
function bruteRound(b: number[], paid: number[], unit: number): { method: string; r: number[] } {
  const priority = b.map((_, i) => i).sort((x, y) => paid[y] - paid[x] || x - y);
  // --- 同額そろえ方式 ---
  const groups: { balance: number; members: number[] }[] = [];
  for (const i of priority) {
    if (b[i] === 0) continue;
    const g = groups.find((x) => x.balance === b[i]);
    if (g) g.members.push(i);
    else groups.push({ balance: b[i], members: [i] });
  }
  let best: { key: number[]; r: number[] } | null = null;
  const range = Array.from({ length: b.length + 8 }, (_, k) => k - 4);
  const choose = (gi: number, picks: number[]) => {
    if (gi === groups.length) {
      const r = b.map(() => 0);
      groups.forEach((g, k) => g.members.forEach((i) => (r[i] = picks[k])));
      if (r.reduce((s, x) => s + x, 0) !== 0) return;
      const d = r.map((x, i) => x - b[i]);
      if (d.some((x, i) => -x > 2 * unit - 1 || (b[i] < 0 && x > unit))) return;
      const losses = d.map((x) => Math.max(0, -x));
      const key = [
        Math.max(...losses),
        losses.reduce((s, x) => s + x, 0),
        ...groups.map((g, k) => -(picks[k] - g.balance)),
      ];
      if (!best || compare(key, best.key) < 0) best = { key, r };
      return;
    }
    const g = groups[gi];
    const lo = Math.floor(g.balance / unit) * unit;
    for (const t of range) {
      const s = lo + unit * t + 0;
      if ((g.balance > 0 && s < 0) || (g.balance < 0 && s > 0)) continue;
      choose(gi + 1, [...picks, s]);
    }
  };
  choose(0, []);
  if (best) return { method: 'grouped', r: (best as { r: number[] }).r };

  // --- 個人方式 ---
  let bestI: { key: number[]; r: number[] } | null = null;
  const n = b.length;
  for (let mask = 0; mask < 1 << n; mask++) {
    if (b.some((x, i) => (mask >> i) & 1 && Math.ceil(x / unit) === Math.floor(x / unit))) continue;
    const r = b.map((x, i) => ((mask >> i) & 1 ? Math.ceil(x / unit) : Math.floor(x / unit)) * unit + 0);
    if (r.reduce((s, x) => s + x, 0) !== 0) continue;
    const d = r.map((x, i) => x - b[i]);
    const key = [
      Math.max(...d.map(Math.abs)),
      d.reduce((s, x) => s + Math.abs(x), 0),
      ...priority.map((i) => -d[i]),
    ];
    if (!bestI || compare(key, bestI.key) < 0) bestI = { key, r };
  }
  return { method: 'individual', r: bestI!.r };
}

function rng(seed: number) {
  return () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };
}

/** 同額の人を含むランダムな残高（合計0） */
function randomBalances(rand: () => number, n: number, span: number): number[] {
  const values = Array.from({ length: Math.max(1, Math.floor(rand() * n)) }, () => Math.floor(rand() * span * 2 - span));
  const b = Array.from({ length: n - 1 }, () => values[Math.floor(rand() * values.length)]);
  b.push(-b.reduce((s, x) => s + x, 0));
  return b;
}

describe('roundBalances（50円丸め）', () => {
  it('No.10 A+1,221 / B−611 / C−610', () => {
    const r = unwrap(roundBalances([1221, -611, -610], [1221, 0, 0], 50));
    expect(r.method).toBe('grouped');
    expect(settled(r)).toEqual([1200, -600, -600]);
    expect(deltas(r)).toEqual([-21, 11, 10]);
    const s = findMinTransferPatterns(settled(r).map((x) => x / 50));
    expect(s.patterns).toEqual([
      [
        { from: 1, to: 0, amount: 12 },
        { from: 2, to: 0, amount: 12 },
      ],
    ]);
  });

  it('No.11 A+1,250 / B−1,250 は変化なし', () => {
    const r = unwrap(roundBalances([1250, -1250], [1250, 0], 50));
    expect(settled(r)).toEqual([1250, -1250]);
    expect(deltas(r)).toEqual([0, 0]);
  });

  it('No.17 同点時は支払者優先: A+150 / B−100 / C−50', () => {
    const r = unwrap(roundBalances([125, -75, -50], [125, 0, 0], 50));
    expect(settled(r)).toEqual([150, -100, -50]);
  });

  it('No.18 損の小ささを優先: A+1,200 / B−1,200', () => {
    const r = unwrap(roundBalances([1221, -1221], [1221, 0], 50));
    expect(settled(r)).toEqual([1200, -1200]);
  });

  it('No.19 A+10、ほか10人各−1 → 全員0円、矢印0件', () => {
    const b = [10, ...Array(10).fill(-1)];
    const r = unwrap(roundBalances(b, [10, ...Array(10).fill(0)], 50));
    expect(settled(r).every((x) => x === 0)).toBe(true);
    expect(findMinTransferPatterns(settled(r)).patterns).toEqual([[]]);
  });

  it('No.24 0円への丸めを許容', () => {
    const r = unwrap(roundBalances([20, -20], [20, 0], 50));
    expect(settled(r)).toEqual([0, 0]);
  });

  it('同額の人は同額: A+150 / B−75 / C−75 → B・C とも −100', () => {
    const r = unwrap(roundBalances([150, -75, -75], [150, 0, 0], 50));
    expect(r.method).toBe('grouped');
    expect(settled(r)).toEqual([200, -100, -100]);
  });

  it('1人が立替・6人同額: 立替者が50円を超えて得をしてよい', () => {
    // A が 10,000円を7人で（端数は A が吸収）: A +8,574 / 他 −1,429
    const r = unwrap(roundBalances([8574, ...Array(6).fill(-1429)], [10000, ...Array(6).fill(0)], 50));
    expect(r.method).toBe('grouped');
    expect(settled(r)).toEqual([8700, ...Array(6).fill(-1450)]);
    expect(deltas(r)).toEqual([126, ...Array(6).fill(-21)]);
  });

  it('50円以内の損では両立しない場合、99円までの損を許容してそろえる', () => {
    // A・B が各2,100円を払い5人で割り勘: A,B +1,260 / C,D,E −840
    const r = unwrap(roundBalances([1260, 1260, -840, -840, -840], [2100, 2100, 0, 0, 0], 50));
    expect(r.method).toBe('grouped');
    // 最大の損60円は同じなので、損の合計が小さい方（A・B が各60円損）を選ぶ
    expect(settled(r)).toEqual([1200, 1200, -800, -800, -800]);
  });

  it('そろえると損が99円を超える場合は個人方式（±49円以内）に切り替える', () => {
    // A〜D が各1,600円を払い5人で割り勘: A〜D +320 / E −1,280（そろえると E が120円損）
    const r = unwrap(roundBalances([320, 320, 320, 320, -1280], [1600, 1600, 1600, 1600, 0], 50));
    expect(r.method).toBe('individual');
    expect(settled(r)).toEqual([350, 350, 300, 300, -1300]);
    checkConstraints([320, 320, 320, 320, -1280], r, 50);
  });

  it('支払総額が多い人ほど得が大きくなる（同点時）', () => {
    // B と C は同額の払う側。A（支払多）と D（支払少）が受け取る側で、どちらかが得をする
    const r = unwrap(roundBalances([75, -50, -50, 25], [500, 0, 0, 100], 50));
    expect(settled(r)).toEqual([100, -50, -50, 0]);
  });

  it('No.16 / No.20 大人数でも必須条件を満たす（ランダム）', () => {
    const rand = rng(7);
    for (let t = 0; t < 400; t++) {
      const n = 2 + Math.floor(rand() * 14);
      const b = randomBalances(rand, n, 10000);
      const paid = b.map(() => (rand() < 0.5 ? Math.floor(rand() * 10000) : 0));
      const r = unwrap(roundBalances(b, paid, 50));
      checkConstraints(b, r, 50);
      // 精算探索は人数が多いと重いので、8人以下で確認
      if (n <= 8) expect(findMinTransferPatterns(settled(r).map((x) => x / 50)).patterns.length).toBeGreaterThan(0);
    }
  });

  it('小人数では方針どおりの総当たりと一致（同額を含む）', () => {
    const rand = rng(99);
    for (const unit of [10, 50, 100]) {
      for (let t = 0; t < 250; t++) {
        const n = 2 + Math.floor(rand() * 5);
        const b = randomBalances(rand, n, 300);
        const paid = b.map(() => (rand() < 0.5 ? Math.floor(rand() * 4) * 100 : 0));
        const r = unwrap(roundBalances(b, paid, unit));
        const expected = bruteRound(b, paid, unit);
        expect({ method: r.method, r: settled(r) }).toEqual(expected);
      }
    }
  });

  it('No.22 将来用の単位10・100も同じロジックで扱える', () => {
    for (const unit of [10, 100]) {
      const b = [1221, -611, -610];
      const r = unwrap(roundBalances(b, [1221, 0, 0], unit));
      checkConstraints(b, r, unit);
    }
  });

  it('No.23 不正な丸め単位を拒否', () => {
    for (const u of [0, -50, 2.5, NaN, Infinity]) {
      expect(roundBalances([0], [0], u).ok).toBe(false);
      expect(isValidRoundingUnit(u)).toBe(false);
    }
    expect(isSupportedRoundingUnit(50)).toBe(true);
    expect(isSupportedRoundingUnit(10)).toBe(false);
    expect(isSupportedRoundingUnit(100)).toBe(false);
  });

  it('合計が0でない入力はエラー', () => {
    expect(roundBalances([10, -5], [0, 0], 50).ok).toBe(false);
  });
});
