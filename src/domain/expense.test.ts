import { allocateShares } from './allocate';
import { computeBalances } from './balance';
import {
  addPerson,
  createInitialState,
  nextDefaultName,
  removePerson,
  renamePerson,
  setPayer,
  setPayment,
  setShareAmount,
  setShareMode,
} from './expenseOps';
import { formatSignedYen, formatYen, parseYen } from './money';
import { computeSettlement } from './settle';
import type { AppState, Result, Share } from './types';

function unwrap<T>(r: Result<T>): T {
  if (!r.ok) throw new Error(r.error);
  return r.value;
}

function setup() {
  const s = createInitialState();
  const [A, B, C, D] = s.persons.map((p) => p.id);
  return { s, A, B, C, D, e: s.expenses.map((e) => e.id) };
}

function amounts(state: AppState, row = 0) {
  return state.expenses[row].shares.map((x) => x.amount);
}

function balances(state: AppState) {
  return unwrap(computeBalances(state)).map((b) => b.balance);
}

describe('parseYen', () => {
  it('整数・カンマ区切りを受け付ける', () => {
    expect(parseYen('1000')).toEqual({ ok: true, value: 1000 });
    expect(parseYen(' 1,234,567 ')).toEqual({ ok: true, value: 1234567 });
    expect(parseYen('')).toEqual({ ok: true, value: null });
    expect(parseYen('   ')).toEqual({ ok: true, value: null });
  });
  it('マイナス記号付きは負数', () => {
    expect(parseYen('-1,000')).toEqual({ ok: true, value: -1000 });
    expect(parseYen('−500')).toEqual({ ok: true, value: -500 });
    expect(parseYen('－500')).toEqual({ ok: true, value: -500 });
    expect(parseYen('-0')).toEqual({ ok: true, value: 0 });
  });
  it.each(['--1', '1-', '1.5', '1e3', 'Infinity', 'NaN', '12,34', '１００', '99999999999999999', '0x10'])(
    '%s を拒否する',
    (s) => {
      expect(parseYen(s).ok).toBe(false);
    },
  );
  it('表示', () => {
    expect(formatYen(1234567)).toBe('1,234,567');
    expect(formatSignedYen(-25)).toBe('−25');
    expect(formatSignedYen(25)).toBe('+25');
  });
});

describe('allocateShares', () => {
  const sh = (mode: Share['mode'], amount = 0): Share => ({ personId: 'x', amount, mode });
  it('No.5 1,000円を3人で均等割り → 表示は 333/333/334', () => {
    const r = unwrap(allocateShares(1000, [sh('auto'), sh('auto'), sh('auto')]));
    expect(r.map((x) => x.amount)).toEqual([333, 333, 334]);
  });
  it('表示用の端数は表示順の後ろの auto から1円ずつ（固定・対象外は飛ばす）', () => {
    expect(unwrap(allocateShares(1001, [sh('excluded'), sh('auto'), sh('auto')])).map((x) => x.amount)).toEqual([0, 500, 501]);
    expect(unwrap(allocateShares(1002, [sh('auto'), sh('auto'), sh('fixed', 100), sh('auto')])).map((x) => x.amount)).toEqual([300, 301, 100, 301]);
    expect(unwrap(allocateShares(-1000, [sh('auto'), sh('auto'), sh('auto')])).map((x) => x.amount)).toEqual([-334, -333, -333]);
    expect(unwrap(allocateShares(900, [sh('auto'), sh('auto'), sh('auto')])).map((x) => x.amount)).toEqual([300, 300, 300]);
  });

  it('集計は正確な値（1000/3）で行い、最終収支の端数は支払総額が多い人が得をする', () => {
    const { s, A, B, D, e } = setup();
    let st = unwrap(setPayment(s, e[0], A, 1000));
    st = unwrap(setShareMode(st, e[0], D, 'excluded'));
    expect(amounts(st)).toEqual([333, 333, 334, 0]);
    // 正確な収支: A +666.67 / B −333.33 / C −333.33 → A が得をし、残りは表示順
    expect(balances(st)).toEqual([667, -333, -334, 0]);
    // 支払者を変えても負担額の表示は変わらず、得をする人が変わる
    st = unwrap(setPayer(st, e[0], B));
    expect(amounts(st)).toEqual([333, 333, 334, 0]);
    expect(balances(st)).toEqual([-333, 667, -334, 0]);
  });

  it('端数は行ごとに丸めず合算してから丸める', () => {
    const { s, A, B, D, e } = setup();
    // A/B/C の3人で 100円の支出を3件（A, A, B が支払い）
    let st = s;
    st = unwrap(setPayment(st, e[0], A, 100));
    st = unwrap(setPayment(st, e[1], A, 100));
    st = unwrap(setPayment(st, e[2], B, 100));
    for (const id of e) st = unwrap(setShareMode(st, id, D, 'excluded'));
    // 各人の正確な負担は 100円ちょうど → 収支 A +100 / B 0 / C −100（行ごとの丸めなら1円ずれる）
    expect(balances(st)).toEqual([100, 0, -100, 0]);
    const rows = unwrap(computeBalances(st));
    expect(rows.map((r) => r.owed)).toEqual([100, 100, 100, 0]);
  });

  it('No.6 1人対象外 → 0 / 500 / 500', () => {
    const r = unwrap(allocateShares(1000, [sh('auto'), sh('excluded'), sh('auto')]));
    expect(r.map((x) => x.amount)).toEqual([500, 0, 500]);
  });
  it('固定合計が支払額超過はエラー', () => {
    expect(allocateShares(1000, [sh('fixed', 1200), sh('auto')]).ok).toBe(false);
  });
  it('auto 0人で残額ありはエラー、残額0は有効', () => {
    expect(allocateShares(1000, [sh('fixed', 500), sh('excluded')]).ok).toBe(false);
    expect(allocateShares(1000, [sh('fixed', 1000), sh('excluded')]).ok).toBe(true);
    expect(allocateShares(1000, [sh('excluded'), sh('excluded')]).ok).toBe(false);
  });
});

