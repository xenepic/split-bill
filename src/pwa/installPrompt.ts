import { useSyncExternalStore } from 'react';

/** Chrome / Edge の beforeinstallprompt イベント（標準の型定義にないため自前で定義） */
export type BeforeInstallPromptEvent = Event & {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
};

/**
 * - prompt: ブラウザのインストール画面を表示できる（Android Chrome、PC Chrome / Edge）
 * - ios: iPhone / iPad。共有メニューから追加する手順を案内する
 * - hidden: インストール済み、または案内できない環境
 */
export type InstallAvailability = 'prompt' | 'ios' | 'hidden';

let deferred: BeforeInstallPromptEvent | null = null;
let installed = false;
let initialized = false;
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((l) => l());
}

export function isStandalone(): boolean {
  try {
    if (window.matchMedia?.('(display-mode: standalone)').matches) return true;
  } catch {
    /* noop */
  }
  return (navigator as Navigator & { standalone?: boolean }).standalone === true;
}

export function isIOS(): boolean {
  const ua = navigator.userAgent;
  // iPadOS 13 以降は Mac と同じ UA になるため、タッチ対応かどうかで判定する
  return /iPhone|iPad|iPod/i.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
}

/** イベントを取りこぼさないよう、React の描画前（モジュール読込時）に登録する */
export function initInstallPrompt() {
  if (initialized || typeof window === 'undefined') return;
  initialized = true;
  window.addEventListener('beforeinstallprompt', (e) => {
    // ブラウザ既定のミニ情報バーを出さず、ボタンから表示する
    e.preventDefault();
    deferred = e as BeforeInstallPromptEvent;
    emit();
  });
  window.addEventListener('appinstalled', () => {
    deferred = null;
    installed = true;
    emit();
  });
  try {
    window.matchMedia?.('(display-mode: standalone)').addEventListener?.('change', emit);
  } catch {
    /* noop */
  }
}

initInstallPrompt();

function getAvailability(): InstallAvailability {
  if (installed || isStandalone()) return 'hidden';
  if (deferred) return 'prompt';
  if (isIOS()) return 'ios';
  return 'hidden';
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** インストール画面を表示する。表示後はイベントを再利用できないため破棄する */
export async function promptInstall(): Promise<'accepted' | 'dismissed' | 'unavailable'> {
  const e = deferred;
  if (!e) return 'unavailable';
  deferred = null;
  emit();
  await e.prompt();
  const { outcome } = await e.userChoice;
  if (outcome === 'accepted') installed = true;
  emit();
  return outcome;
}

export function useInstallAvailability(): InstallAvailability {
  return useSyncExternalStore(subscribe, getAvailability, () => 'hidden');
}

/** テスト用: 状態を初期化する */
export function resetInstallPromptForTests() {
  deferred = null;
  installed = false;
  emit();
}
