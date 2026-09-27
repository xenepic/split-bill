import { useCallback, useEffect, useRef, useState } from 'react';
import * as ops from '../domain/expenseOps';
import { ok, type AppState, type Result, type SettlementMode } from '../domain/types';
import { loadState, saveState, type LoadResult } from '../storage';

const SAVE_DEBOUNCE_MS = 300;

export type AppStateApi = ReturnType<typeof useAppState>;

type Init = { state: AppState; load: LoadResult };

function init(): Init {
  const load = loadState();
  return { state: load.status === 'ok' ? load.state : ops.createInitialState(), load };
}

export function useAppState() {
  const [{ state: initial, load }] = useState(init);
  const [state, setState] = useState<AppState>(initial);
  const [error, setError] = useState<string | null>(null);
  const [saveFailed, setSaveFailed] = useState(false);
  // 破損データを検出した場合は、利用者が初期化を確認するまで上書き保存しない
  const [corrupt, setCorrupt] = useState<string | null>(load.status === 'corrupt' ? load.reason : null);
  const stateRef = useRef(state);
  stateRef.current = state;

  useEffect(() => {
    if (corrupt) return;
    const t = setTimeout(() => setSaveFailed(!saveState(state)), SAVE_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [state, corrupt]);

  /** 計算に影響する変更。成功時はパターン選択を先頭へ戻す。失敗時は直前の状態を保持。 */
  const apply = useCallback((fn: (s: AppState) => Result<AppState>, resetPattern = true) => {
    const res = fn(stateRef.current);
    if (!res.ok) {
      setError(res.error);
      return false;
    }
    setError(null);
    const next = resetPattern ? { ...res.value, selectedPatternIndex: 0 } : res.value;
    stateRef.current = next;
    setState(next);
    return true;
  }, []);

  return {
    state,
    error,
    setError,
    saveFailed,
    corrupt,
    confirmCorruptReset: () => {
      setCorrupt(null);
      apply(() => ok(ops.createInitialState()));
    },
    reset: () => apply(() => ok(ops.createInitialState())),
    replaceState: (s: AppState) => apply(() => ok(s)),
    addExpense: () => apply((s) => ok(ops.addExpense(s)), false),
    removeExpense: (id: string) => apply((s) => ok(ops.removeExpense(s, id))),
    setExpenseTitle: (id: string, title: string) => apply((s) => ops.setExpenseTitle(s, id, title), false),
    setPayment: (id: string, payerId: string | null, amount: number | null) =>
      apply((s) => ops.setPayment(s, id, payerId, amount)),
    setPayer: (id: string, payerId: string) => apply((s) => ops.setPayer(s, id, payerId)),
    setShareAmount: (id: string, personId: string, amount: number) =>
      apply((s) => ops.setShareAmount(s, id, personId, amount)),
    setShareMode: (id: string, personId: string, mode: 'auto' | 'excluded') =>
      apply((s) => ops.setShareMode(s, id, personId, mode)),
    addPerson: (name: string, includeInExisting: boolean) =>
      apply((s) => ops.addPerson(s, name, includeInExisting)),
    renamePerson: (id: string, name: string) => apply((s) => ops.renamePerson(s, id, name), false),
    removePerson: (id: string) => apply((s) => ops.removePerson(s, id)),
    setSettlementMode: (mode: SettlementMode) => apply((s) => ok({ ...s, settlementMode: mode })),
    setPatternIndex: (i: number) => apply((s) => ok({ ...s, selectedPatternIndex: i }), false),
  };
}
