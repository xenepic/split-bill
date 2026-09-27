/**
 * 「行と列を入れ替え」アイコン（24×24 の線画、色は currentColor）。
 * L字型の表（上段3マス・左列2マス）と、内側の角を中心とした同心円弧の双方向矢印
 * （外側: 左列→上段、内側: 上段→左列）で、行と列の相互変換を表す。
 */
export function TransposeIcon({ size = 20 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M3 3h18v6H3zM9 3v6M15 3v6M3 9v12h6V9M3 15h6" />
      <path d="M12.55 19.94A11.5 11.5 0 0 0 19.94 12.55M20.94 15.30 19.94 12.55 17.51 14.18" />
      <path d="M15.95 11.81A7.5 7.5 0 0 1 11.81 15.95M13.27 13.42 11.81 15.95 14.62 16.76" />
    </svg>
  );
}
