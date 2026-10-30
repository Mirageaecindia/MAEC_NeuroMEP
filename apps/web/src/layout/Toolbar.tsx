import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Icons, type StatusIcon } from './icons';

/** The toolbar buttons of the Figma design, in order (A-03), plus Undo / Redo. */
export type ToolKey =
  | 'open'
  | 'save'
  | 'clear'
  | 'undo'
  | 'redo'
  | 'zoomIn'
  | 'zoomOut'
  | 'reset'
  | 'bot'
  | 'smartAi'
  | 'building'
  | 'sync'
  | 'status'
  | 'back'
  | 'next'
  | 'guide';

const LABELS: Record<ToolKey, string> = {
  open: 'Open',
  save: 'Save',
  clear: 'Clear',
  undo: 'Undo',
  redo: 'Redo',
  zoomIn: 'Zoom In',
  zoomOut: 'Zoom Out',
  reset: 'Reset',
  bot: 'Bot',
  smartAi: 'Smart - AI',
  building: 'Building',
  sync: 'Sync',
  status: 'Status',
  back: 'Back',
  next: 'Next',
  guide: 'Help',
};

export interface OpenMenuItem {
  label: string;
  onSelect: () => void;
  disabled?: boolean;
}

export interface ToolbarProps {
  /** Buttons that can be pressed on this page; the rest are greyed (Figma per-page states). */
  enabled: ToolKey[];
  /** Buttons shown as pressed (e.g. Building in the Building tab). */
  pressed?: ToolKey[];
  /** Buttons not shown on this page. */
  hidden?: ToolKey[];
  onAction: (key: ToolKey) => void;
  /** When given, Open shows a menu instead of firing onAction('open'). */
  openMenu?: OpenMenuItem[];
  floorPicker: {
    options: { id: string; label: string }[];
    value: string | null;
    onChange?: (id: string) => void;
    enabled: boolean;
  };
  statusIcon?: StatusIcon;
  /** MECH / PHE lock chips (discipline layers). */
  locks?: { mech: boolean; phe: boolean };
}

function Tool(props: {
  k: ToolKey;
  enabled: boolean;
  pressed: boolean;
  onClick: () => void;
  icon: ReactNode;
}) {
  return (
    <button
      type="button"
      className={`tool${props.pressed ? ' pressed' : ''}`}
      disabled={!props.enabled}
      aria-pressed={props.pressed || undefined}
      onClick={props.onClick}
      title={LABELS[props.k]}
    >
      {props.icon}
      <span>{LABELS[props.k]}</span>
    </button>
  );
}

/** Shared toolbar (Figma): Open, Save, floor picker, Clear | Zoom | Bot ... Status | Back, Next, Guide. */
export function Toolbar(props: ToolbarProps) {
  const [menu, setMenu] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!menu) return;
    const close = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setMenu(false);
    };
    window.addEventListener('mousedown', close);
    return () => window.removeEventListener('mousedown', close);
  }, [menu]);

  const tool = (k: ToolKey, icon: ReactNode) =>
    props.hidden?.includes(k) ? null : (
      <Tool
        key={k}
        k={k}
        icon={icon}
        enabled={props.enabled.includes(k)}
        pressed={props.pressed?.includes(k) ?? false}
        onClick={() => props.onAction(k)}
      />
    );

  const fp = props.floorPicker;
  return (
    <div className="toolbar" role="toolbar" aria-label="Tools">
      <div className="tool-group">
        <div className="open-wrap" ref={menuRef}>
          <Tool
            k="open"
            icon={Icons.open()}
            enabled={props.enabled.includes('open')}
            pressed={menu}
            onClick={() => (props.openMenu ? setMenu((m) => !m) : props.onAction('open'))}
          />
          {menu && props.openMenu && (
            <ul className="open-menu" role="menu">
              {props.openMenu.map((item) => (
                <li key={item.label}>
                  <button
                    role="menuitem"
                    disabled={item.disabled}
                    onClick={() => {
                      setMenu(false);
                      item.onSelect();
                    }}
                  >
                    {item.label}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        {tool('save', Icons.save())}
        <div className={`floor-box${fp.enabled ? '' : ' disabled'}`}>
          <label className="floor-pick">
            <span className="muted">Floor: </span>
            <select
              aria-label="Floor"
              disabled={!fp.enabled || fp.options.length === 0}
              value={fp.value ?? ''}
              onChange={(e) => fp.onChange?.(e.target.value)}
            >
              {fp.options.length === 0 && <option value="">-</option>}
              {fp.options.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
          <div className="lock-chips">
            <span className={`lock-chip${props.locks?.mech === false ? ' off' : ''}`}>
              MECH Locked
            </span>
            <span className={`lock-chip${props.locks?.phe === false ? ' off' : ''}`}>
              PHE Locked
            </span>
          </div>
        </div>
        {tool('clear', Icons.clear())}
        {tool('undo', Icons.undo())}
        {tool('redo', Icons.redo())}
      </div>
      <div className="tool-group">
        {tool('zoomIn', Icons.zoomIn())}
        {tool('zoomOut', Icons.zoomOut())}
        {tool('reset', Icons.reset())}
      </div>
      <div className="tool-group">
        {tool('bot', Icons.bot())}
        {tool('smartAi', Icons.smartAi())}
        {tool('building', Icons.building())}
        {tool('sync', Icons.sync())}
        {tool('status', Icons[props.statusIcon ?? 'pill']())}
      </div>
      <div className="tool-group nav-group">
        {tool('back', Icons.back())}
        {tool('next', Icons.next())}
        {tool('guide', Icons.guide())}
      </div>
    </div>
  );
}
