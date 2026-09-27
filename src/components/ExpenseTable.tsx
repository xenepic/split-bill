import { useState } from 'react';
import { isExpenseActive, personUsage, sortedPersons } from '../domain/expenseOps';
import { formatYen } from '../domain/money';
import type { Expense, Person } from '../domain/types';
import type { AppStateApi } from '../state/useAppState';
import { AmountInput } from './AmountInput';
import { CellPanel } from './CellPanel';
import type { ConfirmRequest } from './Modal';
import { useSelectAllOnFocus } from './selectAll';

type Props = {
  api: AppStateApi;
  requestConfirm: (req: ConfirmRequest) => void;
  onAddPerson: () => void;
};

function PersonHeader({
  api,
  person,
  index,
  requestConfirm,
}: {
  api: AppStateApi;
  person: Person;
  index: number;
  requestConfirm: Props['requestConfirm'];
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const selectAll = useSelectAllOnFocus();
  const commit = () => {
    if (draft === null) return;
    // 空・重複などで拒否された場合はエラーを表示し、元の名前に戻す
    if (draft.trim() !== person.name) api.renamePerson(person.id, draft);
    setDraft(null);
  };
  const onDelete = () => {
    const { payerOf, sharedIn } = personUsage(api.state, person.id);
    if (payerOf.length > 0) {
      // 支払者の行があれば削除を拒否（理由をエラー表示）
      api.removePerson(person.id);
      return;
    }
    requestConfirm({
      title: '参加者を削除',
      message:
        sharedIn.length > 0
          ? `${person.name} は ${sharedIn.length} 件の支出で負担額があります。削除すると、その分は各行の自動（均等割り）の人へ再配分されます。削除しますか？`
          : `${person.name} を削除しますか？`,
      confirmLabel: '削除',
      danger: true,
      onConfirm: () => api.removePerson(person.id),
    });
  };
  return (
    <th scope="col" className="person-head">
      <div className="person-head-inner">
        <input
          className="name-input"
          aria-label={`参加者${index + 1}の名前`}
          value={draft ?? person.name}
          {...selectAll}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
            if (e.key === 'Escape') setDraft(null);
          }}
        />
        {/* Tab で名前欄から隣の名前欄へ移れるよう、削除ボタンはタブ順から外す */}
        <button
          type="button"
          className="icon-btn"
          tabIndex={-1}
          aria-label={`${person.name} を削除`}
          title="参加者を削除"
          onClick={onDelete}
        >
          ×
        </button>
      </div>
    </th>
  );
}

function ExpenseCell({
  api,
  expense,
  person,
  rowLabel,
  onOpen,
}: {
  api: AppStateApi;
  expense: Expense;
  person: Person;
  rowLabel: string;
  onOpen: () => void;
}) {
  const share = expense.shares.find((s) => s.personId === person.id);
  const label = `${rowLabel} の ${person.name}`;

  if (!isExpenseActive(expense)) {
    // 未設定行: 金額入力でその人を支払者に設定
    return (
      <td className="cell cell-empty">
        <AmountInput
          className="cell-input"
          placeholder="支払額"
          aria-label={`${label} の支払額（入力するとこの人が支払者になります）`}
          value={null}
          onCommit={(v) => (v === null ? true : api.setPayment(expense.id, person.id, v))}
          onParseError={api.setError}
        />
        {share?.mode === 'excluded' && <span className="mini">対象外</span>}
      </td>
    );
  }

  if (expense.payerId === person.id) {
    const self = share!;
    return (
      <td className="cell cell-payer">
        <button type="button" className="cell-btn" aria-label={`${label}：支払 ${formatYen(expense.amount!)}円、自己負担 ${self.mode === 'excluded' ? 'なし（対象外）' : formatYen(self.amount) + '円'}。編集`} onClick={onOpen}>
          <span className="paid-amount">{formatYen(expense.amount!)}</span>
          <span className="mini">
            /<span className="owed-amount">{self.mode === 'excluded' ? '—' : formatYen(self.amount)}</span>
            {self.mode === 'fixed' && ' 🔒'}
          </span>
        </button>
      </td>
    );
  }

  if (!share || share.mode === 'excluded') {
    return (
      <td className="cell cell-excluded">
        <button type="button" className="cell-btn" aria-label={`${label}：対象外。編集`} onClick={onOpen}>
          <span aria-hidden="true">—</span>
          <span className="mini">対象外</span>
        </button>
      </td>
    );
  }

  return (
    <td className="cell cell-share">
      <button
        type="button"
        className="cell-btn"
        aria-label={`${label}：負担 ${formatYen(share.amount)}円${share.mode === 'fixed' ? '（固定）' : ''}。編集`}
        onClick={onOpen}
      >
        <span className="owed-amount">
          {formatYen(share.amount)}
          {share.mode === 'fixed' && (
            <span className="lock" title="固定">
              {' '}
              🔒
            </span>
          )}
        </span>
      </button>
    </td>
  );
}

