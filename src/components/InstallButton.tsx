import { useState } from 'react';
import { promptInstall, useInstallAvailability } from '../pwa/installPrompt';
import { Modal } from './Modal';

/** iOS の共有アイコン（四角から上向き矢印） */
function ShareIcon() {
  return (
    <svg
      className="inline-icon"
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M12 3v12M8 7l4-4 4 4M6 11H5v10h14V11h-1" />
    </svg>
  );
}

/** 「ホーム画面に追加」ボタン。インストール済み・非対応の環境では表示しない */
export function InstallButton() {
  const availability = useInstallAvailability();
  const [showIosHelp, setShowIosHelp] = useState(false);
  if (availability === 'hidden' && !showIosHelp) return null;

  return (
    <>
      {availability !== 'hidden' && (
        <button
          type="button"
          onClick={() => {
            if (availability === 'prompt') void promptInstall();
            else setShowIosHelp(true);
          }}
        >
          ホーム画面に追加
        </button>
      )}
      {showIosHelp && (
        <Modal
          title="ホーム画面に追加"
          onClose={() => setShowIosHelp(false)}
          footer={
            <button type="button" className="primary" onClick={() => setShowIosHelp(false)}>
              閉じる
            </button>
          }
        >
          <p>Safari の共有メニューから、このアプリをホーム画面に追加できます。</p>
          <ol className="install-steps">
            <li>
              画面下（iPad では上）の共有ボタン <ShareIcon /> をタップ
            </li>
            <li>メニューを下にスクロールして「ホーム画面に追加」をタップ</li>
            <li>右上の「追加」をタップ</li>
          </ol>
          <p className="hint">
            ホーム画面のアイコンから起動すると、アプリとして全画面で使えます。オフラインでも利用できます。
          </p>
        </Modal>
      )}
    </>
  );
}
