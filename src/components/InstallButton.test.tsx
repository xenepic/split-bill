import { act, cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { resetInstallPromptForTests } from '../pwa/installPrompt';
import { InstallButton } from './InstallButton';

const originalUA = navigator.userAgent;
const originalMatchMedia = window.matchMedia;

function setUserAgent(ua: string) {
  Object.defineProperty(window.navigator, 'userAgent', { value: ua, configurable: true });
}

function fireBeforeInstallPrompt(outcome: 'accepted' | 'dismissed') {
  const e = new Event('beforeinstallprompt', { cancelable: true }) as Event & {
    prompt: ReturnType<typeof vi.fn>;
    userChoice: Promise<{ outcome: string }>;
  };
  e.prompt = vi.fn(() => Promise.resolve());
  e.userChoice = Promise.resolve({ outcome });
  act(() => {
    window.dispatchEvent(e);
  });
  return e;
}

afterEach(() => {
  cleanup();
  setUserAgent(originalUA);
  window.matchMedia = originalMatchMedia;
  resetInstallPromptForTests();
});

describe('InstallButton', () => {
  it('非対応環境（イベントなし・iOS 以外）では表示しない', () => {
    render(<InstallButton />);
    expect(screen.queryByRole('button', { name: 'ホーム画面に追加' })).toBeNull();
  });

  it('beforeinstallprompt を受け取ったらボタンを表示し、押すとインストール画面を出す', async () => {
    const user = userEvent.setup();
    render(<InstallButton />);
    const e = fireBeforeInstallPrompt('accepted');
    expect(e.defaultPrevented).toBe(true);
    await user.click(screen.getByRole('button', { name: 'ホーム画面に追加' }));
    expect(e.prompt).toHaveBeenCalledTimes(1);
    // インストールされたらボタンを消す
    expect(screen.queryByRole('button', { name: 'ホーム画面に追加' })).toBeNull();
  });

  it('appinstalled でボタンを消す', () => {
    render(<InstallButton />);
    fireBeforeInstallPrompt('dismissed');
    expect(screen.getByRole('button', { name: 'ホーム画面に追加' })).toBeInTheDocument();
    act(() => {
      window.dispatchEvent(new Event('appinstalled'));
    });
    expect(screen.queryByRole('button', { name: 'ホーム画面に追加' })).toBeNull();
  });

  it('iPhone では共有メニューからの追加手順を案内する', async () => {
    setUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1');
    const user = userEvent.setup();
    render(<InstallButton />);
    await user.click(screen.getByRole('button', { name: 'ホーム画面に追加' }));
    const dialog = screen.getByRole('dialog', { name: 'ホーム画面に追加' });
    expect(within(dialog).getByText(/共有ボタン/)).toBeInTheDocument();
    expect(within(dialog).getByText(/「ホーム画面に追加」をタップ/)).toBeInTheDocument();
  });

  it('ホーム画面から起動している（インストール済み）場合は表示しない', () => {
    setUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)');
    window.matchMedia = ((q: string) => ({
      matches: q.includes('display-mode: standalone'),
      media: q,
      addEventListener: () => {},
      removeEventListener: () => {},
    })) as unknown as typeof window.matchMedia;
    render(<InstallButton />);
    expect(screen.queryByRole('button', { name: 'ホーム画面に追加' })).toBeNull();
  });
});
