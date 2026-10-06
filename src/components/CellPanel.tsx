import { formatYen, negateYen } from '../domain/money';
import type { Expense, Person, Share } from '../domain/types';
import type { AppStateApi } from '../state/useAppState';
import { AmountInput } from './AmountInput';
import type { ConfirmRequest } from './Modal';
import { Modal } from './Modal';

type Props = {
  api: AppStateApi;
  expense: Expense;
  person: Person;
  persons: Person[];
  onClose: () => void;
  requestConfirm: (req: ConfirmRequest) => void;
};

function modeLabel(s: Share) {
  if (s.mode === 'fixed') return '🔒 固定';
  if (s.mode === 'excluded') return '対象外';
  return '自動（均等割り）';
}

function ShareControls({ api, expense, person, requestConfirm, isPayer }: Props & { isPayer: boolean }) {
  const share = expense.shares.find((s) => s.personId === person.id);
  if (!share) return null;
  return (
    <fieldset className="share-controls">
      <legend>{isPayer ? '自己負担額' : '負担額'}</legend>
      <div className="field-row">
        <AmountInput
          aria-label={`${person.name} の${isPayer ? '自己負担額' : '負担額'}`}
          value={share.mode === 'excluded' ? 0 : share.amount}
          onCommit={(v) => {
            if (v === null) {
              api.setError('負担額を入力してください（固定を外す場合は「固定解除」）');
              return false;
            }
            // マイナスの行（収益）では負担額も0以下。マイナス記号を打ちにくいスマホ向けに、正の入力は符号を反転する
            return api.setShareAmount(expense.id, person.id, expense.amount! < 0 && v > 0 ? -v : v);
          }}
          onParseError={api.setError}
        />
        <span>円</span>
        <span className={`mode-badge mode-${share.mode}`}>{modeLabel(share)}</span>
      </div>
      <p className="hint">
        金額を変更すると固定され、他の自動分が再配分されます。
        {expense.amount! < 0 && 'マイナスの行では、入力した金額はマイナス（受け取る額）として扱います。'}
      </p>
      <div className="button-row">
        {share.mode === 'fixed' && (
          <button type="button" onClick={() => api.setShareMode(expense.id, person.id, 'auto')}>
            固定解除
          </button>
        )}
        {share.mode === 'excluded' ? (
          <button type="button" onClick={() => api.setShareMode(expense.id, person.id, 'auto')}>
            再参加させる
          </button>
        ) : (
          <button
            type="button"
            onClick={() => {
              if (isPayer) {
                requestConfirm({
                  title: '支払者を対象外にする',
                  message: `${person.name} はこの支出を支払いましたが、自分の分は負担しません（他の人の分を全額立て替えた場合）。よろしいですか？`,
                  confirmLabel: '対象外にする',
                  onConfirm: () => api.setShareMode(expense.id, person.id, 'excluded'),
                });
              } else {
                api.setShareMode(expense.id, person.id, 'excluded');
              }
            }}
          >
            対象外にする
          </button>
        )}
      </div>
    </fieldset>
  );
}

export function CellPanel(props: Props) {
  const { api, expense, person, persons, onClose } = props;
  const isPayer = expense.payerId === person.id;
  const title = `${expense.title || '（名目なし）'} ／ ${person.name}`;
  return (
    <Modal
      title={title}
      onClose={onClose}
      footer={
        <button type="button" className="primary" onClick={onClose}>
          閉じる
        </button>
      }
    >
      {api.error && (
        <p className="error" role="alert">
          {api.error}
        </p>
      )}
      {isPayer && (
        <fieldset>
          <legend>支払い</legend>
          <label className="field-row">
            <span>支払者</span>
            <select
              value={expense.payerId ?? ''}
              onChange={(e) => api.setPayer(expense.id, e.target.value)}
            >
              {persons.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
          <div className="field-row">
            <span>支払額</span>
            <AmountInput
              aria-label="支払額"
              value={expense.amount}
              onCommit={(v) => {
                const done = api.setPayment(expense.id, expense.payerId, v);
                if (done && (v === null || v === 0)) onClose();
                return done;
              }}
              onParseError={api.setError}
            />
            <span>円</span>
            {/* iPhone の数字キーボードにはマイナス記号がないため、符号はボタンでも切り替えられるようにする */}
            <button
              type="button"
              className="sign-btn"
              aria-label="支払額のプラス・マイナスを切り替え"
              title="プラス・マイナスを切り替え"
              disabled={expense.amount === null}
              onClick={() => api.setPayment(expense.id, expense.payerId, negateYen(expense.amount))}
            >
              ±
            </button>
          </div>
          <p className="hint">
            競馬の払戻など収益の場合はマイナスで入力します（みんなで受け取る額になります）。
            支払額を空欄または0にすると、この行は未入力に戻ります。
          </p>
        </fieldset>
      )}
      {expense.amount !== null && <ShareControls {...props} isPayer={isPayer} />}
      {expense.amount !== null && (
        <p className="hint">
          行の合計: {formatYen(expense.shares.reduce((s, x) => s + x.amount, 0))}円 ／ 支払額 {formatYen(expense.amount)}円
        </p>
      )}
    </Modal>
  );
}