export function ExpenseTable({ api, requestConfirm, onAddPerson }: Props) {
  const { state } = api;
  const persons = sortedPersons(state.persons);
  const expenses = [...state.expenses].sort((a, b) => a.order - b.order);
  const [open, setOpen] = useState<{ expenseId: string; personId: string } | null>(null);

  const openExpense = open && state.expenses.find((e) => e.id === open.expenseId);
  const openPerson = open && persons.find((p) => p.id === open.personId);

  const onDeleteRow = (e: Expense) => {
    if (!isExpenseActive(e) && !e.title) {
      api.removeExpense(e.id);
      return;
    }
    requestConfirm({
      title: '支出を削除',
      message: `「${e.title || '（名目なし）'}」${e.amount ? ` ${formatYen(e.amount)}円` : ''} を削除しますか？`,
      confirmLabel: '削除',
      danger: true,
      onConfirm: () => api.removeExpense(e.id),
    });
  };

  return (
    <section aria-labelledby="table-heading">
      <h2 id="table-heading">支出入力</h2>
      <p className="hint">
        未入力の行では、支払った人の列に金額を入力するとその人が支払者になります。
        <span className="legend-inline">
          <b>太字</b>=支払額、<span className="owed-amount">赤字</span>=負担額、🔒=固定、—=対象外
        </span>
      </p>
      <div className="table-scroll">
        <table className="expense-table">
          <thead>
            <tr>
              <th scope="col" className="title-col">
                支出名目
              </th>
              {persons.map((p, i) => (
                <PersonHeader
                  key={p.id}
                  api={api}
                  person={p}
                  index={i}
                  requestConfirm={requestConfirm}
                />
              ))}
              <th scope="col" className="add-col">
                <button type="button" className="add-btn" aria-label="参加者を追加" onClick={onAddPerson}>
                  ＋
                </button>
              </th>
            </tr>
          </thead>
          <tbody>
            {expenses.map((e, row) => (
              <tr key={e.id}>
                <th scope="row" className="title-col">
                  <div className="title-cell">
                    <input
                      className="title-input"
                      aria-label={`${row + 1}行目の支出名目`}
                      placeholder={`支出${row + 1}`}
                      defaultValue={e.title}
                      key={e.title}
                      onBlur={(ev) => {
                        if (ev.target.value !== e.title) api.setExpenseTitle(e.id, ev.target.value);
                      }}
                      onKeyDown={(ev) => ev.key === 'Enter' && (ev.target as HTMLInputElement).blur()}
                    />
                    <button
                      type="button"
                      className="icon-btn"
                      aria-label={`${row + 1}行目を削除`}
                      title="行を削除"
                      onClick={() => onDeleteRow(e)}
                    >
                      ×
                    </button>
                  </div>
                </th>
                {persons.map((p) => (
                  <ExpenseCell
                    key={p.id}
                    api={api}
                    expense={e}
                    person={p}
                    rowLabel={e.title || `支出${row + 1}`}
                    onOpen={() => {
                      api.setError(null);
                      setOpen({ expenseId: e.id, personId: p.id });
                    }}
                  />
                ))}
                <td className="add-col" />
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td className="title-col">
                <button type="button" className="add-btn" aria-label="支出行を追加" onClick={api.addExpense}>
                  ＋ 行を追加
                </button>
              </td>
              <td colSpan={persons.length + 1} />
            </tr>
          </tfoot>
        </table>
      </div>
      {openExpense && openPerson && (
        <CellPanel
          api={api}
          expense={openExpense}
          person={openPerson}
          persons={persons}
          onClose={() => setOpen(null)}
          requestConfirm={requestConfirm}
        />
      )}
    </section>
  );
}
