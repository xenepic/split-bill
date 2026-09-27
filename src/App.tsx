import { useMemo, useRef, useState } from 'react';
import { computeBalances } from './domain/balance';
import { isExpenseActive, nextDefaultName, sortedPersons } from './domain/expenseOps';
import { computeSettlement } from './domain/settle';
import { ExpenseTable } from './components/ExpenseTable';
import { ConfirmDialog, Modal, type ConfirmRequest } from './components/Modal';
import { SettlementPanel } from './components/SettlementPanel';
import { SummaryTable } from './components/SummaryTable';
import { useSelectAllOnFocus } from './components/selectAll';
import { useAppState } from './state/useAppState';
import { STORAGE_KEY, validateState } from './storage';
import './App.css';

function AddPersonDialog({
  defaultName,
  askInclusion,
  error,
  onAdd,
  onClose,
}: {
  defaultName: string;
  askInclusion: boolean;
  error: string | null;
  onAdd: (name: string, include: boolean) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState(defaultName);
  const [include, setInclude] = useState(false);
  const selectAll = useSelectAllOnFocus();
  const submit = () => onAdd(name.trim() || defaultName, include);
  return (
    <Modal
      title="参加者を追加"
      onClose={onClose}
      footer={
        <>
          <button type="button" onClick={onClose}>
            キャンセル
          </button>
          <button type="button" className="primary" onClick={submit}>
            追加
          </button>
        </>
      }
    >
      <label className="field-row">
        <span>名前</span>
        <input
          value={name}
          aria-invalid={error ? true : undefined}
          {...selectAll}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && submit()}
        />
      </label>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {askInclusion && (
        <fieldset>
          <legend>入力済みの支出</legend>
          <label className="radio-line">
            <input type="radio" name="include" checked={!include} onChange={() => setInclude(false)} />
            対象外にする（過去の負担は変わりません）
          </label>
          <label className="radio-line">
            <input type="radio" name="include" checked={include} onChange={() => setInclude(true)} />
            既存の支出にも含めて均等割りし直す
          </label>
        </fieldset>
      )}
    </Modal>
  );
}

function download(filename: string, text: string) {
  const blob = new Blob([text], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export default function App() {
  const api = useAppState();
  const { state } = api;
  const [confirmReq, setConfirmReq] = useState<ConfirmRequest | null>(null);
  const [addingPerson, setAddingPerson] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const persons = sortedPersons(state.persons);

  const balances = useMemo(() => computeBalances(state), [state.persons, state.expenses]); // eslint-disable-line react-hooks/exhaustive-deps
  const settlement = useMemo(
    () => computeSettlement(state, state.settlementMode),
    [state.persons, state.expenses, state.settlementMode], // eslint-disable-line react-hooks/exhaustive-deps
  );

  const exportJson = () => download(`split-bill-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(state, null, 2));

  const importJson = async (file: File) => {
    try {
      const r = validateState(JSON.parse(await file.text()));
      if (!r.ok) {
        api.setError(`読み込めませんでした：${r.reason}`);
        return;
      }
      setConfirmReq({
        title: 'JSONを読み込む',
        message: '現在の入力内容を読み込んだデータで置き換えます。よろしいですか？',
        confirmLabel: '置き換える',
        danger: true,
        onConfirm: () => api.replaceState(r.state),
      });
    } catch {
      api.setError('読み込めませんでした：JSONとして解釈できません');
    }
  };

  return (
    <div className="app">
      <header className="app-header">
        <h1>割り勘計算</h1>
        <div className="header-actions">
          <button type="button" onClick={exportJson}>
            JSON書き出し
          </button>
          <button type="button" onClick={() => fileRef.current?.click()}>
            JSON読み込み
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void importJson(f);
              e.target.value = '';
            }}
          />
          <button
            type="button"
            className="danger"
            onClick={() =>
              setConfirmReq({
                title: '新しく始める',
                message: '入力した参加者・支出をすべて消去します。元に戻せません。よろしいですか？',
                confirmLabel: '全消去',
                danger: true,
                onConfirm: api.reset,
              })
            }
          >
            新しく始める
          </button>
        </div>
      </header>

      {api.corrupt && (
        <div className="banner error" role="alert">
          保存データを復元できませんでした（{api.corrupt}）。
          <button
            type="button"
            onClick={() => {
              let raw = '';
              try {
                raw = localStorage.getItem(STORAGE_KEY) ?? '';
              } catch {
                /* noop */
              }
              download('split-bill-broken.json', raw);
            }}
          >
            破損データを退避
          </button>
          <button
            type="button"
            className="danger"
            onClick={() =>
              setConfirmReq({
                title: '初期化',
                message: '保存データを破棄して初期状態から始めます。よろしいですか？',
                confirmLabel: '初期化',
                danger: true,
                onConfirm: api.confirmCorruptReset,
              })
            }
          >
            初期化する
          </button>
        </div>
      )}
      {api.saveFailed && (
        <div className="banner warn" role="alert">
          ブラウザへの自動保存に失敗しました。「JSON書き出し」でデータを退避してください。
        </div>
      )}
      {api.error && !confirmReq && !addingPerson && (
        <div className="banner error" role="alert">
          {api.error}
          <button type="button" className="icon-btn" aria-label="エラーを閉じる" onClick={() => api.setError(null)}>
            ×
          </button>
        </div>
      )}

      <main>
        <ExpenseTable api={api} requestConfirm={setConfirmReq} onAddPerson={() => setAddingPerson(true)} />
        <SummaryTable persons={persons} balances={balances.ok ? balances.value : null} />
        {!balances.ok && (
          <p className="error" role="alert">
            {balances.error}
          </p>
        )}
        <SettlementPanel
          api={api}
          persons={persons}
          view={settlement.ok ? settlement.value : null}
          viewError={settlement.ok ? null : settlement.error}
        />
      </main>
      <footer className="app-footer">
        データはこのブラウザ内にのみ保存され、外部へ送信されません。
      </footer>

      {addingPerson && (
        <AddPersonDialog
          defaultName={nextDefaultName(persons)}
          error={api.error}
          askInclusion={state.expenses.some(isExpenseActive)}
          onClose={() => {
            api.setError(null);
            setAddingPerson(false);
          }}
          onAdd={(name, include) => {
            if (api.addPerson(name, include)) setAddingPerson(false);
          }}
        />
      )}
      {confirmReq && <ConfirmDialog req={confirmReq} onClose={() => setConfirmReq(null)} />}
    </div>
  );
}
