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
  it.each(['-1', '1.5', '1e3', 'Infinity', 'NaN', '12,34', '１００', '99999999999999999', '0x10'])(
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
  it('No.5 1,000円を3人で均等割り → 334/333/333', () => {
    const r = unwrap(allocateShares(1000, [sh('auto'), sh('auto'), sh('auto')]));
    expect(r.map((x) => x.amount)).toEqual([334, 333, 333]);
  });
  it('端数は支払者だけが得をする: 支払者以外は切り上げ、支払者が残り', () => {
    const shares = ['a', 'b', 'c'].map((id): Share => ({ personId: id, amount: 0, mode: 'auto' }));
    expect(unwrap(allocateShares(1000, shares, 'a')).map((x) => x.amount)).toEqual([332, 334, 334]);
    expect(unwrap(allocateShares(1000, shares, 'c')).map((x) => x.amount)).toEqual([334, 334, 332]);
    expect(unwrap(allocateShares(1001, [...shares, { personId: 'd', amount: 0, mode: 'auto' }], 'b')).map((x) => x.amount)).toEqual([251, 248, 251, 251]);
    // 割り切れる場合は均等
    expect(unwrap(allocateShares(900, shares, 'a')).map((x) => x.amount)).toEqual([300, 300, 300]);
  });

  it('支払者が auto でない、または支払者の負担が負になる場合は表示順に配分', () => {
    const sh3 = (payerMode: Share['mode']): Share[] => [
      { personId: 'a', amount: 0, mode: payerMode },
      { personId: 'b', amount: 0, mode: 'auto' },
      { personId: 'c', amount: 0, mode: 'auto' },
    ];
    expect(unwrap(allocateShares(1001, sh3('excluded'), 'a')).map((x) => x.amount)).toEqual([0, 501, 500]);
    const four = ['a', 'b', 'c', 'd'].map((id): Share => ({ personId: id, amount: 0, mode: 'auto' }));
    // 5円/4人: 他を2円にすると支払者が −1円になるため表示順配分
    expect(unwrap(allocateShares(5, four, 'a')).map((x) => x.amount)).toEqual([2, 1, 1, 1]);
  });

  it('支払者変更で端数の負担者も変わる（固定・対象外は保持）', () => {
    const { s, A, B, D, e } = setup();
    let st = unwrap(setPayment(s, e[0], A, 1000));
    st = unwrap(setShareMode(st, e[0], D, 'excluded'));
    expect(amounts(st)).toEqual([332, 334, 334, 0]);
    st = unwrap(setPayer(st, e[0], B));
    expect(amounts(st)).toEqual([334, 332, 334, 0]);
    expect(st.expenses[0].shares[3].mode).toBe('excluded');
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
    // 端数は支払者 A が吸収（他は切り上げ）
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
