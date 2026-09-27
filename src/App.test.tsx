import { cleanup, render, screen, within, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from './App';
import { STORAGE_KEY } from './storage';

async function flushSave() {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 350));
  });
}

function summaryRow(name: string) {
  const table = screen.getByRole('region', { name: '集計' });
  return within(table).getByRole('row', { name: new RegExp(`^${name}`) });
}

async function payIn(user: ReturnType<typeof userEvent.setup>, row: number, person: string, amount: string) {
  const input = screen.getByLabelText(new RegExp(`^支出${row} の ${person} の支払額`));
  await user.click(input);
  await user.type(input, `${amount}{Enter}`);
}

function transferTexts() {
  const list = screen.getByRole('heading', { name: '送金一覧' }).parentElement!;
  return within(list).queryAllByRole('listitem').map((li) => li.textContent);
}

beforeEach(() => {
  localStorage.clear();
});
afterEach(cleanup);

describe('App', () => {
  it('初期状態: 4人・3行・精算不要', () => {
    render(<App />);
    expect(screen.getAllByLabelText(/^参加者\dの名前$/)).toHaveLength(4);
    expect(screen.getAllByLabelText(/行目の支出名目$/)).toHaveLength(3);
    expect(screen.getByText('精算は不要です')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '前のパターン' })).toBeDisabled();
  });

  it('No.1〜3: 金額入力→均等割り→固定→精算', async () => {
    const user = userEvent.setup();
    render(<App />);
    await payIn(user, 1, '参加者1', '5000');
    expect(within(summaryRow('参加者1')).getByText('+3,750円')).toBeInTheDocument();
    expect(within(summaryRow('参加者2')).getByText('−1,250円')).toBeInTheDocument();

    // D の負担を 500 円に固定
    await user.click(screen.getByRole('button', { name: /支出1 の 参加者4：負担 1,250円/ }));
    const dialog = screen.getByRole('dialog');
    const input = within(dialog).getByLabelText('参加者4 の負担額');
    await user.clear(input);
    await user.type(input, '500{Enter}');
    expect(within(dialog).getByText('🔒 固定')).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: '閉じる' }));
    expect(screen.getByRole('button', { name: /参加者4：負担 500円（固定）/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /参加者2：負担 1,500円/ })).toBeInTheDocument();

    const list = screen.getByRole('heading', { name: '送金一覧' }).parentElement!;
    expect(within(list).getAllByRole('listitem')).toHaveLength(3);
  });

  it('No.7: 支払額を超える固定は拒否してエラー表示', async () => {
    const user = userEvent.setup();
    render(<App />);
    await payIn(user, 1, '参加者1', '1000');
    await user.click(screen.getByRole('button', { name: /支出1 の 参加者2：負担/ }));
    const input = within(screen.getByRole('dialog')).getByLabelText('参加者2 の負担額');
    await user.clear(input);
    await user.type(input, '2000{Enter}');
    expect(within(screen.getByRole('dialog')).getByRole('alert')).toHaveTextContent('超えています');
    await user.click(screen.getByRole('button', { name: '閉じる' }));
    expect(screen.getByRole('button', { name: /参加者2：負担 250円/ })).toBeInTheDocument();
  });

  it('不正な金額入力は拒否', async () => {
    const user = userEvent.setup();
    render(<App />);
    await payIn(user, 1, '参加者1', '-100');
    expect(screen.getByRole('alert')).toHaveTextContent('整数');
    expect(summaryRow('参加者1')).toHaveTextContent('精算不要 0円');
  });

  it('No.10 相当: 50円丸めで調整差額を表示し、元の収支は不変、パターンは先頭へ', async () => {
    const user = userEvent.setup();
    render(<App />);
    // A が 1,221 円を A/B/C で負担（D は対象外）→ A +814 / B −407 / C −407
    await payIn(user, 1, '参加者1', '1221');
    await user.click(screen.getByRole('button', { name: /支出1 の 参加者4：負担/ }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: '対象外にする' }));
    await user.click(screen.getByRole('button', { name: '閉じる' }));
    expect(within(summaryRow('参加者1')).getByText('+814円')).toBeInTheDocument();

    await user.click(screen.getByRole('switch', { name: '50円丸め' }));
    const settle = screen.getByRole('region', { name: '精算' });
    // トグルは精算の見出し横、内訳テーブルは既定で折りたたみ
    expect(within(settle).getByRole('switch', { name: '50円丸め' })).toBeChecked();
    expect(within(settle).getByText('最終収支を50円単位に調節します')).toBeInTheDocument();
    const details = settle.querySelector('details')!;
    expect(details.open).toBe(false);
    await user.click(within(settle).getByText('調整差額の内訳'));
    expect(details.open).toBe(true);
    const rowA = within(settle).getByRole('row', { name: /^参加者1/ });
    expect(rowA).toHaveTextContent('+814円');
    expect(rowA).toHaveTextContent('+800円');
    expect(rowA).toHaveTextContent('−14円（損）');
    expect(within(summaryRow('参加者1')).getByText('+814円')).toBeInTheDocument();
    expect(transferTexts()).toContain('参加者2 → 参加者1：400円');
    expect(transferTexts()).toContain('参加者3 → 参加者1：400円');
  });

  it('No.12: 複数パターンを循環', async () => {
    const user = userEvent.setup();
    render(<App />);
    // A, B が各 2,000 円を 4 人で → A +1,000 / B +1,000 / C −1,000 / D −1,000
    await payIn(user, 1, '参加者1', '2000');
    await payIn(user, 2, '参加者2', '2000');
    expect(screen.getByText('パターン 1 / 2')).toBeInTheDocument();
    const first = screen.getByRole('heading', { name: '送金一覧' }).parentElement!.textContent;
    await user.click(screen.getByRole('button', { name: '次のパターン' }));
    expect(screen.getByText('パターン 2 / 2')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '送金一覧' }).parentElement!.textContent).not.toBe(first);
    await user.click(screen.getByRole('button', { name: '次のパターン' }));
    expect(screen.getByText('パターン 1 / 2')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '前のパターン' }));
    expect(screen.getByText('パターン 2 / 2')).toBeInTheDocument();
    // モード切替で先頭へ戻る（No.21）
    await user.click(screen.getByRole('switch', { name: '50円丸め' }));
    expect(screen.getByText('パターン 1 / 2')).toBeInTheDocument();
  });

  it('No.14: 再読込で状態を復元', async () => {
    const user = userEvent.setup();
    const { unmount } = render(<App />);
    await payIn(user, 1, '参加者1', '5000');
    await user.click(screen.getByRole('button', { name: /支出1 の 参加者4：負担/ }));
    const input = within(screen.getByRole('dialog')).getByLabelText('参加者4 の負担額');
    await user.clear(input);
    await user.type(input, '500{Enter}');
    await user.click(screen.getByRole('button', { name: '閉じる' }));
    await user.click(screen.getByRole('switch', { name: '50円丸め' }));
    await flushSave();
    expect(localStorage.getItem(STORAGE_KEY)).not.toBeNull();
    unmount();

    render(<App />);
    expect(screen.getByRole('button', { name: /参加者4：負担 500円（固定）/ })).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: '50円丸め' })).toBeChecked();
  });

  it('破損データは初期化を確認するまで上書きしない', async () => {
    localStorage.setItem(STORAGE_KEY, '{"broken":');
    const user = userEvent.setup();
    render(<App />);
    expect(screen.getByText(/保存データを復元できませんでした/)).toBeInTheDocument();
    await flushSave();
    expect(localStorage.getItem(STORAGE_KEY)).toBe('{"broken":');
    await user.click(screen.getByRole('button', { name: '初期化する' }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: '初期化' }));
    await flushSave();
    expect(localStorage.getItem(STORAGE_KEY)).not.toBe('{"broken":');
  });

  it('参加者追加（既定は既存支出を対象外）と支払者の削除拒否', async () => {
    const user = userEvent.setup();
    render(<App />);
    await payIn(user, 1, '参加者1', '4000');
    await user.click(screen.getByRole('button', { name: '参加者を追加' }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: '追加' }));
    expect(screen.getAllByLabelText(/^参加者\dの名前$/)).toHaveLength(5);
    expect(screen.getByRole('button', { name: /支出1 の 参加者5：対象外/ })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '参加者1 を削除' }));
    expect(screen.getByRole('alert')).toHaveTextContent('支払者です');
    expect(screen.getAllByLabelText(/^参加者\dの名前$/)).toHaveLength(5);
  });

  it('No.15: 名前変更は表示のみ更新', async () => {
    const user = userEvent.setup();
    render(<App />);
    await payIn(user, 1, '参加者1', '4000');
    const name = screen.getByLabelText('参加者1の名前');
    await user.clear(name);
    await user.type(name, 'Alice{Enter}');
    expect(transferTexts()).toContain('参加者2 → Alice：1,000円');
  });

  it('名前欄: Tab で隣の名前欄へ移り、フォーカス時に全選択', async () => {
    const user = userEvent.setup();
    render(<App />);
    const first = screen.getByLabelText('参加者1の名前') as HTMLInputElement;
    await user.click(first);
    expect(first.selectionStart).toBe(0);
    expect(first.selectionEnd).toBe(first.value.length);
    await user.tab();
    const second = screen.getByLabelText('参加者2の名前') as HTMLInputElement;
    expect(second).toHaveFocus();
    expect(second.selectionStart).toBe(0);
    expect(second.selectionEnd).toBe(second.value.length);
  });

  it('同じ名前への変更・追加は拒否', async () => {
    const user = userEvent.setup();
    render(<App />);
    const second = screen.getByLabelText('参加者2の名前');
    await user.clear(second);
    await user.type(second, '参加者1{Enter}');
    expect(screen.getByRole('alert')).toHaveTextContent('既に登録されています');
    expect(second).toHaveValue('参加者2');

    await user.click(screen.getByRole('button', { name: '参加者を追加' }));
    const dialog = screen.getByRole('dialog');
    const input = within(dialog).getByRole('textbox') as HTMLInputElement;
    // 既定名が全選択された状態で表示される
    expect(input).toHaveValue('参加者5');
    expect(input).toHaveFocus();
    expect(input.selectionStart).toBe(0);
    expect(input.selectionEnd).toBe(input.value.length);
    await user.keyboard('参加者3');
    expect(input).toHaveValue('参加者3');
    await user.click(within(dialog).getByRole('button', { name: '追加' }));
    expect(within(screen.getByRole('dialog')).getByRole('alert')).toHaveTextContent('既に登録されています');
    expect(screen.getAllByLabelText(/^参加者\dの名前$/)).toHaveLength(4);
  });

  it('支払者セルは「/自己負担額」を表示', async () => {
    const user = userEvent.setup();
    render(<App />);
    await payIn(user, 1, '参加者1', '1000');
    const cell = screen.getByRole('button', { name: /支出1 の 参加者1：支払 1,000円/ });
    expect(cell).toHaveTextContent('1,000/250');
    expect(within(cell).getByText('250')).toHaveClass('owed-amount');
  });

  it('コピー', async () => {
    const user = userEvent.setup();
    render(<App />);
    await payIn(user, 1, '参加者1', '2000');
    await user.click(screen.getByRole('button', { name: '結果をコピー' }));
    const text = await navigator.clipboard.readText();
    expect(text).toContain('参加者2 → 参加者1：500円');
    expect(text).toContain('パターン 1 / 1');
  });
});
