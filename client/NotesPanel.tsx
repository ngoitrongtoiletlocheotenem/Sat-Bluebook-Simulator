import { useEffect, useId, useRef, type ReactNode } from 'react';
import { ChevronLeft, ChevronRight, Trash2 } from 'lucide-react';
import type { Highlight } from '../shared/types';
import './NotesPanel.css';

export interface NotesPanelProps {
  notes: Highlight[];
  selectedId: string | null;
  resizeHandle?: ReactNode;
  disabled?: boolean;
  onNoteChange: (id: string, note: string) => void;
  onDeleteNote: (id: string) => void;
  onClose: () => void;
  onSelect?: (id: string) => void;
  questionNote?: string;
  onQuestionNoteChange?: (note: string) => void;
}

/** Original pair of a slanted highlighter and folded note, with no external assets. */
export function HighlightsNotesIcon({ className = '' }: { className?: string }) {
  return (
    <svg
      className={`highlights-notes-icon ${className}`}
      width="52"
      height="27"
      viewBox="0 0 52 27"
      fill="none"
      aria-hidden="true"
      focusable="false"
    >
      <g stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
        <path d="m13.7 3.6 6.8 6.8-9.4 9.4-5.6-1.2-1.2-5.6 9.4-9.4Z" />
        <path d="m11.4 5.9 6.8 6.8M5.5 18.6l-2.2 2.2 4.8 1.1 3-2.1" />
        <path d="M3.5 24h17" />
        <path d="M30.5 3.7h13a2 2 0 0 1 2 2v12.6l-5.8 5.7h-9.2a2 2 0 0 1-2-2V5.7a2 2 0 0 1 2-2Z" />
        <path d="M39.7 24v-3.7a2 2 0 0 1 2-2h3.8M33.1 9.2h8M33.1 13.4h8M33.1 17.6h3.5" />
      </g>
    </svg>
  );
}

const noteColor = (color: string | undefined) => (color === 'blue' || color === 'pink' ? color : 'yellow');

export default function NotesPanel({
  notes,
  selectedId,
  resizeHandle,
  disabled = false,
  onNoteChange,
  onDeleteNote,
  onClose,
  onSelect,
  questionNote = '',
  onQuestionNoteChange,
}: NotesPanelProps) {
  const panel = useRef<HTMLElement>(null);
  const fields = useRef(new Map<string, HTMLTextAreaElement>());
  const previousSelection = useRef<string | null>(null);
  const questionNoteId = useId();

  useEffect(() => {
    if (!selectedId || previousSelection.current === selectedId) {
      previousSelection.current = selectedId;
      return;
    }
    previousSelection.current = selectedId;
    const field = fields.current.get(selectedId);
    if (!field || disabled) return;
    field.focus({ preventScroll: true });
    field.closest('.highlight-note-card')?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    field.setSelectionRange(field.value.length, field.value.length);
  }, [selectedId, disabled, notes.length]);

  return (
    <aside
      ref={panel}
      className="highlights-notes-panel"
      id="highlights-notes-panel"
      aria-label="Highlights & Notes panel"
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.preventDefault();
          event.stopPropagation();
          onClose();
        }
      }}
    >
      {resizeHandle}
      <div className="notes-panel-utilities">
        <span className="notes-panel-sr-only">Highlights &amp; Notes</span>
        <button
          type="button"
          className="notes-panel-close"
          aria-label="Close notes panel"
          title="Close notes panel"
          onClick={onClose}
        >
          <ChevronLeft size={16} strokeWidth={1.8} />
          <ChevronRight size={16} strokeWidth={1.8} />
        </button>
      </div>
      <div className="notes-panel-scroll">
        {notes.length === 0 && (
          <p className="notes-panel-empty">Select text and choose Add note to save your thoughts here.</p>
        )}
        {notes.map((highlight, index) => (
          <section
            key={highlight.id}
            data-note-id={highlight.id}
            className={`highlight-note-card note-color-${noteColor(highlight.color)}${selectedId === highlight.id ? ' note-card-selected' : ''}`}
            aria-label={`Note ${index + 1}`}
            onFocus={() => onSelect?.(highlight.id)}
          >
            <div className="note-card-heading">
              <blockquote className="note-quote">{highlight.text}</blockquote>
              <button
                type="button"
                className="note-delete"
                aria-label={`Delete note ${index + 1}`}
                title="Delete note"
                disabled={disabled}
                onClick={() => onDeleteNote(highlight.id)}
              >
                <Trash2 size={18} strokeWidth={1.5} />
              </button>
            </div>
            <textarea
              ref={(element) => {
                if (element) fields.current.set(highlight.id, element);
                else fields.current.delete(highlight.id);
              }}
              className="highlight-note-textarea"
              aria-label={`Note for ${highlight.text}`}
              placeholder="Notes are saved automatically."
              value={highlight.note || ''}
              maxLength={4000}
              rows={3}
              disabled={disabled}
              onChange={(event) => onNoteChange(highlight.id, event.target.value)}
            />
          </section>
        ))}
        {onQuestionNoteChange && questionNote.trim() && (
          <section className="question-note-card" aria-label="Question note">
            <label htmlFor={questionNoteId}>Question note</label>
            <textarea
              id={questionNoteId}
              aria-label="Question note"
              className="highlight-note-textarea"
              placeholder="Notes are saved automatically."
              value={questionNote}
              maxLength={4000}
              rows={3}
              disabled={disabled}
              onChange={(event) => onQuestionNoteChange(event.target.value)}
            />
          </section>
        )}
      </div>
    </aside>
  );
}
