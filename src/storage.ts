import { allocateShares } from './domain/allocate';
import { isSupportedRoundingUnit } from './domain/rounding';
import type { AppState, Expense, Person, SettlementMode, Share } from './domain/types';

export const STORAGE_KEY = 'split-bill:state';

export type LoadResult =
  | { status: 'empty' }
  | { status: 'ok'; state: AppState }
  | { status: 'corrupt'; reason: string };

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const isInt = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v);

/** 将来のスキーマ変更用。旧バージョンのデータを現行 AppState 形式へ変換する。 */
export function migrate(raw: unknown): unknown {
  if (!isObj(raw)) return raw;
  switch (raw.schemaVersion) {
    case 1:
      return raw;
    default:
      return raw;
  }
}

function validatePerson(v: unknown): v is Person {
  return isObj(v) && typeof v.id === 'string' && v.id !== '' && typeof v.name === 'string' && isInt(v.order);
}

function validateShare(v: unknown): v is Share {
  return (
    isObj(v) &&
    typeof v.personId === 'string' &&
    isInt(v.amount) &&
    (v.mode === 'auto' || v.mode === 'fixed' || v.mode === 'excluded')
  );
}

function validateExpense(v: unknown, personIds: Set<string>): v is Expense {
  if (!isObj(v)) return false;
  if (typeof v.id !== 'string' || typeof v.title !== 'string' || !isInt(v.order)) return false;
  if (!(v.payerId === null || (typeof v.payerId === 'string' && personIds.has(v.payerId)))) return false;
  if (!(v.amount === null || (isInt(v.amount) && v.amount !== 0))) return false;
  if ((v.payerId === null) !== (v.amount === null)) return false;
  if (!Array.isArray(v.shares) || !v.shares.every(validateShare)) return false;
  const shares = v.shares as Share[];
  const ids = new Set(shares.map((s) => s.personId));
  if (ids.size !== shares.length || ids.size !== personIds.size) return false;
  if (![...ids].every((id) => personIds.has(id))) return false;
  if (v.amount === null) return shares.every((s) => s.mode !== 'fixed');
  const total = shares.reduce((s, x) => s + x.amount, 0);
  if (total !== v.amount) return false;
  return allocateShares(v.amount, shares).ok;
}

function validateMode(v: unknown): v is SettlementMode {
  if (!isObj(v)) return false;
  if (v.kind === 'exact') return true;
  return v.kind === 'rounded' && isSupportedRoundingUnit(v.unit);
}

export function validateState(raw: unknown): { ok: true; state: AppState } | { ok: false; reason: string } {
  const v = migrate(raw);
  if (!isObj(v)) return { ok: false, reason: 'データ形式が不正です' };
  if (v.schemaVersion !== 1) return { ok: false, reason: '未対応のデータバージョンです' };
  if (!Array.isArray(v.persons) || v.persons.length === 0 || !v.persons.every(validatePerson)) {
    return { ok: false, reason: '参加者データが不正です' };
  }
  const personIds = new Set((v.persons as Person[]).map((p) => p.id));
  if (personIds.size !== v.persons.length) return { ok: false, reason: '参加者IDが重複しています' };
  if (!Array.isArray(v.expenses) || !v.expenses.every((e) => validateExpense(e, personIds))) {
    return { ok: false, reason: '支出データが不正です' };
  }
  if (!validateMode(v.settlementMode)) return { ok: false, reason: '精算モードが不正です' };
  const state: AppState = {
    schemaVersion: 1,
    persons: v.persons as Person[],
    expenses: v.expenses as Expense[],
    settlementMode: v.settlementMode,
    selectedPatternIndex: isInt(v.selectedPatternIndex) && v.selectedPatternIndex >= 0 ? v.selectedPatternIndex : 0,
  };
  return { ok: true, state };
}

export function loadState(storage: Storage | undefined = globalThis.localStorage): LoadResult {
  let text: string | null;
  try {
    text = storage?.getItem(STORAGE_KEY) ?? null;
  } catch {
    return { status: 'empty' };
  }
  if (text === null) return { status: 'empty' };
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { status: 'corrupt', reason: 'JSONとして読み込めません' };
  }
  const r = validateState(raw);
  return r.ok ? { status: 'ok', state: r.state } : { status: 'corrupt', reason: r.reason };
}

/** 保存する。失敗時は false */
export function saveState(state: AppState, storage: Storage | undefined = globalThis.localStorage): boolean {
  try {
    if (!storage) return false;
    storage.setItem(STORAGE_KEY, JSON.stringify(state));
    return true;
  } catch {
    return false;
  }
}

export function clearState(storage: Storage | undefined = globalThis.localStorage): void {
  try {
    storage?.removeItem(STORAGE_KEY);
  } catch {
    /* noop */
  }
}
