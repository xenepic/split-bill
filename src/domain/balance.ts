import { isExpenseActive, sortedPersons } from './expenseOps';
import { err, ok, type AppState, type Result } from './types';

export type PersonBalance = {
  personId: string;
  paid: number;
  owed: number;
  balance: number; // paid - owed
};

/** 各人の支払総額・負担総額・収支（仕様 7章）。表示順で返す。 */
export function computeBalances(state: Pick<AppState, 'persons' | 'expenses'>): Result<PersonBalance[]> {
  const persons = sortedPersons(state.persons);
  const paid = new Map<string, number>(persons.map((p) => [p.id, 0]));
  const owed = new Map<string, number>(persons.map((p) => [p.id, 0]));

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
      if (!Number.isSafeInteger(s.amount) || s.amount < 0) return err('負担額が不正です');
      rowTotal += s.amount;
      owed.set(s.personId, owed.get(s.personId)! + s.amount);
    }
    if (rowTotal !== amount) {
      return err(`「${e.title || '（名目なし）'}」の負担額合計が支払額と一致しません（内部不整合）`);
    }
  }

  const result = persons.map((p) => {
    const pd = paid.get(p.id)!;
    const ow = owed.get(p.id)!;
    return { personId: p.id, paid: pd, owed: ow, balance: pd - ow };
  });
  const sum = result.reduce((s, r) => s + r.balance, 0);
  if (sum !== 0) return err('収支の合計が0になりません（内部不整合）');
  return ok(result);
}
