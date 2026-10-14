import { useLayoutEffect, useRef, type KeyboardEvent, type PointerEvent, type RefObject } from 'react';
import './NotesResizeHandle.css';

export interface NotesResizeHandleProps {
  containerRef: RefObject<HTMLElement | null>;
  width: number;
  onChange: (width: number) => void;
  defaultWidth: number;
  disabled?: boolean;
  readingSplit: boolean;
}

export function notesWidthLimits(containerWidth: number) {
  const available = Number.isFinite(containerWidth) ? Math.max(0, containerWidth) : 1440;
  const minimum = available <= 760 ? 160 : 180;
  const maximum = Math.max(minimum, Math.min(480, available <= 760 ? available * 0.4 : available - 400));
  return { minimum, maximum };
}

const clamp = (width: number, minimum: number, maximum: number) =>
  Math.max(minimum, Math.min(maximum, Number.isFinite(width) ? width : minimum));

type NoteDrag = {
  pointerId: number;
  startX: number;
  initialWidth: number;
  minimum: number;
  maximum: number;
  readingSplit: boolean;
};

export default function NotesResizeHandle({
  containerRef,
  width,
  onChange,
  defaultWidth,
  disabled = false,
  readingSplit,
}: NotesResizeHandleProps) {
  const drag = useRef<NoteDrag | null>(null);
  const currentWidth = containerRef.current?.clientWidth || window.innerWidth;
  const bounds = notesWidthLimits(currentWidth);

  function dimensions() {
    return notesWidthLimits(containerRef.current?.clientWidth || window.innerWidth);
  }

  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const enforceNoteBounds = () => {
      const containerWidth = container.clientWidth;
      // Small screens stack the rail at full width; preserve desktop preference.
      if (containerWidth <= 520) return;
      const { minimum, maximum } = notesWidthLimits(containerWidth);
      const next = clamp(width, minimum, maximum);
      if (Math.abs(next - width) > 0.5) {
        drag.current = null;
        onChange(Math.round(next));
      }
    };
    enforceNoteBounds();
    const observer = new ResizeObserver(enforceNoteBounds);
    observer.observe(container);
    return () => observer.disconnect();
  });

  function start(event: PointerEvent<HTMLDivElement>) {
    if (disabled || event.button !== 0) return;
    event.preventDefault();
    const { minimum, maximum } = dimensions();
    drag.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      initialWidth: clamp(width, minimum, maximum),
      minimum,
      maximum,
      readingSplit,
    };
    event.currentTarget.focus({ preventScroll: true });
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function move(event: PointerEvent<HTMLDivElement>) {
    const active = drag.current;
    if (!active || active.pointerId !== event.pointerId || disabled) return;
    event.preventDefault();
    const delta = event.clientX - active.startX;
    // In Reading and Writing, equal passage/answer columns flank the rail.
    // Moving its right edge by one pixel changes its width by two pixels.
    const next = active.initialWidth + delta * (active.readingSplit ? 2 : -1);
    onChange(Math.round(clamp(next, active.minimum, active.maximum)));
  }

  function end(event: PointerEvent<HTMLDivElement>) {
    if (drag.current?.pointerId !== event.pointerId) return;
    drag.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }

  function keyboard(event: KeyboardEvent<HTMLDivElement>) {
    if (disabled || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    event.stopPropagation();
    const { minimum, maximum } = dimensions();
    const step = event.shiftKey ? 60 : 20;
    const next =
      event.key === 'Home'
        ? minimum
        : event.key === 'End'
          ? maximum
          : width + (event.key === 'ArrowRight' ? step : -step);
    onChange(Math.round(clamp(next, minimum, maximum)));
  }

  return (
    <div
      className={`notes-resize-handle${readingSplit ? ' notes-resize-reading' : ' notes-resize-math'}${disabled ? ' notes-resize-disabled' : ''}`}
      role="separator"
      tabIndex={disabled ? -1 : 0}
      aria-label="Resize notes panel"
      aria-orientation="vertical"
      aria-controls="highlights-notes-panel"
      aria-valuenow={Math.round(width)}
      aria-valuemin={Math.round(bounds.minimum)}
      aria-valuemax={Math.round(bounds.maximum)}
      aria-valuetext={`Notes panel ${Math.round(width)} pixels wide`}
      aria-disabled={disabled || undefined}
      title="Drag to resize notes"
      onPointerDown={start}
      onPointerMove={move}
      onPointerUp={end}
      onPointerCancel={end}
      onLostPointerCapture={() => {
        drag.current = null;
      }}
      onKeyDown={keyboard}
      onDoubleClick={(event) => {
        if (disabled) return;
        event.preventDefault();
        const { minimum, maximum } = dimensions();
        onChange(Math.round(clamp(defaultWidth, minimum, maximum)));
      }}
    >
      <span className="notes-resize-grip" aria-hidden="true">
        <svg width="20" height="24" viewBox="0 0 20 24" fill="none" focusable="false">
          <path d="m1.5 12 5-4.5v9L1.5 12ZM18.5 12l-5-4.5v9l5-4.5Z" fill="currentColor" />
          <path d="M10 4.5v15" stroke="currentColor" strokeWidth="1.1" />
        </svg>
      </span>
    </div>
  );
}
