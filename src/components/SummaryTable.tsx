import type { PersonBalance } from '../domain/balance';
import { formatSignedYen, formatYen } from '../domain/money';
import type { Person } from '../domain/types';

export function balanceLabel(b: number) {
  if (b > 0) return '受取';
  if (b < 0) return '送金';
  return '精算不要';
}

export function SummaryTable({ persons, balances }: { persons: Person[]; balances: PersonBalance[] | null }) {
  const name = new Map(persons.map((p) => [p.id, p.name]));
  // 支払総額の合計 = 負担総額の合計 = 総費用（支払者に関係なく、全支出の合計）
  const totalPaid = (balances ?? []).reduce((s, b) => s + b.paid, 0);
  const totalOwed = (balances ?? []).reduce((s, b) => s + b.owed, 0);
  return (
    <section aria-labelledby="summary-heading">
      <h2 id="summary-heading">集計</h2>
      <p className="hint">
        収支 = 支払総額 − 負担総額。＋は受け取る人、−は支払う（送金する）人です。
        均等割りの端数は行ごとに丸めず正確に合計し、最後に1円単位で調整しています（端数は支払総額が多い人が得をします）。
      </p>
      <div className="table-scroll">
        <table className="summary-table">
          <thead>
            <tr>
              <th scope="col">参加者</th>
              <th scope="col">支払総額</th>
              <th scope="col">負担総額</th>
              <th scope="col">収支</th>
            </tr>
          </thead>
          <tbody>
            {(balances ?? []).map((b) => (
              <tr key={b.personId}>
                <th scope="row">{name.get(b.personId)}</th>
                <td className="num">{formatYen(b.paid)}円</td>
                <td className="num">{formatYen(b.owed)}円</td>
                <td className={`num balance ${b.balance > 0 ? 'pos' : b.balance < 0 ? 'neg' : 'zero'}`}>
                  <span className="balance-tag">{balanceLabel(b.balance)}</span>{' '}
                  <strong>{formatSignedYen(b.balance)}円</strong>
                </td>
              </tr>
            ))}
          </tbody>
          {balances && (
            <tfoot>
              <tr className="total-row">
                <th scope="row">合計（総費用）</th>
                <td className="num">{formatYen(totalPaid)}円</td>
                <td className="num">{formatYen(totalOwed)}円</td>
                <td />
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </section>
  );
}
