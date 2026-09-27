import { allocateShares } from './allocate';
import { formatYen } from './money';
import {
  err,
  ok,
  type AppState,
  type Expense,
  type Person,
  type Result,
  type Share,
  type ShareMode,
} from './types';

let idCounter = 0;
export function newId(prefix: string): string {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === 'function') return `${prefix}_${c.randomUUID()}`;
  idCounter++;
  return `${prefix}_${Date.now().toString(36)}_${idCounter}_${Math.random().toString(36).slice(2, 8)}`;
}

export function sortedPersons(persons: Person[]): Person[] {
  return [...persons].sort((a, b) => a.order - b.order);
}

export function isExpenseActive(e: Expense): boolean {
  return e.payerId !== null && e.amount !== null && e.amount > 0;
}

/** shares を参加者の表示順へ並べ替える（欠けた参加者は auto で補う） */
function normalizeShares(shares: Share[], persons: Person[]): Share[] {
  const map = new Map(shares.map((s) => [s.personId, s]));
  return sortedPersons(persons).map(
    (p) => map.get(p.id) ?? { personId: p.id, amount: 0, mode: 'auto' as ShareMode },
  );
}

function reallocate(expense: Expense, shares: Share[], persons: Person[]): Result<Expense> {
  const ordered = normalizeShares(shares, persons);
  if (expense.amount === null) {
    return ok({ ...expense, shares: ordered.map((s) => ({ ...s, amount: 0 })) });
  }
  const r = allocateShares(expense.amount, ordered, expense.payerId);
  if (!r.ok) return r;
  return ok({ ...expense, shares: r.value });
}

export function createExpense(persons: Person[], order: number): Expense {
  return {
    id: newId('e'),
    title: '',
    payerId: null,
    amount: null,
    order,
    shares: sortedPersons(persons).map((p) => ({ personId: p.id, amount: 0, mode: 'auto' })),
  };
}

export function createInitialState(): AppState {
  const persons: Person[] = [0, 1, 2, 3].map((i) => ({
    id: newId('p'),
    name: `参加者${i + 1}`,
    order: i,
  }));
  return {
    schemaVersion: 1,
    persons,
    expenses: [0, 1, 2].map((i) => createExpense(persons, i)),
    settlementMode: { kind: 'exact' },
    selectedPatternIndex: 0,
  };
}

function findExpense(state: AppState, expenseId: string): Result<Expense> {
  const e = state.expenses.find((x) => x.id === expenseId);
  return e ? ok(e) : err('支出が見つかりません');
}

function replaceExpense(state: AppState, expense: Expense): AppState {
  return { ...state, expenses: state.expenses.map((e) => (e.id === expense.id ? expense : e)) };
}

function updateExpense(
  state: AppState,
  expenseId: string,
  fn: (e: Expense) => Result<Expense>,
): Result<AppState> {
  const found = findExpense(state, expenseId);
  if (!found.ok) return found;
  const r = fn(found.value);
  if (!r.ok) return r;
  return ok(replaceExpense(state, r.value));
}

// ---- 支出行 ----

export function addExpense(state: AppState): AppState {
  const order = state.expenses.reduce((m, e) => Math.max(m, e.order + 1), 0);
  return { ...state, expenses: [...state.expenses, createExpense(state.persons, order)] };
}

export function removeExpense(state: AppState, expenseId: string): AppState {
  return { ...state, expenses: state.expenses.filter((e) => e.id !== expenseId) };
}

export function setExpenseTitle(state: AppState, expenseId: string, title: string): Result<AppState> {
  return updateExpense(state, expenseId, (e) => ok({ ...e, title }));
}

/**
 * 支払者と支払額を設定する。amount が null / 0 の場合は行を未入力に戻す
 * （対象外は保持し、固定は解除する）。支払額変更時は fixed / excluded を保持して auto のみ再計算。
 */
export function setPayment(
  state: AppState,
  expenseId: string,
  payerId: string | null,
  amount: number | null,
): Result<AppState> {
  return updateExpense(state, expenseId, (e) => {
    if (amount === null || amount === 0) {
      return ok({
        ...e,
        payerId: null,
        amount: null,
        shares: normalizeShares(e.shares, state.persons).map((s) => ({
          ...s,
          amount: 0,
          mode: s.mode === 'excluded' ? 'excluded' : 'auto',
        })),
      });
    }
    if (!Number.isSafeInteger(amount) || amount < 0) return err('支払額は1円以上の整数で入力してください');
    if (payerId === null) return err('支払者を選択してください');
    if (!state.persons.some((p) => p.id === payerId)) return err('支払者が見つかりません');
    return reallocate({ ...e, payerId, amount }, e.shares, state.persons);
  });
}

/** 支払者を変更する。固定・対象外は保持し、端数を新しい支払者が負担するよう auto のみ再計算する */
export function setPayer(state: AppState, expenseId: string, payerId: string): Result<AppState> {
  if (!state.persons.some((p) => p.id === payerId)) return err('支払者が見つかりません');
  return updateExpense(state, expenseId, (e) => {
    if (e.amount === null) return err('先に支払額を入力してください');
    return reallocate({ ...e, payerId }, e.shares, state.persons);
  });
}

