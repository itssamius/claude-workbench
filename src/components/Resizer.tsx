import { useEffect, useRef, useState } from 'react';

/* A 4px-wide draggable column resizer. Captures mouse events on the document
 * while dragging so the user can move past the handle without dropping the
 * drag, and clamps to [min, max]. Visually subtle until hovered. */
export default function Resizer({
  side,
  width,
  min,
  max,
  onChange,
}: {
  /** Which edge of the panel this handle sits on. Determines drag direction:
   *  - "right" on a left-anchored panel (rail): dragging right grows width
   *  - "left"  on a right-anchored panel (review): dragging left grows width  */
  side: 'left' | 'right';
  width: number;
  min: number;
  max: number;
  onChange: (w: number) => void;
}) {
  const [hover, setHover] = useState(false);
  const [dragging, setDragging] = useState(false);
  const startRef = useRef<{ x: number; w: number } | null>(null);

  useEffect(() => {
    if (!dragging) return;
    function onMove(e: MouseEvent) {
      const start = startRef.current;
      if (!start) return;
      const dx = e.clientX - start.x;
      const next = side === 'right' ? start.w + dx : start.w - dx;
      const clamped = Math.max(min, Math.min(max, next));
      onChange(clamped);
    }
    function onUp() {
      setDragging(false);
      startRef.current = null;
    }
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    return () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
  }, [dragging, side, min, max, onChange]);

  return (
    <div
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onMouseDown={(e) => {
        e.preventDefault();
        startRef.current = { x: e.clientX, w: width };
        setDragging(true);
      }}
      onDoubleClick={() => onChange((min + max) / 2 | 0)}
      title="Drag to resize · double-click to reset"
      style={{
        position: 'absolute',
        top: 0, bottom: 0,
        [side]: -2,
        width: 6,
        cursor: 'col-resize',
        zIndex: 10,
        background: hover || dragging ? 'var(--accent-soft)' : 'transparent',
        transition: dragging ? 'none' : 'background 120ms',
      } as React.CSSProperties}
    />
  );
}
