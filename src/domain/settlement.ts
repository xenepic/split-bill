/**
 * 最小送金件数の精算パターン探索（仕様 8.1）。
 *
 * 送金件数の最小値 = 非ゼロ人数 − 「合計0の部分集合への最大分割数」。
 * 最小解の各連結成分は、それ以上分割できない合計0のグループ上の木になる。
 * そこで (a) 最大分割を全列挙し、(b) 各グループ内で「一方の残高を0にする送金」を
 * 繰り返して木を全列挙し、直積を取る。送金集合は正規化キーで重複排除する。
 */

export type IndexedTransfer = { from: number; to: number; amount: number };

export type SettlementSearchResult = {
  patterns: IndexedTransfer[][];
  /** 最小送金件数（minCountExact=false の場合は見つかった解の件数） */
  minCount: number;
  /** 最小件数であることが厳密に保証されているか */
  minCountExact: boolean;
  /** 最小件数のパターンを全て列挙し終えたか（件数上限・探索予算で打ち切ったら false） */
  patternsComplete: boolean;
};

export type SettlementOptions = {
  maxPatterns?: number;
  /** 厳密探索を行う非ゼロ人数の上限 */
  exactLimit?: number;
  /** 列挙の探索ノード予算 */
  nodeBudget?: number;
};

const DEFAULTS = { maxPatterns: 20, exactLimit: 14, nodeBudget: 200_000 };

function patternKey(p: IndexedTransfer[]): string {
  return p.map((t) => `${t.from}>${t.to}:${t.amount}`).join('|');
}

function sortTransfers(p: IndexedTransfer[]): IndexedTransfer[] {
  return [...p].sort((a, b) => a.from - b.from || a.to - b.to || a.amount - b.amount);
}

/** 大きい送金人と大きい受取人を順に対応させる近似解（厳密探索不可の場合） */
function greedy(balances: readonly number[]): IndexedTransfer[] {
  const bal = [...balances];
  const out: IndexedTransfer[] = [];
  for (;;) {
    let d = -1;
    let c = -1;
    for (let i = 0; i < bal.length; i++) {
      if (bal[i] < 0 && (d < 0 || bal[i] < bal[d])) d = i;
      if (bal[i] > 0 && (c < 0 || bal[i] > bal[c])) c = i;
    }
    if (d < 0 || c < 0) break;
    const amt = Math.min(-bal[d], bal[c]);
    out.push({ from: d, to: c, amount: amt });
    bal[d] += amt;
    bal[c] -= amt;
  }
  return sortTransfers(out);
}

/** 合計0で、それ以上分割できないグループ内の木（送金集合）を列挙する */
function* enumerateTrees(
  members: number[],
  balances: readonly number[],
  budget: { nodes: number },
): Generator<IndexedTransfer[]> {
  const bal = new Map(members.map((i) => [i, balances[i]]));
  const edges: IndexedTransfer[] = [];
  const seen = new Set<string>();

  function* dfs(): Generator<IndexedTransfer[]> {
    if (--budget.nodes < 0) return;
    const active = members.filter((i) => bal.get(i) !== 0);
    if (active.length === 0) {
      const sorted = sortTransfers(edges);
      const key = patternKey(sorted);
      if (!seen.has(key)) {
        seen.add(key);
        yield sorted;
      }
      return;
    }
    for (const d of active) {
      const bd = bal.get(d)!;
      if (bd >= 0) continue;
      for (const c of active) {
        const bc = bal.get(c)!;
        if (bc <= 0) continue;
        const amt = Math.min(-bd, bc);
        bal.set(d, bd + amt);
        bal.set(c, bc - amt);
        edges.push({ from: d, to: c, amount: amt });
        yield* dfs();
        edges.pop();
        bal.set(d, bd);
        bal.set(c, bc);
        if (budget.nodes < 0) return;
      }
    }
  }
  yield* dfs();
}

