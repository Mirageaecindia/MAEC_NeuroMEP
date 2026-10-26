/** Toolbar and status icons drawn after the Figma design (blue, filled). */
import type { ReactElement } from 'react';

const BLUE = '#2563eb';
const DARK = '#1e40af';
const LIGHT = '#93c5fd';

const svg = (children: ReactElement | ReactElement[], size = 26) => (
  <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden focusable="false">
    {children}
  </svg>
);

export const Icons = {
  open: () =>
    svg([
      <path key="a" d="M2 6a2 2 0 0 1 2-2h5l2 2h9a2 2 0 0 1 2 2v1H2z" fill={DARK} />,
      <path key="b" d="M2 9h20l-1.5 10a2 2 0 0 1-2 1.7H5.5A2 2 0 0 1 3.5 19z" fill={BLUE} />,
    ]),
  save: () =>
    svg([
      <path
        key="a"
        d="M2 6a2 2 0 0 1 2-2h5l2 2h9a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2z"
        fill={BLUE}
      />,
      <rect key="b" x="8" y="11" width="9" height="8" rx="1" fill="#e5e7eb" />,
      <rect key="c" x="10" y="12" width="5" height="3" fill="#4b5563" />,
    ]),
  clear: () =>
    svg([
      <path key="a" d="M14 3l7 7-8 8H7l-3-3z" fill={LIGHT} />,
      <path key="b" d="M14 3l7 7-4 4-7-7z" fill={BLUE} />,
      <path key="c" d="M3 21h18" stroke="#9ca3af" strokeWidth="2" />,
    ]),
  zoomIn: () =>
    svg([
      <circle key="a" cx="10" cy="10" r="7" fill="none" stroke={BLUE} strokeWidth="2.5" />,
      <path key="b" d="M15 15l6 6" stroke={DARK} strokeWidth="3" strokeLinecap="round" />,
      <path key="c" d="M10 7v6M7 10h6" stroke={BLUE} strokeWidth="2" />,
    ]),
  zoomOut: () =>
    svg([
      <circle key="a" cx="10" cy="10" r="7" fill="none" stroke={BLUE} strokeWidth="2.5" />,
      <path key="b" d="M15 15l6 6" stroke={DARK} strokeWidth="3" strokeLinecap="round" />,
      <path key="c" d="M7 10h6" stroke={BLUE} strokeWidth="2" />,
    ]),
  reset: () =>
    svg([
      <path
        key="a"
        d="M20 12a8 8 0 1 1-2.3-5.6"
        fill="none"
        stroke={BLUE}
        strokeWidth="2.6"
        strokeLinecap="round"
      />,
      <path key="b" d="M20 3v6h-6z" fill={BLUE} />,
    ]),
  bot: () =>
    svg([
      <rect key="a" x="3" y="8" width="18" height="12" rx="4" fill={BLUE} />,
      <circle key="b" cx="9" cy="14" r="1.8" fill="#fff" />,
      <circle key="c" cx="15" cy="14" r="1.8" fill="#fff" />,
      <path key="d" d="M12 8V4" stroke={BLUE} strokeWidth="2" />,
      <circle key="e" cx="12" cy="3.5" r="1.5" fill={BLUE} />,
    ]),
  smartAi: () =>
    svg([
      <circle key="a" cx="12" cy="12" r="9" fill={LIGHT} />,
      <rect key="b" x="8" y="8" width="8" height="8" rx="1.5" fill={DARK} />,
      <text key="c" x="12" y="14.5" textAnchor="middle" fontSize="6" fill="#fff" fontWeight="700">
        AI
      </text>,
    ]),
  building: () =>
    svg([
      <path key="a" d="M8 22V6l4-4 4 4v16z" fill={LIGHT} />,
      <path key="b" d="M12 2l4 4v16h-4z" fill={BLUE} />,
      <path key="c" d="M5 22h14" stroke="#6b7280" strokeWidth="1.5" />,
    ]),
  sync: () =>
    svg([
      <path
        key="a"
        d="M4 12a8 8 0 0 1 13.7-5.6"
        fill="none"
        stroke={BLUE}
        strokeWidth="2.6"
        strokeLinecap="round"
      />,
      <path
        key="b"
        d="M20 12a8 8 0 0 1-13.7 5.6"
        fill="none"
        stroke={BLUE}
        strokeWidth="2.6"
        strokeLinecap="round"
      />,
      <path key="c" d="M19 3v5h-5z" fill={BLUE} />,
      <path key="d" d="M5 21v-5h5z" fill={BLUE} />,
    ]),
  /** In progress (A-08). */
  pill: (size = 26) =>
    svg(
      <rect x="2.5" y="9" width="19" height="6" rx="3" fill="none" stroke={BLUE} strokeWidth="2" />,
      size,
    ),
  /** Saved and locked (A-08). */
  flag: (size = 26) =>
    svg(
      [
        <path key="a" d="M5 21V4" stroke={DARK} strokeWidth="2" strokeLinecap="round" />,
        <path key="b" d="M5 4c4-2 7 2 14 0v9c-7 2-10-2-14 0z" fill={BLUE} />,
      ],
      size,
    ),
  /** Floor not opened yet (A-08). */
  cross: (size = 26) =>
    svg(
      <path d="M7 7l10 10M17 7L7 17" stroke={BLUE} strokeWidth="2.4" strokeLinecap="round" />,
      size,
    ),
  back: () =>
    svg(
      <path d="M15 3L6 12l9 9" fill="none" stroke={BLUE} strokeWidth="4" strokeLinejoin="round" />,
    ),
  next: () =>
    svg(<path d="M9 3l9 9-9 9" fill="none" stroke={BLUE} strokeWidth="4" strokeLinejoin="round" />),
  guide: () =>
    svg(
      <text
        x="12"
        y="19"
        textAnchor="middle"
        fontSize="20"
        fontStyle="italic"
        fontFamily="Georgia, serif"
        fill={BLUE}
      >
        i
      </text>,
    ),
  logo: () =>
    svg(
      [
        <circle key="a" cx="12" cy="12" r="10" fill="none" stroke={BLUE} strokeWidth="1.5" />,
        <path
          key="b"
          d="M7 12h10M12 7v10M8.5 8.5l7 7M15.5 8.5l-7 7"
          stroke={BLUE}
          strokeWidth="1.2"
        />,
        <circle key="c" cx="12" cy="12" r="2.5" fill={BLUE} />,
      ],
      24,
    ),
};

export type StatusIcon = 'pill' | 'flag' | 'cross';

export function StatusMark(props: { status: StatusIcon; size?: number; label?: string }) {
  const labels = { pill: 'In progress', flag: 'Saved', cross: 'Not opened' };
  return (
    <span
      className="status-mark"
      role="img"
      aria-label={props.label ?? labels[props.status]}
      title={labels[props.status]}
    >
      {Icons[props.status](props.size ?? 20)}
    </span>
  );
}