describe('受入テスト 1〜4, 7', () => {
  it('No.1〜4 固定と固定解除', () => {
    const { s, A, B, D, e } = setup();
    let st = unwrap(setPayment(s, e[0], A, 5000));
    expect(amounts(st)).toEqual([1250, 1250, 1250, 1250]);
    expect(balances(st)).toEqual([3750, -1250, -1250, -1250]);

    st = unwrap(setShareAmount(st, e[0], D, 500));
    expect(amounts(st)).toEqual([1500, 1500, 1500, 500]);
    expect(st.expenses[0].shares[3].mode).toBe('fixed');

    st = unwrap(setShareAmount(st, e[0], B, 2000));
    expect(amounts(st)).toEqual([1250, 2000, 1250, 500]);

    st = unwrap(setShareMode(st, e[0], B, 'auto'));
    expect(amounts(st)).toEqual([1500, 1500, 1500, 500]);
    expect(amounts(st).reduce((a, b) => a + b)).toBe(5000);
  });

  it('No.7 固定合計が支払額を超える変更は拒否', () => {
    const { s, A, B, D, e } = setup();
    let st = unwrap(setPayment(s, e[0], A, 5000));
    st = unwrap(setShareAmount(st, e[0], D, 3000));
    const r = setShareAmount(st, e[0], B, 2500);
    expect(r.ok).toBe(false);
    expect(amounts(st)).toEqual([666, 667, 667, 3000]);
  });

  it('支払額変更は fixed / excluded を保持し auto のみ再計算、不正なら拒否', () => {
    const { s, A, C, D, e } = setup();
    let st = unwrap(setPayment(s, e[0], A, 5000));
    st = unwrap(setShareAmount(st, e[0], D, 2000));
    st = unwrap(setShareMode(st, e[0], C, 'excluded'));
    st = unwrap(setPayment(st, e[0], A, 8000));
    expect(amounts(st)).toEqual([3000, 3000, 0, 2000]);
    expect(setPayment(st, e[0], A, 1000).ok).toBe(false);
  });

  it('支払者変更は負担配分を保持', () => {
    const { s, A, B, D, e } = setup();
    let st = unwrap(setPayment(s, e[0], A, 5000));
    st = unwrap(setShareAmount(st, e[0], D, 500));
    st = unwrap(setPayer(st, e[0], B));
    expect(st.expenses[0].payerId).toBe(B);
    expect(amounts(st)).toEqual([1500, 1500, 1500, 500]);
  });

  it('支払者本人の負担を編集・対象外にできる', () => {
    const { s, A, e } = setup();
    let st = unwrap(setPayment(s, e[0], A, 3000));
    st = unwrap(setShareMode(st, e[0], A, 'excluded'));
    expect(amounts(st)).toEqual([0, 1000, 1000, 1000]);
    expect(balances(st)).toEqual([3000, -1000, -1000, -1000]);
  });

  it('マイナスの支払額（収益）を配分し、収支に反映する', () => {
    const { s, A, B, D, e } = setup();
    // −1,000円を4人 → 他は −250円ずつ
    let st = unwrap(setPayment(s, e[0], A, -1000));
    expect(amounts(st)).toEqual([-250, -250, -250, -250]);
    expect(balances(st)).toEqual([-750, 250, 250, 250]);
    // −1,001円 → 表示は −251/−250/−250/−250、収支は正確な −250.25 ずつから丸める
    st = unwrap(setPayment(st, e[0], A, -1001));
    expect(amounts(st)).toEqual([-251, -250, -250, -250]);
    expect(balances(st)).toEqual([-751, 251, 250, 250]);
    // 負担額は0以下のみ
    expect(setShareAmount(st, e[0], B, 100).ok).toBe(false);
    st = unwrap(setShareAmount(st, e[0], D, -400));
    expect(amounts(st)).toEqual([-201, -200, -200, -400]);
    // 50円丸めでも支払総額がマイナスの人を扱える
    expect(computeSettlement(st, { kind: 'rounded', unit: 50 }).ok).toBe(true);
    // 符号を反転すると固定額も反転する
    st = unwrap(setPayment(st, e[0], A, 1001));
    expect(amounts(st)).toEqual([200, 200, 201, 400]);
    expect(st.expenses[0].shares[3]).toMatchObject({ amount: 400, mode: 'fixed' });
    // 端数が小さくても -0 にならない
    st = unwrap(setPayment(s, e[1], A, -1));
    expect(amounts(st, 1).every((x) => !Object.is(x, -0))).toBe(true);
  });

  it('支払額0/空で行を未入力に戻す（空行は計算しない）', () => {
    const { s, A, D, e } = setup();
    let st = unwrap(setPayment(s, e[0], A, 5000));
    st = unwrap(setShareAmount(st, e[0], D, 500));
    st = unwrap(setPayment(st, e[0], A, null));
    expect(st.expenses[0].payerId).toBeNull();
    expect(st.expenses[0].shares.every((x) => x.mode === 'auto' && x.amount === 0)).toBe(true);
    expect(balances(st)).toEqual([0, 0, 0, 0]);
  });

  it('支払額未入力の行に負担を固定できない', () => {
    const { s, A, e } = setup();
    expect(setShareAmount(s, e[0], A, 100).ok).toBe(false);
  });
});

