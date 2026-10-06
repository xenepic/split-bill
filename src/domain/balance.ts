import { autoShareExact } from './allocate';
import { isExpenseActive, sortedPersons } from './expenseOps';
import { payerPriority } from './rounding';
import { err, ok, type AppState, type Result } from './types';

export type PersonBalance = {
  personId: string;
  paid: number;
  /** 負担総額（整数円）。paid - balance と一致するよう、最終収支の丸めに合わせた値 */
  owed: number;
  balance: number; // paid - owed
};

/** 分数（分母は常に正）。均等割りの端数を集計まで正確に持つため bigint で扱う */
type Frac = { n: bigint; d: bigint };

const gcd = (a: bigint, b: bigint): bigint => {
  a = a < 0n ? -a : a;
  while (b !== 0n) [a, b] = [b, a % b];
  return a;
};

function add(x: Frac, y: Frac): Frac {
  const n = x.n * y.d + y.n * x.d;
  const d = x.d * y.d;
  const g = gcd(n, d) || 1n;
  return { n: n / g, d: d / g };
}

/** 切り捨て（負の方向） */
function floorFrac(x: Frac): bigint {
  const q = x.n / x.d;
  return x.n % x.d !== 0n && x.n < 0n ? q - 1n : q;
}

/**
 * 各人の支払総額・負担総額・収支（仕様 7章）。表示順で返す。
 *
 * auto の負担額は表示用の整数ではなく正確な値（例: 1,000円を3人なら 1000/3）で集計し、
 * 最終収支を整数円にするときだけ端数を処理する。各人は正確な収支の切り捨て・切り上げのどちらかになり、
 * 合計を0にするための切り上げ（得をする側）は支払総額が多い人（同額なら表示順）から割り当てる。
 */
export function computeBalances(state: Pick<AppState, 'persons' | 'expenses'>): Result<PersonBalance[]> {
  const persons = sortedPersons(state.persons);
  const paid = new Map<string, number>(persons.map((p) => [p.id, 0]));
  const owed = new Map<string, Frac>(persons.map((p) => [p.id, { n: 0n, d: 1n }]));

  for (const e of state.expenses) {
    if (!isExpenseActive(e)) continue;
    const amount = e.amount!;
    if (!paid.has(e.payerId!)) return err('支払者が参加者に存在しない支出があります');
    paid.set(e.payerId!, paid.get(e.payerId!)! + amount);
    let rowTotal = 0;
    for (const s of e.shares) {
      if (!owed.has(s.personId)) {
        if (s.amount !== 0) return err('存在しない参加者の負担額があります');
        continue;
      }
      if (!Number.isSafeInteger(s.amount) || s.amount * amount < 0) return err('負担額が不正です');
      rowTotal += s.amount;
    }
    if (rowTotal !== amount) {
      return err(`「${e.title || '（名目なし）'}」の負担額合計が支払額と一致しません（内部不整合）`);
    }
    const split = autoShareExact(amount, e.shares);
    if (!split.ok) return split;
    const { rest, autoCount } = split.value;
    for (const s of e.shares) {
      if (!owed.has(s.personId) || s.mode === 'excluded') continue;
      const share: Frac =
        s.mode === 'fixed' ? { n: BigInt(s.amount), d: 1n } : { n: BigInt(rest), d: BigInt(autoCount) };
      owed.set(s.personId, add(owed.get(s.personId)!, share));
    }
  }

  // 正確な収支 = 支払総額 − 負担総額（分数）
  const exact = persons.map((p) => {
    const o = owed.get(p.id)!;
    return add({ n: BigInt(paid.get(p.id)!), d: 1n }, { n: -o.n, d: o.d });
  });
  const floors = exact.map(floorFrac);
  const exactSum = exact.reduce(add, { n: 0n, d: 1n });
  if (exactSum.n !== 0n) return err('収支の合計が0になりません（内部不整合）');
  // 切り捨てで足りなくなった分だけ、端数のある人を1円切り上げる
  let ceils = -floors.reduce((s, f) => s + f, 0n);
  const balance = floors.map(Number);
  for (const i of payerPriority(persons.map((p) => paid.get(p.id)!))) {
    if (ceils <= 0n) break;
    if (exact[i].d === 1n) continue;
    balance[i] += 1;
    ceils--;
  }

  const result = persons.map((p, i) => {
    const pd = paid.get(p.id)!;
    const bal = balance[i] + 0; // -0 を正規化
    return { personId: p.id, paid: pd, owed: pd - bal, balance: bal };
  });
  const sum = result.reduce((s, r) => s + r.balance, 0);
  if (sum !== 0) return err('収支の合計が0になりません（内部不整合）');
  return ok(result);
}