/** 負担額を手動変更し固定する */
export function setShareAmount(
  state: AppState,
  expenseId: string,
  personId: string,
  amount: number,
): Result<AppState> {
  if (!Number.isSafeInteger(amount) || amount < 0) return err('負担額は0以上の整数で入力してください');
  return updateExpense(state, expenseId, (e) => {
    if (e.amount === null) return err('支払額が未入力の行には負担額を設定できません');
    const shares = normalizeShares(e.shares, state.persons).map((s) =>
      s.personId === personId ? { ...s, amount, mode: 'fixed' as const } : s,
    );
    return reallocate(e, shares, state.persons);
  });
}

/** 負担の状態を変更する（fixed 解除 → auto、対象外 → excluded、再参加 → auto） */
export function setShareMode(
  state: AppState,
  expenseId: string,
  personId: string,
  mode: 'auto' | 'excluded',
): Result<AppState> {
  return updateExpense(state, expenseId, (e) => {
    const shares = normalizeShares(e.shares, state.persons).map((s) =>
      s.personId === personId ? { ...s, amount: 0, mode } : s,
    );
    return reallocate(e, shares, state.persons);
  });
}

// ---- 参加者 ----

/** 名前の同一判定用（前後の空白を除き、全角・半角の違いを無視） */
function nameKey(name: string): string {
  return name.normalize('NFKC').trim();
}

/** 他の参加者と重複しない名前か検証し、前後の空白を除いた名前を返す */
export function validatePersonName(
  persons: Person[],
  name: string,
  selfId: string | null = null,
): Result<string> {
  const trimmed = name.trim();
  if (trimmed === '') return err('名前を入力してください');
  const key = nameKey(trimmed);
  const dup = persons.find((p) => p.id !== selfId && nameKey(p.name) === key);
  if (dup) return err(`「${dup.name}」は既に登録されています。別の名前にしてください`);
  return ok(trimmed);
}

/** 未使用の既定名（参加者1, 参加者2, …）のうち最小の番号 */
export function nextDefaultName(persons: Person[]): string {
  for (let i = 1; ; i++) {
    const name = `参加者${i}`;
    if (validatePersonName(persons, name).ok) return name;
  }
}

export function addPerson(
  state: AppState,
  rawName: string,
  includeInExisting: boolean,
): Result<AppState> {
  const valid = validatePersonName(state.persons, rawName);
  if (!valid.ok) return valid;
  const name = valid.value;
  const order = state.persons.reduce((m, p) => Math.max(m, p.order + 1), 0);
  const person: Person = { id: newId('p'), name, order };
  const persons = [...state.persons, person];
  const expenses: Expense[] = [];
  for (const e of state.expenses) {
    const mode: ShareMode = includeInExisting || !isExpenseActive(e) ? 'auto' : 'excluded';
    const r = reallocate(e, [...e.shares, { personId: person.id, amount: 0, mode }], persons);
    if (!r.ok) return r;
    expenses.push(r.value);
  }
  return ok({ ...state, persons, expenses });
}

export function renamePerson(state: AppState, personId: string, rawName: string): Result<AppState> {
  const valid = validatePersonName(state.persons, rawName, personId);
  if (!valid.ok) return valid;
  const name = valid.value;
  return ok({
    ...state,
    persons: state.persons.map((p) => (p.id === personId ? { ...p, name } : p)),
  });
}

/** 削除により影響を受ける支出（支払者の行・負担がある行） */
export function personUsage(state: AppState, personId: string) {
  const payerOf = state.expenses.filter((e) => e.payerId === personId);
  const sharedIn = state.expenses.filter(
    (e) =>
      isExpenseActive(e) &&
      e.shares.some((s) => s.personId === personId && s.mode !== 'excluded' && s.amount > 0),
  );
  return { payerOf, sharedIn };
}

export function removePerson(state: AppState, personId: string): Result<AppState> {
  if (state.persons.length <= 1) return err('参加者は最低1人必要です');
  const target = state.persons.find((p) => p.id === personId);
  if (!target) return err('参加者が見つかりません');
  const { payerOf } = personUsage(state, personId);
  if (payerOf.length > 0) {
    const titles = payerOf
      .map((e) => `「${e.title || '（名目なし）'}」${e.amount !== null ? formatYen(e.amount) + '円' : ''}`)
      .join('、');
    return err(
      `${target.name} は ${titles} の支払者です。先にこれらの行の支払者を変更するか、行を削除してください`,
    );
  }
  const persons = state.persons.filter((p) => p.id !== personId);
  const expenses: Expense[] = [];
  for (const e of state.expenses) {
    const r = reallocate(
      e,
      e.shares.filter((s) => s.personId !== personId),
      persons,
    );
    if (!r.ok) {
      return err(`${target.name} を削除すると「${e.title || '（名目なし）'}」の配分が不正になります: ${r.error}`);
    }
    expenses.push(r.value);
  }
  return ok({ ...state, persons, expenses });
}
