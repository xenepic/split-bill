import { findMinTransferPatterns } from './settlement';
import { isSupportedRoundingUnit, isValidRoundingUnit, roundBalances, type RoundedBalance } from './rounding';
import type { Result } from './types';

function unwrap<T>(r: Result<T>): T {
  if (!r.ok) throw new Error(r.error);
  return r.value;
}
const settled = (r: RoundedBalance[]) => r.map((x) => x.settlementBalance);
const deltas = (r: RoundedBalance[]) => r.map((x) => x.delta);

function checkConstraints(b: number[], r: RoundedBalance[], unit: number) {
  expect(r.map((x) => x.originalBalance)).toEqual(b);
  expect(r.reduce((s, x) => s + x.settlementBalance, 0)).toBe(0);
  expect(r.reduce((s, x) => s + x.delta, 0)).toBe(0);
  r.forEach((x, i) => {
    expect(x.settlementBalance % unit === 0).toBe(true);
    expect(Math.abs(x.delta)).toBeLessThanOrEqual(unit - 1);
    const lo = Math.floor(b[i] / unit) * unit;
    const hi = Math.ceil(b[i] / unit) * unit;
    expect([lo, hi]).toContain(x.settlementBalance);
    if (b[i] > 0) expect(x.settlementBalance).toBeGreaterThanOrEqual(0);
    if (b[i] < 0) expect(x.settlementBalance).toBeLessThanOrEqual(0);
    if (b[i] === 0) expect(x.settlementBalance).toBe(0);
  });
}

/** 全組み合わせ総当たりで仕様 8.3 の辞書式最適を求める（テスト用） */
function bruteRound(b: number[], paid: number[], unit: number): number[] {
  const n = b.length;
  let best: { key: number[]; r: number[] } | null = null;
  for (let mask = 0; mask < 1 << n; mask++) {
    const r = b.map((x, i) => ((mask >> i) & 1 ? Math.ceil(x / unit) : Math.floor(x / unit)) * unit + 0);
    if (b.some((x, i) => (mask >> i) & 1 && Math.ceil(x / unit) === Math.floor(x / unit))) continue;
    if (r.reduce((s, x) => s + x, 0) !== 0) continue;
    const d = r.map((x, i) => x - b[i]);
    const key = [
      Math.max(...d.map(Math.abs)),
      d.reduce((s, x) => s + Math.abs(x), 0),
      -d.reduce((s, x, i) => s + (paid[i] > 0 ? x : 0), 0),
      -d.reduce((s, x, i) => s + (b[i] > 0 ? x : 0), 0),
      // 安定順: 表示順で先頭ほど下側（ビット0）を優先 → ビット列を先頭から比較
      ...b.map((_, i) => (mask >> i) & 1),
    ];
    if (!best || compare(key, best.key) < 0) best = { key, r };
  }
  return best!.r;
}
function compare(a: number[], b: number[]) {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] - b[i];
  return 0;
}

describe('roundBalances（50円丸め）', () => {
  it('No.10 A+1,221 / B−611 / C−610', () => {
    const r = unwrap(roundBalances([1221, -611, -610], [1221, 0, 0], 50));
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

  it('No.17 同点時は立替者優先: A+150 / B−100 / C−50', () => {
    const r = unwrap(roundBalances([125, -75, -50], [125, 0, 0], 50));
    expect(settled(r)).toEqual([150, -100, -50]);
  });

  it('No.18 公平性を優先: A+1,200 / B−1,200', () => {
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

  it('候補例: +1,221 / −611 / +10 / −1', () => {
    const r = unwrap(roundBalances([1221, -611, 10, -1, -619], [0, 0, 0, 0, 0], 50));
    checkConstraints([1221, -611, 10, -1, -619], r, 50);
  });

  it('No.16 / No.20 大人数でも差額±49以内・合計0（ランダム）', () => {
    let seed = 7;
    const rand = () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed / 0x7fffffff;
    };
    for (let t = 0; t < 300; t++) {
      const n = 2 + Math.floor(rand() * 14);
      const b = Array.from({ length: n - 1 }, () => Math.floor(rand() * 20000 - 10000));
      b.push(-b.reduce((s, x) => s + x, 0));
      const paid = b.map(() => (rand() < 0.5 ? Math.floor(rand() * 10000) : 0));
      const r = unwrap(roundBalances(b, paid, 50));
      checkConstraints(b, r, 50);
      const s = findMinTransferPatterns(settled(r).map((x) => x / 50));
      for (const p of s.patterns) for (const tr of p) expect((tr.amount * 50) % 50).toBe(0);
    }
  });

  it('小人数では総当たりの辞書式最適と一致', () => {
    let seed = 99;
    const rand = () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed / 0x7fffffff;
    };
    for (const unit of [10, 50, 100]) {
      for (let t = 0; t < 300; t++) {
        const n = 2 + Math.floor(rand() * 7);
        const b = Array.from({ length: n - 1 }, () => Math.floor(rand() * 600 - 300));
        b.push(-b.reduce((s, x) => s + x, 0));
        const paid = b.map(() => (rand() < 0.5 ? 100 : 0));
        const r = unwrap(roundBalances(b, paid, unit));
        expect(settled(r)).toEqual(bruteRound(b, paid, unit));
      }
    }
  });

  it('No.22 将来用の単位10・100も同じロジックで扱える', () => {
    for (const unit of [10, 100]) {
      const b = [1221, -611, -610];
      const r = unwrap(roundBalances(b, [1221, 0, 0], unit));
      checkConstraints(b, r, unit);
      expect(Math.max(...deltas(r).map(Math.abs))).toBeLessThanOrEqual(unit - 1);
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