describe('参加者操作', () => {
  it('追加（既定: 既存の有効支出は対象外）', () => {
    const { s, A, e } = setup();
    let st = unwrap(setPayment(s, e[0], A, 4000));
    const excl = unwrap(addPerson(st, 'E', false));
    expect(amounts(excl)).toEqual([1000, 1000, 1000, 1000, 0]);
    expect(excl.expenses[0].shares[4].mode).toBe('excluded');
    expect(excl.expenses[1].shares[4].mode).toBe('auto');
    st = unwrap(addPerson(st, 'E', true));
    expect(amounts(st)).toEqual([800, 800, 800, 800, 800]);
  });

  it('支払者は削除できない。負担のみの人は削除後に再配分', () => {
    const { s, A, B, e } = setup();
    const st = unwrap(setPayment(s, e[0], A, 3000));
    expect(removePerson(st, A).ok).toBe(false);
    const r = unwrap(removePerson(st, B));
    expect(r.persons).toHaveLength(3);
    expect(amounts(r)).toEqual([1000, 1000, 1000]);
  });

  it('削除で配分が不正になる場合は拒否', () => {
    const { s, A, B, C, D, e } = setup();
    let st = unwrap(setPayment(s, e[0], A, 1000));
    st = unwrap(setShareAmount(st, e[0], A, 0));
    st = unwrap(setShareMode(st, e[0], B, 'excluded'));
    st = unwrap(setShareMode(st, e[0], C, 'excluded'));
    // D だけが auto で 1000 を負担 → D を消すと残額が配分できない
    expect(amounts(st)).toEqual([0, 0, 0, 1000]);
    expect(removePerson(st, D).ok).toBe(false);
  });

  it('No.15 名前変更で収支・精算は変わらない', () => {
    const { s, A, e } = setup();
    const st = unwrap(setPayment(s, e[0], A, 5000));
    const before = unwrap(computeSettlement(st, { kind: 'exact' }));
    const renamed = unwrap(renamePerson(st, A, 'Alice'));
    const after = unwrap(computeSettlement(renamed, { kind: 'exact' }));
    expect(after).toEqual(before);
    expect(renamed.persons[0].name).toBe('Alice');
  });
});

