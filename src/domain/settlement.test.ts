import { findMinTransferPatterns, type IndexedTransfer } from './settlement';

function applies(balances: number[], p: IndexedTransfer[]) {
  const bal = [...balances];
  for (const t of p) {
    expect(t.amount).toBeGreaterThan(0);
    expect(balances[t.from]).toBeLessThan(0);
    expect(balances[t.to]).toBeGreaterThan(0);
    bal[t.from] += t.amount;
    bal[t.to] -= t.amount;
  }
  return bal.every((b) => b === 0);
}

/** 小人数用のブルートフォース：最小件数 */
function bruteMin(balances: number[]): number {
  let best = Infinity;
  const bal = [...balances];
  function dfs(count: number) {
    if (count >= best) return;
    const i = bal.findIndex((b) => b !== 0);
    if (i < 0) {
      best = count;
      return;
    }
    for (let j = i + 1; j < bal.length; j++) {
      if (bal[j] !== 0 && Math.sign(bal[j]) !== Math.sign(bal[i])) {
        const v = bal[i];
        bal[j] += v;
        bal[i] = 0;
        dfs(count + 1);
        bal[i] = v;
        bal[j] -= v;
      }
    }
  }
  dfs(0);
  return best;
}

describe('findMinTransferPatterns', () => {
  it('No.13 全員0円 → 送金なし', () => {
    const r = findMinTransferPatterns([0, 0, 0]);
    expect(r.patterns).toEqual([[]]);
    expect(r.minCount).toBe(0);
  });

  it('No.12 複数の最小解を重複なく列挙', () => {
    // A-100, B-100, C+100, D+100 → 2件の解が2通り
    const r = findMinTransferPatterns([-100, -100, 100, 100]);
    expect(r.minCount).toBe(2);
    expect(r.patterns).toHaveLength(2);
    expect(r.patternsComplete).toBe(true);
    const keys = r.patterns.map((p) => JSON.stringify(p));
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('再現性のある順序', () => {
    const b = [4250, -4750, 5250, -4750];
    expect(findMinTransferPatterns(b)).toEqual(findMinTransferPatterns(b));
  });

  it('ランダム入力でブルートフォースと最小件数が一致し、全パターンが有効', () => {
    let seed = 42;
    const rand = () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed / 0x7fffffff;
    };
    for (let t = 0; t < 200; t++) {
      const n = 2 + Math.floor(rand() * 6);
      const b = Array.from({ length: n - 1 }, () => Math.floor(rand() * 7 - 3) * 100);
      b.push(-b.reduce((s, x) => s + x, 0));
      const r = findMinTransferPatterns(b);
      expect(r.minCountExact).toBe(true);
      expect(r.minCount).toBe(bruteMin(b));
      const keys = new Set<string>();
      for (const p of r.patterns) {
        expect(p).toHaveLength(r.minCount);
        expect(applies(b, p)).toBe(true);
        keys.add(JSON.stringify(p));
      }
      expect(keys.size).toBe(r.patterns.length);
    }
  });

  it('パターン上限20件で打ち切り、未完了を示す', () => {
    const b = [-100, -100, -100, -100, -100, 100, 100, 100, 100, 100];
    const r = findMinTransferPatterns(b);
    expect(r.minCount).toBe(5);
    expect(r.patterns).toHaveLength(20);
    expect(r.patternsComplete).toBe(false);
    expect(r.minCountExact).toBe(true);
  });

  it('大人数は近似解（最適保証なし）', () => {
    const b = Array.from({ length: 20 }, (_, i) => (i < 10 ? -(i + 1) : i - 9));
    const r = findMinTransferPatterns(b);
    expect(r.minCountExact).toBe(false);
    expect(applies(b, r.patterns[0])).toBe(true);
  });
});

/** 送金辺の部分集合を総当たりし、全額正で解消できる最小件数の送金集合を全列挙する（テスト用） */
function bruteAllMin(balances: number[], count: number): Set<string> {
  const debtors = balances.map((_, i) => i).filter((i) => balances[i] < 0);
  const creditors = balances.map((_, i) => i).filter((i) => balances[i] > 0);
  const pairs = debtors.flatMap((d) => creditors.map((c) => [d, c] as const));
  const out = new Set<string>();
  const pick: (readonly [number, number])[] = [];
  function solve(): IndexedTransfer[] | null {
    // 木（森）なら葉から順に金額が一意に決まる
    const bal = [...balances];
    const edges = [...pick];
    const res: IndexedTransfer[] = [];
    while (edges.length) {
      const deg = new Map<number, number>();
      for (const [d, c] of edges) {
        deg.set(d, (deg.get(d) ?? 0) + 1);
        deg.set(c, (deg.get(c) ?? 0) + 1);
      }
      const idx = edges.findIndex(([d, c]) => deg.get(d) === 1 || deg.get(c) === 1);
      if (idx < 0) return null; // 閉路あり（最小件数では起こらない）
      const [d, c] = edges[idx];
      const amt = deg.get(d) === 1 ? -bal[d] : bal[c];
      if (amt <= 0) return null;
      bal[d] += amt;
      bal[c] -= amt;
      res.push({ from: d, to: c, amount: amt });
      edges.splice(idx, 1);
    }
    return bal.every((b) => b === 0) ? res : null;
  }
  function rec(start: number) {
    if (pick.length === count) {
      const r = solve();
      if (r) out.add(JSON.stringify([...r].sort((a, b) => a.from - b.from || a.to - b.to)));
      return;
    }
    for (let i = start; i < pairs.length; i++) {
      pick.push(pairs[i]);
      rec(i + 1);
      pick.pop();
    }
  }
  rec(0);
  return out;
}

describe('全最小パターンの網羅', () => {
  it('ランダム入力で総当たりと列挙結果が一致', () => {
    let seed = 3;
    const rand = () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed / 0x7fffffff;
    };
    for (let t = 0; t < 150; t++) {
      const n = 2 + Math.floor(rand() * 5);
      const b = Array.from({ length: n - 1 }, () => Math.floor(rand() * 7 - 3) * 100);
      b.push(-b.reduce((s, x) => s + x, 0));
      const r = findMinTransferPatterns(b, { maxPatterns: 1000 });
      const expected = bruteAllMin(b, r.minCount);
      const got = new Set(r.patterns.map((p) => JSON.stringify(p)));
      expect(got).toEqual(expected);
    }
  });
});
