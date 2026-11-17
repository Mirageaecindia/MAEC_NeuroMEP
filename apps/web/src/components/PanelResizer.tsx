import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from 'react';

/**
 * Side panels resized by dragging their left edge (user request 18 Nov 2026: the right panel was
 * narrow and fixed). The width is remembered in this browser only (a convenience, not project
 * data); it falls back to the default when storage is unavailable.
 */
export function usePanelWidth(key: string, initial: number, min = 200, max = 720) {
  const clamp = useCallback(
    (w: number) =>
      Math.round(Math.min(Math.max(w, min), Math.max(min, Math.min(max, window.innerWidth * 0.6)))),
    [min, max],
  );
  const [width, setWidth] = useState(() => {
    try {
      const saved = Number(localStorage.getItem(`neuromep.panel.${key}`));
      return saved > 0 ? saved : initial;
    } catch {
      return initial;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(`neuromep.panel.${key}`, String(width));
    } catch {
      // storage blocked: the width just is not remembered
    }
  }, [key, width]);
  return { width: clamp(width), setWidth: (w: number) => setWidth(clamp(w)), min, max };
}

/** The drag handle between the main area and a panel on its right. */
export function PanelResizer(props: {
  label: string;
  width: number;
  min: number;
  max: number;
  onWidth: (w: number) => void;
}) {
  const start = useRef<{ x: number; width: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  useEffect(() => {
    if (!dragging) return;
    const move = (e: MouseEvent) => {
      if (!start.current) return;
      // Dragging left widens the panel.
      props.onWidth(start.current.width + start.current.x - e.clientX);
    };
    const up = () => {
      start.current = null;
      setDragging(false);
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
    return () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
    };
  }, [dragging, props]);
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'ArrowLeft') props.onWidth(props.width + 16);
    else if (e.key === 'ArrowRight') props.onWidth(props.width - 16);
    else return;
    e.preventDefault();
  };
  return (
    <div
      className={`panel-resizer${dragging ? ' dragging' : ''}`}
      role="separator"
      aria-orientation="vertical"
      aria-label={props.label}
      aria-valuenow={props.width}
      aria-valuemin={props.min}
      aria-valuemax={props.max}
      tabIndex={0}
      title="Drag to resize the panel (or use the arrow keys)"
      onMouseDown={(e) => {
        e.preventDefault();
        start.current = { x: e.clientX, width: props.width };
        setDragging(true);
      }}
      onKeyDown={onKey}
    />
  );
}