describe('参加者名', () => {
  it('既定名は 参加者1〜4', () => {
    expect(createInitialState().persons.map((p) => p.name)).toEqual(['参加者1', '参加者2', '参加者3', '参加者4']);
  });

  it('同じ名前は追加・変更できない（前後空白・全角半角の違いも同一とみなす）', () => {
    const { s, A, B } = setup();
    expect(addPerson(s, '参加者1', false).ok).toBe(false);
    expect(addPerson(s, ' 参加者１ ', false).ok).toBe(false);
    expect(renamePerson(s, B, '参加者1').ok).toBe(false);
    const r = renamePerson(s, A, 'Bob');
    expect(r.ok).toBe(true);
    expect(renamePerson(unwrap(r), B, 'Ｂｏｂ').ok).toBe(false);
    // 自分自身と同じ名前への変更は可
    expect(renamePerson(s, A, '参加者1').ok).toBe(true);
  });

  it('空の名前は拒否、前後の空白は除去', () => {
    const { s, A } = setup();
    expect(renamePerson(s, A, '   ').ok).toBe(false);
    expect(unwrap(renamePerson(s, A, '  Alice ')).persons[0].name).toBe('Alice');
  });

  it('次の既定名は未使用の最小番号', () => {
    const { s, B } = setup();
    expect(nextDefaultName(s.persons)).toBe('参加者5');
    const removed = unwrap(removePerson(s, B));
    expect(nextDefaultName(removed.persons)).toBe('参加者2');
  });
});

describe('受入テスト 8, 9, 21', () => {
  function case8() {
    const { s, A, C, D, e } = setup();
    let st = unwrap(setPayment(s, e[0], A, 5000));
    st = unwrap(setPayment(st, e[1], C, 10000));
    st = unwrap(setPayment(st, e[2], A, 4000));
    return { st, D, e };
  }

  it('No.8 収支と3件の最小精算', () => {
    const { st } = case8();
    expect(balances(st)).toEqual([4250, -4750, 5250, -4750]);
    const v = unwrap(computeSettlement(st, { kind: 'exact' }));
    expect(v.minCount).toBe(3);
    const [A, B, C, D] = st.persons.map((p) => p.id);
    const keys = v.patterns.map((p) => p.map((t) => `${t.fromId}>${t.toId}:${t.amount}`).sort().join(','));
    const example = [`${B}>${A}:4250`, `${B}>${C}:500`, `${D}>${C}:4750`].sort().join(',');
    expect(keys).toContain(example);
    expect(new Set(keys).size).toBe(keys.length);
    for (const p of v.patterns) expect(p).toHaveLength(3);
  });

  it('No.9 D負担500円固定で2件精算', () => {
    const { st, D, e } = case8();
    const st2 = unwrap(setShareAmount(st, e[0], D, 500));
    expect(balances(st2)).toEqual([4000, -5000, 5000, -4000]);
    const v = unwrap(computeSettlement(st2, { kind: 'exact' }));
    expect(v.minCount).toBe(2);
    expect(v.patterns).toHaveLength(1);
    const [A, B, C] = st2.persons.map((p) => p.id);
    expect(v.patterns[0]).toEqual(
      expect.arrayContaining([
        { fromId: B, toId: C, amount: 5000 },
        { fromId: D, toId: A, amount: 4000 },
      ]),
    );
  });

  it('No.21 モード切替で入力・元の純残高は不変', () => {
    const { st } = case8();
    const snapshot = JSON.stringify(st);
    const exact = unwrap(computeSettlement(st, { kind: 'exact' }));
    const rounded = unwrap(computeSettlement(st, { kind: 'rounded', unit: 50 }));
    expect(JSON.stringify(st)).toBe(snapshot);
    expect(rounded.rows.map((r) => r.balance)).toEqual(exact.rows.map((r) => r.balance));
  });
});