export function findMinTransferPatterns(
  balances: readonly number[],
  options: SettlementOptions = {},
): SettlementSearchResult {
  const { maxPatterns, exactLimit, nodeBudget } = { ...DEFAULTS, ...options };
  if (balances.reduce((s, b) => s + b, 0) !== 0) {
    throw new Error('balances must sum to zero');
  }
  const nz = balances.map((_, i) => i).filter((i) => balances[i] !== 0);
  if (nz.length === 0) {
    return { patterns: [[]], minCount: 0, minCountExact: true, patternsComplete: true };
  }
  if (nz.length > exactLimit) {
    const g = greedy(balances);
    return { patterns: [g], minCount: g.length, minCountExact: false, patternsComplete: false };
  }

  const n = nz.length;
  const full = (1 << n) - 1;
  const sum = new Float64Array(1 << n);
  for (let m = 1; m <= full; m++) {
    const low = m & -m;
    sum[m] = sum[m ^ low] + balances[nz[31 - Math.clz32(low)]];
  }
  // groups[m] = m（合計0）を合計0の部分集合に分割したときの最大個数
  const groups = new Int8Array(1 << n);
  for (let m = 1; m <= full; m++) {
    let best = 0;
    for (let x = m; x; x &= x - 1) {
      const v = groups[m ^ (x & -x)];
      if (v > best) best = v;
    }
    groups[m] = best + (sum[m] === 0 ? 1 : 0);
  }
  const maxGroups = groups[full];
  const minCount = n - maxGroups;

  // 最大分割の列挙（最小インデックスを含むグループから順に決める）
  function* partitions(rest: number): Generator<number[][]> {
    if (rest === 0) {
      yield [];
      return;
    }
    const low = rest & -rest;
    const others = rest ^ low;
    // 部分集合を昇順に列挙して再現性を保つ
    const subs: number[] = [];
    for (let s = others; ; s = (s - 1) & others) {
      subs.push(s);
      if (s === 0) break;
    }
    subs.reverse();
    for (const s of subs) {
      const g = s | low;
      if (sum[g] !== 0 || groups[g] !== 1) continue;
      if (groups[rest ^ g] !== groups[rest] - 1) continue;
      const members: number[] = [];
      for (let x = g; x; x &= x - 1) members.push(nz[31 - Math.clz32(x & -x)]);
      for (const tail of partitions(rest ^ g)) yield [members, ...tail];
    }
  }

  const budget = { nodes: nodeBudget };
  const patterns: IndexedTransfer[][] = [];
  const seen = new Set<string>();
  let complete = true;

  function* product(trees: IndexedTransfer[][][], idx: number): Generator<IndexedTransfer[]> {
    if (idx === trees.length) {
      yield [];
      return;
    }
    for (const head of trees[idx]) {
      for (const tail of product(trees, idx + 1)) yield [...head, ...tail];
    }
  }

  function take<T>(gen: Generator<T>, limit: number): T[] {
    const out: T[] = [];
    for (const v of gen) {
      out.push(v);
      if (out.length >= limit) break;
    }
    return out;
  }

  // 上限+1件まで集めて、上限を超える解が存在したかを判定する
  outer: for (const parts of partitions(full)) {
    const trees = parts.map((g) => take(enumerateTrees(g, balances, budget), maxPatterns + 1));
    for (const p of product(trees, 0)) {
      const sorted = sortTransfers(p);
      const key = patternKey(sorted);
      if (seen.has(key)) continue;
      seen.add(key);
      patterns.push(sorted);
      if (patterns.length > maxPatterns) break outer;
    }
    if (budget.nodes < 0) break;
  }
  if (patterns.length > maxPatterns) {
    complete = false;
    patterns.length = maxPatterns;
  }
  if (budget.nodes < 0) complete = false;
  if (patterns.length === 0) {
    const g = greedy(balances);
    return { patterns: [g], minCount, minCountExact: true, patternsComplete: false };
  }
  return { patterns, minCount, minCountExact: true, patternsComplete: complete };
}
