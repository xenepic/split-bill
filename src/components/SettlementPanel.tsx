import { useState } from 'react';
import { formatSignedYen, formatYen } from '../domain/money';
import type { SettlementView } from '../domain/settle';
import type { Person, SettlementMode } from '../domain/types';
import type { AppStateApi } from '../state/useAppState';
import { RoundingToggle } from './RoundingToggle';
import { SettlementDiagram } from './SettlementDiagram';

type Props = {
  api: AppStateApi;
  persons: Person[];
  view: SettlementView | null;
  viewError: string | null;
};

function modeName(mode: SettlementMode) {
  return mode.kind === 'exact' ? '通常（丸めなし）' : `${mode.unit}円丸め`;
}

function deltaText(d: number) {
  if (d > 0) return `${formatSignedYen(d)}円（得）`;
  if (d < 0) return `${formatSignedYen(d)}円（損）`;
  return '0円';
}

export function buildResultText(persons: Person[], view: SettlementView, mode: SettlementMode, index: number) {
  const name = new Map(persons.map((p) => [p.id, p.name]));
  const transfers = view.patterns[index] ?? [];
  const lines = [`【精算方法】${modeName(mode)}　パターン ${index + 1} / ${view.patterns.length}`];
  if (transfers.length === 0) lines.push('精算は不要です');
  for (const t of transfers) lines.push(`${name.get(t.fromId)} → ${name.get(t.toId)}：${formatYen(t.amount)}円`);
  if (mode.kind === 'rounded') {
    lines.push('', '【調整差額】');
    for (const r of view.rows) lines.push(`${name.get(r.personId)}：${deltaText(r.delta)}`);
  }
  return lines.join('\n');
}

export function SettlementPanel({ api, persons, view, viewError }: Props) {
  const { state } = api;
  const mode = state.settlementMode;
  const [copied, setCopied] = useState<'ok' | 'fail' | null>(null);
  const name = new Map(persons.map((p) => [p.id, p.name]));
  const count = view?.patterns.length ?? 0;
  const index = count > 0 ? Math.min(state.selectedPatternIndex, count - 1) : 0;
  const transfers = view?.patterns[index] ?? [];

  const copy = async () => {
    if (!view) return;
    try {
      await navigator.clipboard.writeText(buildResultText(persons, view, mode, index));
      setCopied('ok');
    } catch {
      setCopied('fail');
    }
    setTimeout(() => setCopied(null), 2000);
  };

  return (
    <section aria-labelledby="settle-heading">
      <div className="section-head">
        <h2 id="settle-heading">精算</h2>
        <RoundingToggle mode={mode} onChange={api.setSettlementMode} />
      </div>
      {mode.kind === 'rounded' && <p className="hint">最終収支を{mode.unit}円単位に調節します</p>}

      {viewError && (
        <p className="error" role="alert">
          精算結果を表示できません：{viewError}
        </p>
      )}

      {view && (
        <>
          {mode.kind === 'rounded' && (
            <details className="collapsible">
              <summary>調整差額の内訳</summary>
              <div className="table-scroll">
                <table className="summary-table">
                  <thead>
                    <tr>
                      <th scope="col">参加者</th>
                      <th scope="col">元の収支</th>
                      <th scope="col">精算用収支</th>
                      <th scope="col">調整差額</th>
                    </tr>
                  </thead>
                  <tbody>
                    {view.rows.map((r) => (
                      <tr key={r.personId}>
                        <th scope="row">{name.get(r.personId)}</th>
                        <td className="num">{formatSignedYen(r.balance)}円</td>
                        <td className="num">
                          <strong>{formatSignedYen(r.settlementBalance)}円</strong>
                        </td>
                        <td className={`num ${r.delta > 0 ? 'gain' : r.delta < 0 ? 'loss' : ''}`}>{deltaText(r.delta)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          )}

          <div className="pattern-nav">
            <button
              type="button"
              aria-label="前のパターン"
              disabled={count <= 1}
              onClick={() => api.setPatternIndex((index - 1 + count) % count)}
            >
              ◀ 前へ
            </button>
            <span aria-live="polite">
              パターン {index + 1} / {count}
            </span>
            <button
              type="button"
              aria-label="次のパターン"
              disabled={count <= 1}
              onClick={() => api.setPatternIndex((index + 1) % count)}
            >
              次へ ▶
            </button>
          </div>
          <p className="hint">
            送金件数: {transfers.length}件
            {view.minCountExact ? '（最小）' : '（最適保証なし：人数が多いため近似解です）'}
            {view.minCountExact && !view.patternsComplete && `／表示は先頭${count}パターンまで`}
          </p>

          <div className="result-grid">
            <div className="diagram-scroll">
              <SettlementDiagram
                persons={persons}
                settlementBalance={new Map(view.rows.map((r) => [r.personId, r.settlementBalance]))}
                transfers={transfers}
              />
            </div>
            <div className="result-list">
              <h3>送金一覧</h3>
              {transfers.length === 0 ? (
                <p className="no-transfer">精算は不要です</p>
              ) : (
                <ul>
                  {transfers.map((t, i) => (
                    <li key={i}>
                      {name.get(t.fromId)} → {name.get(t.toId)}：<strong>{formatYen(t.amount)}円</strong>
                    </li>
                  ))}
                </ul>
              )}
              <button type="button" className="primary" onClick={copy}>
                結果をコピー
              </button>
              <span role="status" className="copy-status">
                {copied === 'ok' ? 'コピーしました' : copied === 'fail' ? 'コピーできませんでした' : ''}
              </span>
            </div>
          </div>
        </>
      )}
    </section>
  );
}
