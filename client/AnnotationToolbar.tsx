import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import { ChevronDown, Trash2 } from 'lucide-react';
import './AnnotationToolbar.css';

export type UnderlineStyle = 'none' | 'solid' | 'dashed' | 'dotted';

export interface AnnotationToolbarProps {
  /** Viewport coordinates for the upper left corner of the floating palette. */
  position: { x: number; y: number };
  color: string;
  underlineStyle: UnderlineStyle;
  canDelete: boolean;
  hasNote: boolean;
  onColorChange: (color: string) => void;
  onUnderlineChange: (style: UnderlineStyle) => void;
  onDelete: () => void;
  onAddNote: () => void;
  onClose: () => void;
  busy?: boolean;
  readOnly?: boolean;
}

const styles: UnderlineStyle[] = ['solid', 'dashed', 'dotted', 'none'];
const colors = ['yellow', 'blue', 'pink'];

function StickyNoteIcon({ hasNote }: { hasNote: boolean }) {
  return (
    <svg
      width="29"
      height="29"
      viewBox="0 0 32 32"
      fill="none"
      aria-hidden="true"
      className="annotation-sticky-icon"
    >
      <path
        d="M6 4.5h17.5A2 2 0 0 1 25.5 6.5V21l-7 7H6a2 2 0 0 1-2-2V6.5a2 2 0 0 1 2-2Z"
        fill="#fff3ae"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
      <path d="M18.5 28v-5a2 2 0 0 1 2-2h5" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
      {hasNote ? (
        <path d="M9 11h11M9 15h8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      ) : (
        <path d="M14.5 9v10M9.5 14h10" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      )}
    </svg>
  );
}

export default function AnnotationToolbar({
  position,
  color,
  underlineStyle,
  canDelete,
  hasNote,
  onColorChange,
  onUnderlineChange,
  onDelete,
  onAddNote,
  onClose,
  busy = false,
  readOnly = false,
}: AnnotationToolbarProps) {
  const root = useRef<HTMLDivElement>(null);
  const underlineButton = useRef<HTMLButtonElement>(null);
  const styleButtons = useRef<(HTMLButtonElement | null)[]>([]);
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuIndex, setMenuIndex] = useState(Math.max(0, styles.indexOf(underlineStyle)));
  const [fit, setFit] = useState(position);
  const [openUp, setOpenUp] = useState(false);
  const menuId = useId();
  const disabled = busy || readOnly;

  useLayoutEffect(() => {
    const palette = root.current;
    if (!palette) return;
    const measure = () => {
      const viewport = window.visualViewport;
      const left = viewport?.offsetLeft || 0;
      const top = viewport?.offsetTop || 0;
      const width = viewport?.width || window.innerWidth;
      const height = viewport?.height || window.innerHeight;
      const margin = 8;
      const panelWidth = palette.offsetWidth;
      const panelHeight = palette.offsetHeight;
      const popoverHeight =
        palette.querySelector<HTMLElement>('.annotation-underline-menu')?.offsetHeight || 0;
      const x = Math.max(left + margin, Math.min(position.x, left + width - panelWidth - margin));
      let y = Math.max(top + margin, Math.min(position.y, top + height - panelHeight - margin));
      const below = top + height - (y + panelHeight) - margin;
      const above = y - top - margin;
      const up = popoverHeight > below && above > below;
      if (popoverHeight && !up)
        y = Math.max(top + margin, Math.min(y, top + height - panelHeight - popoverHeight - 8 - margin));
      if (popoverHeight && up)
        y = Math.min(top + height - panelHeight - margin, Math.max(y, top + popoverHeight + 8 + margin));
      setFit((previous) => (previous.x === x && previous.y === y ? previous : { x, y }));
      setOpenUp(up);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(palette);
    palette
      .querySelectorAll<HTMLElement>('.annotation-underline-menu')
      .forEach((element) => observer.observe(element));
    window.addEventListener('resize', measure);
    window.visualViewport?.addEventListener('resize', measure);
    window.visualViewport?.addEventListener('scroll', measure);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', measure);
      window.visualViewport?.removeEventListener('resize', measure);
      window.visualViewport?.removeEventListener('scroll', measure);
    };
  }, [position.x, position.y, menuOpen]);

  useEffect(() => {
    if (!menuOpen) return;
    const outside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setMenuOpen(false);
    };
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, [menuOpen]);

  function focusStyle(index: number) {
    const next = (index + styles.length) % styles.length;
    setMenuIndex(next);
    styleButtons.current[next]?.focus();
  }

  function closeMenu(returnFocus = false) {
    setMenuOpen(false);
    if (returnFocus) underlineButton.current?.focus();
  }

  function menuKeys(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      event.stopPropagation();
      focusStyle(menuIndex + (event.key === 'ArrowDown' ? 1 : -1));
    } else if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault();
      event.stopPropagation();
      focusStyle(event.key === 'Home' ? 0 : styles.length - 1);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      closeMenu(true);
    } else if (event.key === 'Tab') closeMenu();
  }

  function toolbarKeys(event: KeyboardEvent<HTMLDivElement>) {
    if (event.defaultPrevented) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      if (menuOpen) closeMenu(true);
      else onClose();
      return;
    }
    if (!(event.target instanceof HTMLButtonElement) || event.target.closest('[role="menu"]')) return;
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    const buttons = Array.from(
      root.current?.querySelectorAll<HTMLButtonElement>('.annotation-palette button:not(:disabled)') || [],
    );
    if (!buttons.length) return;
    const index = buttons.indexOf(event.target);
    const next =
      event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? buttons.length - 1
          : (index + (event.key === 'ArrowRight' ? 1 : -1) + buttons.length) % buttons.length;
    event.preventDefault();
    event.stopPropagation();
    buttons[next]?.focus();
  }

  return (
    <div
      ref={root}
      className={`annotation-toolbar${openUp ? ' annotation-opens-up' : ''}`}
      role="toolbar"
      aria-label="Highlights & Notes"
      aria-orientation="horizontal"
      aria-busy={busy || undefined}
      style={{ left: fit.x, top: fit.y }}
      onKeyDown={toolbarKeys}
      onPointerDown={(event) => {
        // Preserve the anchored passage selection while clicking formatting tools.
        if ((event.target as Element).closest('button') && event.button === 0) event.preventDefault();
      }}
    >
      <div className="annotation-palette">
        <div className="annotation-color-group" role="group" aria-label="Highlight color">
          {colors.map((swatch) => (
            <button
              key={swatch}
              type="button"
              className={`annotation-swatch annotation-swatch-${swatch}`}
              aria-label={`Highlight ${swatch}`}
              aria-pressed={color === swatch}
              title={`Highlight ${swatch}`}
              disabled={disabled}
              onClick={() => onColorChange(swatch)}
            />
          ))}
        </div>
        <div className="annotation-underline-control">
          <button
            type="button"
            className="annotation-underline-toggle"
            aria-label="Toggle underline"
            title={underlineStyle === 'none' ? 'Underline text' : 'Remove underline'}
            aria-pressed={underlineStyle !== 'none'}
            disabled={disabled}
            onClick={() => onUnderlineChange(underlineStyle === 'none' ? 'solid' : 'none')}
          >
            <span
              className={`annotation-u annotation-u-${underlineStyle === 'none' ? 'solid' : underlineStyle}`}
              aria-hidden="true"
            >
              U
            </span>
          </button>
          <button
            ref={underlineButton}
            type="button"
            className="annotation-underline-chevron"
            aria-label="Underline options"
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            aria-controls={menuOpen ? menuId : undefined}
            title="Underline options"
            disabled={disabled}
            onClick={(event) => {
              const next = !menuOpen;
              setMenuOpen(next);
              const index = Math.max(0, styles.indexOf(underlineStyle));
              setMenuIndex(index);
              if (next && event.detail === 0)
                requestAnimationFrame(() => styleButtons.current[index]?.focus());
            }}
            onKeyDown={(event) => {
              if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                event.preventDefault();
                event.stopPropagation();
                setMenuOpen(true);
                const index =
                  event.key === 'ArrowUp' ? styles.length - 1 : Math.max(0, styles.indexOf(underlineStyle));
                setMenuIndex(index);
                requestAnimationFrame(() => styleButtons.current[index]?.focus());
              }
            }}
          >
            <ChevronDown size={17} strokeWidth={2} />
          </button>
        </div>
        <button
          type="button"
          className="annotation-round-button annotation-delete"
          aria-label="Delete highlight"
          title="Delete highlight"
          disabled={!canDelete || disabled}
          onClick={onDelete}
        >
          <Trash2 size={25} strokeWidth={1.6} />
        </button>
        <span className="annotation-divider" aria-hidden="true" />
        <button
          type="button"
          className="annotation-round-button annotation-note-button"
          aria-label={hasNote ? 'Edit note' : 'Add note'}
          title={hasNote ? 'Edit note' : 'Add note'}
          aria-controls="highlights-notes-panel"
          disabled={disabled}
          onClick={() => {
            closeMenu();
            onAddNote();
          }}
        >
          <StickyNoteIcon hasNote={hasNote} />
        </button>
      </div>

      {menuOpen && (
        <div
          id={menuId}
          className="annotation-underline-menu"
          role="menu"
          aria-label="Underline style"
          onKeyDown={menuKeys}
        >
          {styles.map((style, index) => (
            <button
              key={style}
              ref={(element) => {
                styleButtons.current[index] = element;
              }}
              type="button"
              role="menuitemradio"
              aria-label={style === 'none' ? 'None' : `${style[0].toUpperCase()}${style.slice(1)} underline`}
              aria-checked={underlineStyle === style}
              tabIndex={menuIndex === index ? 0 : -1}
              className="annotation-underline-option"
              onFocus={() => setMenuIndex(index)}
              onClick={() => {
                onUnderlineChange(style);
                closeMenu(document.activeElement === styleButtons.current[index]);
              }}
            >
              {style === 'none' ? (
                <span className="annotation-no-underline">None</span>
              ) : (
                <span className={`annotation-u annotation-u-${style}`} aria-hidden="true">
                  U
                </span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
