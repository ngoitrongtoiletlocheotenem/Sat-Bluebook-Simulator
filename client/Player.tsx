import { lazy, Suspense, useEffect, useRef, useState, type ReactNode } from 'react';
import {
  Bookmark,
  Calculator as CalculatorIcon,
  Check,
  ChevronDown,
  ChevronUp,
  Clock,
  MoreHorizontal,
  Pause,
  SquareFunction,
  X,
} from 'lucide-react';
import type { Attempt, Highlight, Response, ReviewItem } from '../shared/types';
import { emptyResponse } from '../shared/types';
import { api, ApiError, json } from './api';
import { useApp } from './ui';
import RichText, { captureTextSelection } from './RichText';
import AnnotationToolbar, { type UnderlineStyle } from './AnnotationToolbar';
import NotesPanel, { HighlightsNotesIcon } from './NotesPanel';
import NotesResizeHandle from './NotesResizeHandle';
import './Player.css';

const Calculator = lazy(() => import('./Calculator'));
type Pending = {
  moduleId: string;
  currentQuestion: number;
  responses: Record<string, Response>;
  revision: number;
};
type SelectionAnchor = Omit<Highlight, 'id' | 'color' | 'note'>;
const formatTime = (seconds: number) =>
  `${Math.floor(Math.max(0, seconds) / 60)
    .toString()
    .padStart(2, '0')}:${Math.floor(Math.max(0, seconds) % 60)
    .toString()
    .padStart(2, '0')}`;

function TestDialog({
  title,
  onClose,
  children,
  className = '',
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  className?: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const dialog = ref.current;
    dialog?.showModal();
    return () => {
      dialog?.close();
      previous?.focus();
    };
  }, []);
  return (
    <dialog
      ref={ref}
      className={`test-dialog ${className}`}
      aria-label={title}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      <div className="test-dialog-header">
        <h2>{title}</h2>
        <button onClick={onClose} aria-label={`Close ${title}`}>
          <X size={21} />
        </button>
      </div>
      <div className="test-dialog-body">{children}</div>
    </dialog>
  );
}

export default function Player({
  attemptId,
  onExit,
  onComplete,
}: {
  attemptId: string;
  onExit: () => void;
  onComplete: (id: string) => void;
}) {
  const { user } = useApp();
  const [attempt, setAttempt] = useState<Attempt | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [clock, setClock] = useState(Date.now());
  const [saveStatus, setSaveStatus] = useState('All changes saved');
  const [timerHidden, setTimerHidden] = useState(false);
  const [eliminator, setEliminator] = useState(false);
  const [navigatorOpen, setNavigatorOpen] = useState(false);
  const [review, setReview] = useState(false);
  const [more, setMore] = useState(false);
  const [calculator, setCalculator] = useState(false);
  const [dialog, setDialog] = useState<'reference' | 'shortcuts' | 'help' | 'submit' | 'exit' | null>(null);
  const [lineReader, setLineReader] = useState(false);
  const [lineY, setLineY] = useState(72);
  const [zoom, setZoom] = useState(100);
  const [anchor, setAnchor] = useState<SelectionAnchor | null>(null);
  const [editingHighlight, setEditingHighlight] = useState<string | null>(null);
  const [highlightColor, setHighlightColor] = useState('yellow');
  const [underlineStyle, setUnderlineStyle] = useState<UnderlineStyle>('none');
  const [annotationPosition, setAnnotationPosition] = useState<{ x: number; y: number } | null>(null);
  const [highlightsMode, setHighlightsMode] = useState(false);
  const [notesPanelOpen, setNotesPanelOpen] = useState(() => {
    try {
      return localStorage.getItem(`sat-notes-panel:${attemptId}`) === 'open';
    } catch {
      return false;
    }
  });
  const [selectedNoteId, setSelectedNoteId] = useState<string | null>(null);
  const defaultNotesWidth = Math.max(210, Math.min(280, window.innerWidth * 0.2));
  const [notesWidth, setNotesWidth] = useState(() => {
    try {
      const value = Number(localStorage.getItem(`sat-notes-width:${attemptId}`));
      return Number.isFinite(value) && value >= 160 && value <= 480 ? value : defaultNotesWidth;
    } catch {
      return defaultNotesWidth;
    }
  });
  const [tutorResults, setTutorResults] = useState<Record<string, ReviewItem>>({});
  const [otherWindow, setOtherWindow] = useState(false);
  const attemptRef = useRef<Attempt | null>(null);
  const pending = useRef<Pending | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saving = useRef<Promise<void> | null>(null);
  const busyRef = useRef(false);
  const activeSince = useRef(Date.now());
  const wasVisible = useRef(document.visibilityState !== 'hidden');
  const annotationDraft = useRef<Highlight | null>(null);
  const currentNumber = useRef<HTMLDivElement>(null);
  const moreRef = useRef<HTMLDivElement>(null);
  const workspaceRef = useRef<HTMLElement>(null);
  const key = `sat-attempt-pending:${attemptId}`;
  const handlers = useRef<{
    finish: () => Promise<void>;
    flush: () => Promise<void>;
    record: () => void;
    load: () => Promise<void>;
  }>(null!);
  const completed = useRef(false);
  const ownerId = useRef(crypto.randomUUID());
  const readOnly = useRef(false);
  const leaseKey = `sat-attempt-owner:${attemptId}`;

  function setWindowLock(locked: boolean) {
    readOnly.current = locked;
    setOtherWindow(locked);
    if (locked) {
      closeAnnotation();
      setDialog(null);
      setNavigatorOpen(false);
      setCalculator(false);
      setMore(false);
      setSaveStatus('Open in another window');
    }
  }
  function leaseOwner(): { owner: string; updated: number } | null {
    try {
      const value = localStorage.getItem(leaseKey);
      return value ? (JSON.parse(value) as { owner: string; updated: number }) : null;
    } catch {
      return null;
    }
  }
  function ownsWindow() {
    const lease = leaseOwner();
    if (lease && lease.owner !== ownerId.current) {
      setWindowLock(true);
      return false;
    }
    return !readOnly.current;
  }
  function claimWindow(force = false) {
    const lease = leaseOwner();
    if (!force && lease && lease.owner !== ownerId.current && Date.now() - lease.updated < 15000) {
      setWindowLock(true);
      return false;
    }
    try {
      localStorage.setItem(leaseKey, JSON.stringify({ owner: ownerId.current, updated: Date.now() }));
    } catch {
      /* Server ownership and deadline checks still apply when device storage is unavailable. */
    }
    setWindowLock(false);
    return true;
  }
  async function inWindowLock<T>(action: () => Promise<T>): Promise<T> {
    const run = async () => {
      if (!ownsWindow())
        throw new Error('This attempt is active in another window. Continue here to take over.');
      return action();
    };
    return navigator.locks ? navigator.locks.request(`sat-attempt-write:${attemptId}`, run) : run();
  }

  function apply(value: Attempt) {
    attemptRef.current = value;
    setAttempt(value);
    if (value.status === 'completed' && !completed.current) {
      completed.current = true;
      onComplete(attemptId);
    }
  }
  function storePending() {
    if (!ownsWindow()) return;
    try {
      if (pending.current) localStorage.setItem(key, JSON.stringify(pending.current));
      else localStorage.removeItem(key);
    } catch {
      setSaveStatus('Device storage unavailable. Keep this window open until saved.');
    }
  }
  function enqueue(responseId?: string, response?: Response) {
    const active = attemptRef.current;
    if (!active?.module || active.status !== 'active' || !ownsWindow()) return;
    if (pending.current?.moduleId !== active.module.id)
      pending.current = {
        moduleId: active.module.id,
        currentQuestion: active.currentQuestion,
        responses: {},
        revision: 0,
      };
    const changes = pending.current;
    if (responseId && response) changes.responses[responseId] = response;
    changes.currentQuestion = active.currentQuestion;
    changes.revision++;
    storePending();
    setSaveStatus(navigator.onLine ? 'Saving…' : 'Saved on this device · offline');
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      void flush().catch((failure: unknown) => {
        if (failure instanceof ApiError && failure.status === 409) void load();
      });
    }, 500);
  }
  function updateResponse(partial: Partial<Response>, questionId?: string) {
    const active = attemptRef.current;
    const id = questionId || active?.module?.questions?.[active.currentQuestion]?.id;
    if (
      !active ||
      !id ||
      !ownsWindow() ||
      active.status !== 'active' ||
      (active.module?.deadline && Date.parse(active.module.deadline) <= Date.now())
    )
      return;
    const response = { ...(active.responses[id] || emptyResponse()), ...partial };
    apply({ ...active, responses: { ...active.responses, [id]: response } });
    enqueue(id, response);
  }
  function recordElapsed() {
    const active = attemptRef.current;
    const now = Date.now();
    const elapsed = now - activeSince.current;
    activeSince.current = now;
    const visibleBefore = wasVisible.current;
    wasVisible.current = document.visibilityState !== 'hidden';
    const id = active?.module?.questions?.[active.currentQuestion]?.id;
    if (
      !active ||
      !ownsWindow() ||
      active.status !== 'active' ||
      !id ||
      review ||
      !visibleBefore ||
      elapsed < 50
    )
      return;
    const response = active.responses[id] || emptyResponse();
    updateResponse({ elapsedMs: response.elapsedMs + Math.min(elapsed, 60000) }, id);
  }
  async function flush() {
    if (!ownsWindow()) return;
    if (saving.current) {
      await saving.current;
      if (pending.current) return flush();
      return;
    }
    if (!pending.current) return;
    if (!navigator.onLine)
      throw new Error('You are offline. Your changes are saved on this device. Reconnect to continue.');
    const snapshot = structuredClone(pending.current);
    const operation = (async () => {
      try {
        await inWindowLock(() => api<Attempt>(`/attempts/${attemptId}`, json('PATCH', snapshot)));
        if (!ownsWindow()) return;
        if (pending.current?.moduleId === snapshot.moduleId) {
          if (pending.current.revision === snapshot.revision) pending.current = null;
          else
            for (const [id, response] of Object.entries(snapshot.responses))
              if (JSON.stringify(pending.current.responses[id]) === JSON.stringify(response))
                delete pending.current.responses[id];
          storePending();
        }
        setSaveStatus(pending.current ? 'Saving…' : 'All changes saved');
      } catch (failure) {
        setSaveStatus('Saved on this device · waiting to reconnect');
        throw failure;
      }
    })();
    saving.current = operation;
    try {
      await operation;
    } finally {
      saving.current = null;
    }
    if (pending.current) await flush();
  }
  async function load() {
    try {
      setError('');
      const value = await api<Attempt>(`/attempts/${attemptId}`);
      if (value.module && pending.current?.moduleId === value.module.id && value.status === 'active') {
        const ids = new Set(value.module.questions?.map((question) => question.id));
        const responses = Object.fromEntries(
          Object.entries(pending.current.responses).filter(([id]) => ids.has(id)),
        );
        value.responses = { ...value.responses, ...responses };
        value.currentQuestion = Math.max(
          0,
          Math.min((value.module.questions?.length || 1) - 1, pending.current.currentQuestion),
        );
      } else if (pending.current && pending.current.moduleId !== value.module?.id) {
        // The server closed this module at its deadline; stale local edits cannot unlock it.
        pending.current = null;
        storePending();
        setSaveStatus('Module closed · latest server state restored');
      }
      apply(value);
      activeSince.current = Date.now();
      if (pending.current && !readOnly.current) void flush().catch(() => {});
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Unable to load the attempt.');
    }
  }
  async function transition(path: 'finish-module' | 'continue' | 'pause' | 'resume') {
    if (busyRef.current || !ownsWindow()) return;
    busyRef.current = true;
    setBusy(true);
    setError('');
    closeAnnotation();
    try {
      const moduleId = attemptRef.current?.module?.id;
      recordElapsed();
      await flush();
      const value = await inWindowLock(() =>
        api<Attempt>(
          `/attempts/${attemptId}/${path}`,
          json('POST', path === 'finish-module' ? { moduleId } : undefined),
        ),
      );
      apply(value);
      setReview(false);
      setDialog(null);
      setNavigatorOpen(false);
      setCalculator(false);
      setTimerHidden(false);
      setTutorResults({});
      activeSince.current = Date.now();
    } catch (failure) {
      if (failure instanceof ApiError && failure.status === 409) {
        await load();
        setReview(false);
        setDialog(null);
        setNavigatorOpen(false);
      } else setError(failure instanceof Error ? failure.message : 'The action could not be saved.');
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }
  async function finish() {
    await transition('finish-module');
  }
  handlers.current = { finish, flush, record: recordElapsed, load };

  useEffect(() => {
    claimWindow();
    try {
      const cached = localStorage.getItem(key);
      if (cached) {
        const parsed = JSON.parse(cached) as Pending;
        if (
          typeof parsed.moduleId === 'string' &&
          typeof parsed.currentQuestion === 'number' &&
          parsed.responses &&
          typeof parsed.revision === 'number'
        )
          pending.current = parsed;
      }
    } catch {
      try {
        localStorage.removeItem(key);
      } catch {
        setSaveStatus('Device storage unavailable. Keep this window open until saved.');
      }
    }
    void handlers.current.load();
    const timer = setInterval(() => setClock(Date.now()), 1000);
    const persistence = setInterval(() => {
      handlers.current.record();
      void handlers.current.flush().catch(() => {});
    }, 10000);
    const leaseTimer = setInterval(() => {
      const lease = leaseOwner();
      if (!readOnly.current && (!lease || lease.owner === ownerId.current)) claimWindow(true);
      else if (lease && lease.owner !== ownerId.current) setWindowLock(true);
    }, 5000);
    const storage = (event: StorageEvent) => {
      if (event.key === leaseKey) {
        const lease = leaseOwner();
        if (lease?.owner !== ownerId.current) setWindowLock(true);
      }
    };
    const online = () => {
      setSaveStatus('Reconnecting…');
      void handlers.current
        .flush()
        .then(() => handlers.current.load())
        .catch(() => {});
    };
    const offline = () => setSaveStatus('Saved on this device · offline');
    const hide = (event: Event) => {
      handlers.current.record();
      storePending();
      if (event.type === 'pagehide' && leaseOwner()?.owner === ownerId.current)
        localStorage.removeItem(leaseKey);
    };
    window.addEventListener('online', online);
    window.addEventListener('offline', offline);
    window.addEventListener('pagehide', hide);
    window.addEventListener('storage', storage);
    document.addEventListener('visibilitychange', hide);
    return () => {
      clearInterval(timer);
      clearInterval(persistence);
      clearInterval(leaseTimer);
      if (saveTimer.current) clearTimeout(saveTimer.current);
      handlers.current.record();
      storePending();
      if (leaseOwner()?.owner === ownerId.current) localStorage.removeItem(leaseKey);
      window.removeEventListener('online', online);
      window.removeEventListener('offline', offline);
      window.removeEventListener('pagehide', hide);
      window.removeEventListener('storage', storage);
      document.removeEventListener('visibilitychange', hide);
    };
  }, [attemptId]);

  async function takeOver() {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError('');
    try {
      // Wait for the previous tab's pending network mutation before restoring state.
      const restore = async () => {
        claimWindow(true);
        try {
          const cached = localStorage.getItem(key);
          pending.current = cached ? (JSON.parse(cached) as Pending) : null;
        } catch {
          pending.current = null;
        }
      };
      if (navigator.locks) await navigator.locks.request(`sat-attempt-write:${attemptId}`, restore);
      else await restore();
      await load();
      await flush();
      activeSince.current = Date.now();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Reconnect before continuing in this window.');
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  const module = attempt?.module;
  const questions = module?.questions || [];
  const question = questions[attempt?.currentQuestion || 0];
  const images = question
    ? [
        ...((question as typeof question & { assets?: { url: string; alt: string }[] }).assets || []).map(
          (asset) => ({ src: asset.url, alt: asset.alt }),
        ),
        ...(question.images || []).map((src, index) => ({ src, alt: `Question illustration ${index + 1}` })),
      ].filter((item, index, list) => list.findIndex((other) => other.src === item.src) === index)
    : [];
  const response = question ? attempt?.responses[question.id] || emptyResponse() : emptyResponse();
  const notes = response.highlights.filter(
    (highlight) => highlight.noteAttached ?? Boolean(highlight.note?.trim()),
  );
  const notesPanelVisible = highlightsMode && notesPanelOpen && notes.length > 0;
  const readingSplit = module?.section === 'rw' && Boolean(question?.passage);
  const seconds =
    attempt?.status === 'paused'
      ? attempt.remainingSeconds || 0
      : module?.deadline
        ? Math.max(0, Math.ceil((new Date(module.deadline).getTime() - clock) / 1000))
        : (attempt?.remainingSeconds ?? module?.durationSeconds ?? 0);
  const timed = Boolean(module && module.durationSeconds > 0);
  const expired = timed && seconds <= 0 && attempt?.status === 'active';
  const warning = timed && seconds <= 300;
  const sectionName = module?.section === 'math' ? 'Math' : 'Reading and Writing';
  const tutorResult = question ? tutorResults[question.id] : undefined;

  useEffect(() => {
    if (warning) setTimerHidden(false);
  }, [warning]);
  useEffect(() => {
    if (!expired) return;
    void handlers.current.finish();
    const timer = setInterval(() => {
      void handlers.current.finish();
    }, 5000);
    return () => clearInterval(timer);
  }, [expired, module?.id]);
  useEffect(() => {
    if (
      attempt?.status !== 'break' ||
      !attempt.breakUntil ||
      new Date(attempt.breakUntil).getTime() > clock ||
      busy
    )
      return;
    void transition('continue');
  }, [attempt?.status, clock, busy]);
  useEffect(() => {
    if (!more) return;
    function outside(event: MouseEvent) {
      if (!moreRef.current?.contains(event.target as Node)) setMore(false);
    }
    document.addEventListener('mousedown', outside);
    return () => document.removeEventListener('mousedown', outside);
  }, [more]);

  useEffect(() => {
    if (!annotationPosition) return;
    function outside(event: PointerEvent) {
      if (!(event.target instanceof Element)) return;
      if (event.target.closest('.annotation-toolbar, .text-highlight, [aria-label="Highlights & Notes"]'))
        return;
      closeAnnotation();
    }
    function scrolled(event: Event) {
      if (event.target instanceof Element && event.target.closest('.annotation-toolbar')) return;
      closeAnnotation();
    }
    document.addEventListener('pointerdown', outside);
    document.addEventListener('scroll', scrolled, true);
    return () => {
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('scroll', scrolled, true);
    };
  }, [Boolean(annotationPosition)]);

  useEffect(() => {
    closeAnnotation();
  }, [question?.id, review, attempt?.status, dialog]);

  useEffect(() => {
    setSelectedNoteId(null);
  }, [question?.id]);

  useEffect(() => {
    try {
      localStorage.setItem(`sat-notes-panel:${attemptId}`, notesPanelOpen ? 'open' : 'closed');
    } catch {
      /* Attempt data still saves through the normal persistence queue. */
    }
  }, [attemptId, notesPanelOpen]);

  useEffect(() => {
    try {
      localStorage.setItem(`sat-notes-width:${attemptId}`, String(notesWidth));
    } catch {
      /* Layout preferences are optional; answers use the persistence queue. */
    }
  }, [attemptId, notesWidth]);

  function navigate(index: number) {
    if (!attemptRef.current || !ownsWindow() || index < 0 || index >= questions.length || expired) return;
    recordElapsed();
    apply({ ...attemptRef.current, currentQuestion: index });
    enqueue();
    setReview(false);
    setNavigatorOpen(false);
    setDialog(null);
    closeAnnotation();
    activeSince.current = Date.now();
    requestAnimationFrame(() => currentNumber.current?.focus());
  }
  function next() {
    if (!attempt) return;
    if (review) setDialog('submit');
    else if (attempt.currentQuestion === questions.length - 1) {
      recordElapsed();
      setReview(true);
      setNavigatorOpen(false);
    } else navigate(attempt.currentQuestion + 1);
  }
  function back() {
    if (!attempt) return;
    if (review) {
      setReview(false);
      navigate(questions.length - 1);
    } else navigate(attempt.currentQuestion - 1);
  }
  function capture() {
    if (!highlightsMode) return;
    const value = captureTextSelection();
    if (!value || !ownsWindow() || expired || busyRef.current) return;
    const selection = window.getSelection();
    const rect = selection?.rangeCount ? selection.getRangeAt(0).getBoundingClientRect() : null;
    showAnnotation(value, rect);
  }
  function openNotes() {
    closeAnnotation();
    setSelectedNoteId(null);
    const enabled = !highlightsMode;
    setHighlightsMode(enabled);
    setNotesPanelOpen(enabled && notes.length > 0);
  }
  function closeAnnotation() {
    setAnnotationPosition(null);
    setAnchor(null);
    setEditingHighlight(null);
    annotationDraft.current = null;
    window.getSelection()?.removeAllRanges();
  }
  function showAnnotation(selected: SelectionAnchor, rect: DOMRect | null, existing?: Highlight) {
    if (!highlightsMode || readOnly.current || expired || busyRef.current) return;
    const matching =
      existing ||
      response.highlights.find(
        (h) => h.field === selected.field && h.start === selected.start && h.end === selected.end,
      );
    const chosen = matching || null;
    const underline =
      chosen?.underlineStyle ?? (chosen?.underline || chosen?.style === 'underline' ? 'dotted' : 'none');
    setAnchor(selected);
    setEditingHighlight(chosen?.id || null);
    setHighlightColor(chosen?.color || 'yellow');
    setUnderlineStyle(underline);
    annotationDraft.current = chosen;
    setAnnotationPosition({
      x: Math.max(12, (rect?.left ?? 40) - 12),
      y: rect ? (rect.top >= 180 ? rect.top - 80 : rect.bottom + 10) : 114,
    });
  }
  function editHighlight(id: string) {
    if (!highlightsMode) return;
    const highlight = response.highlights.find((item) => item.id === id);
    if (!highlight) return;
    const element = Array.from(document.querySelectorAll<HTMLElement>('[data-highlight-id]')).find(
      (el) => el.dataset.highlightId === id,
    );
    const rect = element?.getBoundingClientRect() || null;
    requestAnimationFrame(() => showAnnotation(highlight, rect, highlight));
  }
  function saveAnnotation(
    patch: Partial<Pick<Highlight, 'color' | 'note' | 'noteAttached' | 'underlineStyle'>> = {},
  ) {
    if (!highlightsMode || !anchor || !question || !ownsWindow() || expired) return null;
    const activeResponse = attemptRef.current?.responses[question.id] || emptyResponse();
    const existing = annotationDraft.current;
    if (anchor.text.length > 10000) {
      setError('Select a shorter passage. One highlight can contain up to 10,000 characters.');
      return null;
    }
    if (!existing && activeResponse.highlights.length >= 100) {
      setError('This question already has 100 highlights. Remove a highlight before adding another.');
      return null;
    }
    if (
      !existing &&
      activeResponse.highlights.some(
        (item) => item.field === anchor.field && item.start < anchor.end && item.end > anchor.start,
      )
    ) {
      setError('That selection overlaps an existing highlight. Edit or remove the existing highlight first.');
      return null;
    }
    const lineStyle = patch.underlineStyle ?? existing?.underlineStyle ?? underlineStyle;
    const highlight: Highlight = {
      ...anchor,
      id: existing?.id || crypto.randomUUID(),
      color: patch.color ?? existing?.color ?? highlightColor,
      note: patch.note ?? existing?.note ?? '',
      noteAttached: patch.noteAttached ?? existing?.noteAttached,
      underline: lineStyle !== 'none',
      underlineStyle: lineStyle,
    };
    annotationDraft.current = highlight;
    setEditingHighlight(highlight.id);
    setHighlightColor(highlight.color || 'yellow');
    setUnderlineStyle(lineStyle);
    updateResponse({
      highlights: existing
        ? activeResponse.highlights.map((item) => (item.id === existing.id ? highlight : item))
        : [...activeResponse.highlights, highlight],
    });
    window.getSelection()?.removeAllRanges();
    return highlight;
  }
  function deleteAnnotation() {
    if (!highlightsMode) return;
    const id = annotationDraft.current?.id || editingHighlight;
    if (id && question) {
      const current = attemptRef.current?.responses[question.id] || emptyResponse();
      updateResponse({ highlights: current.highlights.filter((h) => h.id !== id) });
    }
    closeAnnotation();
    window.getSelection()?.removeAllRanges();
  }
  function openAnnotationNote() {
    const highlight = saveAnnotation({ noteAttached: true });
    if (!highlight) return;
    closeAnnotation();
    setNotesPanelOpen(true);
    setSelectedNoteId(highlight.id);
  }
  function changeNote(id: string, note: string) {
    if (!highlightsMode || !question || !ownsWindow() || expired) return;
    const current = attemptRef.current?.responses[question.id] || emptyResponse();
    updateResponse({
      highlights: current.highlights.map((h) => (h.id === id ? { ...h, note, noteAttached: true } : h)),
    });
  }
  function deleteNote(id: string) {
    if (!highlightsMode || !question || !ownsWindow() || expired) return;
    const current = attemptRef.current?.responses[question.id] || emptyResponse();
    updateResponse({
      highlights: current.highlights.map((h) => (h.id === id ? { ...h, note: '', noteAttached: false } : h)),
    });
    setSelectedNoteId(null);
  }
  function closeNotesPanel() {
    setNotesPanelOpen(false);
    setSelectedNoteId(null);
    document.querySelector<HTMLButtonElement>('.highlights-notes-trigger')?.focus();
  }
  async function submitTutor() {
    if (!question || !response.answer || busyRef.current || !ownsWindow()) return;
    busyRef.current = true;
    setBusy(true);
    setError('');
    try {
      recordElapsed();
      await flush();
      const result = await inWindowLock(() =>
        api<ReviewItem>(
          `/attempts/${attemptId}/tutor`,
          json('POST', {
            questionId: question.id,
            response: attemptRef.current?.responses[question.id] || response,
          }),
        ),
      );
      setTutorResults((items) => ({ ...items, [question.id]: result }));
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Could not check your answer.');
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }
  function eliminate(id: string) {
    updateResponse({
      eliminated: response.eliminated.includes(id)
        ? response.eliminated.filter((choice) => choice !== id)
        : [...response.eliminated, id],
    });
  }

  useEffect(() => {
    function shortcuts(event: KeyboardEvent) {
      if (readOnly.current) return;
      if (
        event.target instanceof Element &&
        event.target.closest('input,textarea,select,[contenteditable="true"]')
      )
        return;
      if (document.querySelector('dialog[open]:not(.question-navigator)')) return;
      if (event.key === 'Escape') {
        closeAnnotation();
        setMore(false);
        setNavigatorOpen(false);
        setCalculator(false);
        return;
      }
      const code = event.code;
      if (event.ctrlKey && event.altKey) {
        const actions: Record<string, () => void> = {
          KeyB: back,
          KeyX: next,
          KeyG: () => setNavigatorOpen((open) => !open),
          KeyV: () => updateResponse({ marked: !response.marked }),
          KeyC: () => {
            if (module?.section === 'math') setCalculator((open) => !open);
          },
          KeyR: () => {
            if (module?.section === 'math') setDialog('reference');
          },
          KeyT: () => {
            if (!warning) setTimerHidden((hidden) => !hidden);
          },
          KeyO: () => setEliminator((enabled) => !enabled),
        };
        const action = actions[code];
        if (action) {
          event.preventDefault();
          action();
        } else if (/^Digit[1-4]$/.test(code) && question?.choices[Number(code.slice(-1)) - 1]) {
          event.preventDefault();
          eliminate(question.choices[Number(code.slice(-1)) - 1].id);
        }
      } else if (
        event.ctrlKey &&
        event.shiftKey &&
        /^Digit[1-4]$/.test(code) &&
        question?.choices[Number(code.slice(-1)) - 1] &&
        !tutorResult &&
        !expired
      ) {
        event.preventDefault();
        updateResponse({ answer: question.choices[Number(code.slice(-1)) - 1].id });
      } else if (event.altKey && event.shiftKey && code === 'KeyH') {
        event.preventDefault();
        openNotes();
      } else if (event.altKey && event.shiftKey && code === 'KeyL') {
        event.preventDefault();
        setLineReader((enabled) => !enabled);
      } else if (lineReader && event.altKey && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
        event.preventDefault();
        setLineY((y) => Math.max(22, y + (event.key === 'ArrowDown' ? 30 : -30)));
      }
    }
    document.addEventListener('keydown', shortcuts);
    return () => document.removeEventListener('keydown', shortcuts);
  });

  function navigationGrid() {
    return (
      <div className="question-grid">
        {questions.map((item, index) => {
          const answer = attempt?.responses[item.id];
          const current = !review && index === attempt?.currentQuestion;
          return (
            <button
              key={item.id}
              onClick={() => navigate(index)}
              aria-label={`Question ${index + 1}${answer?.answer ? ', answered' : ', unanswered'}${answer?.marked ? ', marked for review' : ''}${current ? ', current' : ''}`}
              aria-current={current ? 'step' : undefined}
              className={`question-tile ${answer?.answer ? 'answered' : 'unanswered'} ${current ? 'current' : ''}`}
            >
              {current && (
                <span className="current-arrow" aria-hidden="true">
                  ▼
                </span>
              )}
              {index + 1}
              {answer?.marked && (
                <Bookmark className="tile-bookmark" size={15} fill="currentColor" aria-hidden="true" />
              )}
            </button>
          );
        })}
      </div>
    );
  }
  function legend() {
    return (
      <div className="navigator-legend">
        <span>
          <span className="legend-current">▼</span> Current
        </span>
        <span>
          <span className="legend-unanswered" /> Unanswered
        </span>
        <span>
          <Bookmark size={14} fill="currentColor" /> For Review
        </span>
      </div>
    );
  }

  if (!attempt)
    return (
      <main className="test-loading">
        <h1>Opening your test</h1>
        {error ? (
          <>
            <p role="alert">{error}</p>
            <button className="test-primary" onClick={() => void load()}>
              Try again
            </button>
            <button onClick={onExit}>Return to dashboard</button>
          </>
        ) : (
          <p>Restoring saved answers and tools…</p>
        )}
      </main>
    );
  if (attempt.status === 'completed')
    return (
      <main className="test-loading">
        <h1>Preparing your results…</h1>
      </main>
    );
  if (otherWindow)
    return (
      <main className="test-paused" role="alertdialog" aria-label="Test open in another window">
        <h1>This test is open in another window</h1>
        <p>Continue in one window so saved answers and notes stay consistent.</p>
        <p>The clock keeps running for timed modules.</p>
        <button autoFocus className="test-primary" disabled={busy} onClick={() => void takeOver()}>
          Continue in this window
        </button>
        <button onClick={onExit}>Return to dashboard</button>
        {error && <p role="alert">{error}</p>}
      </main>
    );
  if (attempt.status === 'break') {
    const remaining = attempt.breakUntil
      ? Math.max(0, Math.ceil((new Date(attempt.breakUntil).getTime() - clock) / 1000))
      : 600;
    return (
      <main className="test-break">
        <div>
          <div className="break-countdown">
            <span>Remaining Break Time</span>
            <strong>{formatTime(remaining)}</strong>
          </div>
          <button className="break-resume" disabled={busy} onClick={() => void transition('continue')}>
            Resume Testing
          </button>
        </div>
        <div>
          <h1>Practice Test Break</h1>
          <p>You have completed Reading and Writing. Math is next.</p>
          <hr />
          <h2>Take a Break</h2>
          <p>Rest your eyes, stretch, and return when you're ready.</p>
          <p className="break-detail">This study simulation lets you end the break early.</p>
          {error && (
            <p className="break-error" role="alert">
              {error}
            </p>
          )}
        </div>
      </main>
    );
  }
  if (attempt.status === 'paused')
    return (
      <main className="test-paused">
        <Pause size={42} />
        <h1>Your practice is paused</h1>
        <p>Your answers and remaining time are saved.</p>
        <p>{timed ? `${formatTime(seconds)} remaining` : 'Untimed practice'}</p>
        <button className="test-primary" disabled={busy} onClick={() => void transition('resume')}>
          Resume practice
        </button>
        <button onClick={onExit}>Return to dashboard</button>
        {error && <p role="alert">{error}</p>}
      </main>
    );
  if (!module || !question)
    return (
      <main className="test-loading">
        <h1>No active question was found</h1>
        <button onClick={() => void load()}>Reload saved attempt</button>
        <button onClick={onExit}>Return to dashboard</button>
      </main>
    );

  return (
    <main className="test-player" style={{ '--question-zoom': zoom / 100 } as React.CSSProperties}>
      <header className="test-header">
        <h1>
          Section {module.section === 'rw' ? 'I' : 'II'}, Module {module.index}: {sectionName}
        </h1>
        <div
          className={`test-timer ${warning ? 'timer-warning' : ''}`}
          role="timer"
          aria-label={timed ? `${seconds} seconds remaining` : 'Untimed practice'}
        >
          {timed ? (
            <>
              <div className="timer-digits">
                {timerHidden && !warning ? (
                  <Clock size={24} aria-label="Timer hidden" />
                ) : (
                  formatTime(seconds)
                )}
              </div>
              <button
                onClick={() => setTimerHidden(!timerHidden)}
                disabled={warning}
                aria-label={timerHidden ? 'Show timer' : 'Hide timer'}
              >
                {warning ? 'Time left' : timerHidden ? 'Show' : 'Hide'}
              </button>
            </>
          ) : (
            <span className="untimed-label">Untimed</span>
          )}
        </div>
        <div className="test-tools">
          <button
            className="highlights-notes-trigger"
            aria-label="Highlights & Notes"
            aria-pressed={highlightsMode}
            aria-expanded={notesPanelVisible}
            aria-controls={notesPanelVisible ? 'highlights-notes-panel' : undefined}
            title={highlightsMode ? 'Turn Highlights & Notes off' : 'Turn Highlights & Notes on'}
            onClick={openNotes}
          >
            <HighlightsNotesIcon />
            <span>Highlights &amp; Notes</span>
          </button>
          {module.section === 'math' && (
            <>
              <button
                aria-label="Calculator"
                aria-pressed={calculator}
                onClick={() => setCalculator(!calculator)}
              >
                <CalculatorIcon size={23} />
                <span>Calculator</span>
              </button>
              <button aria-label="Math reference" onClick={() => setDialog('reference')}>
                <SquareFunction size={23} />
                <span>Reference</span>
              </button>
            </>
          )}
          <div className="test-more" ref={moreRef}>
            <button aria-label="More tools" aria-expanded={more} onClick={() => setMore(!more)}>
              <MoreHorizontal size={23} />
              <span>More</span>
            </button>
            {more && (
              <div className="more-menu" role="menu">
                <button
                  role="menuitemcheckbox"
                  aria-checked={lineReader}
                  onClick={() => {
                    setLineReader(!lineReader);
                    setMore(false);
                  }}
                >
                  Line reader {lineReader && <Check size={16} />}
                </button>
                <button
                  role="menuitem"
                  onClick={() => {
                    setDialog('shortcuts');
                    setMore(false);
                  }}
                >
                  Keyboard shortcuts
                </button>
                <div className="test-zoom">
                  <label htmlFor="test-zoom">Text zoom</label>
                  <select
                    id="test-zoom"
                    value={zoom}
                    onChange={(event) => setZoom(Number(event.target.value))}
                  >
                    {[80, 90, 100, 110, 125, 150].map((value) => (
                      <option key={value} value={value}>
                        {value}%
                      </option>
                    ))}
                  </select>
                </div>
                <button
                  role="menuitem"
                  onClick={() => {
                    setDialog('help');
                    setMore(false);
                  }}
                >
                  Help and directions
                </button>
                {attempt.mode !== 'full' && (
                  <button
                    role="menuitem"
                    onClick={() => {
                      setMore(false);
                      void transition('pause');
                    }}
                  >
                    Pause practice
                  </button>
                )}
                <button
                  role="menuitem"
                  onClick={() => {
                    setDialog('exit');
                    setMore(false);
                  }}
                >
                  Save and exit
                </button>
              </div>
            )}
          </div>
        </div>
      </header>
      {error && (
        <div className="test-error" role="alert">
          <span>{error}</span>
          <button aria-label="Dismiss message" onClick={() => setError('')}>
            <X size={16} />
          </button>
        </div>
      )}
      {warning && (
        <span className="sr-only" role="status">
          {seconds === 300
            ? 'Five minutes remaining. The timer is now visible.'
            : expired
              ? 'Time has expired. Submitting this module.'
              : ''}
        </span>
      )}
      {expired && (
        <div className="test-expired" role="status">
          Time is up. {busy ? 'Saving and submitting this module…' : 'Reconnecting to close this module…'}
        </div>
      )}
      {review ? (
        <section className="module-review">
          <h2>Check Your Work</h2>
          <p>
            Review your answers before submitting this module.
            <br />
            After submission, you cannot return to these questions.
          </p>
          <div className="module-review-box">
            <div className="module-review-heading">
              <h3>{sectionName} Questions</h3>
              {legend()}
            </div>
            {navigationGrid()}
          </div>
          <p className="module-review-count">
            {questions.filter((item) => !attempt.responses[item.id]?.answer).length} unanswered ·{' '}
            {questions.filter((item) => attempt.responses[item.id]?.marked).length} marked for review
          </p>
          <button className="test-primary" disabled={busy || expired} onClick={() => setDialog('submit')}>
            Submit module
          </button>
        </section>
      ) : (
        <section
          ref={workspaceRef}
          className={`test-workspace ${readingSplit ? 'reading-split' : 'math-workspace'}${notesPanelVisible ? ' with-notes' : ''}`}
          style={
            {
              '--notes-panel-width': `${notesWidth}px`,
            } as React.CSSProperties
          }
          onMouseMove={(event) => {
            if (lineReader) setLineY(event.clientY - event.currentTarget.getBoundingClientRect().top);
          }}
        >
          {module.section === 'rw' && question.passage && (
            <div className="passage-panel" id="test-passage-panel">
              <div className="passage-content">
                <RichText
                  html={question.passage}
                  field="passage"
                  highlights={response.highlights}
                  annotationsEnabled={highlightsMode}
                  onHighlight={editHighlight}
                  onSelection={capture}
                />
              </div>
            </div>
          )}
          {notesPanelVisible && (
            <NotesPanel
              notes={notes}
              selectedId={selectedNoteId}
              resizeHandle={
                <NotesResizeHandle
                  containerRef={workspaceRef}
                  width={notesWidth}
                  defaultWidth={defaultNotesWidth}
                  readingSplit={readingSplit}
                  onChange={(width) => {
                    closeAnnotation();
                    setNotesWidth(width);
                  }}
                  disabled={busy || expired || otherWindow}
                />
              }
              disabled={busy || expired || otherWindow}
              onNoteChange={changeNote}
              onDeleteNote={deleteNote}
              onSelect={setSelectedNoteId}
              onClose={closeNotesPanel}
              questionNote={response.note}
              onQuestionNoteChange={(note) => updateResponse({ note })}
            />
          )}
          <div className="question-panel" id="test-question-panel">
            <div className="question-content">
              <div className="question-toolbar">
                <div
                  className="question-number"
                  ref={currentNumber}
                  tabIndex={-1}
                  aria-label={`Question ${attempt.currentQuestion + 1}`}
                >
                  {attempt.currentQuestion + 1}
                </div>
                <button
                  className={`mark-review ${response.marked ? 'marked' : ''}`}
                  disabled={expired}
                  aria-pressed={response.marked}
                  onClick={() => updateResponse({ marked: !response.marked })}
                >
                  <Bookmark size={19} fill={response.marked ? 'currentColor' : 'none'} />
                  Mark for Review
                </button>
                {question.type === 'mcq' && (
                  <button
                    className="eliminator-toggle"
                    title="Option eliminator"
                    aria-label="Option eliminator"
                    aria-pressed={eliminator}
                    onClick={() => setEliminator(!eliminator)}
                  >
                    <svg className="eliminator-icon" viewBox="0 0 44 40" aria-hidden="true">
                      <text
                        x="5"
                        y="27"
                        fontFamily="Arial, sans-serif"
                        fontSize="19"
                        fontWeight="700"
                        fill="currentColor"
                        letterSpacing="-1.8"
                      >
                        ABC
                      </text>
                      <path d="M5 34L37 6" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
                    </svg>
                  </button>
                )}
              </div>
              {module.section === 'math' && question.passage && (
                <RichText
                  html={question.passage}
                  field="passage"
                  highlights={response.highlights}
                  annotationsEnabled={highlightsMode}
                  onHighlight={editHighlight}
                  onSelection={capture}
                />
              )}
              <RichText
                className="question-stem"
                html={question.stem}
                field="stem"
                highlights={response.highlights}
                annotationsEnabled={highlightsMode}
                onHighlight={editHighlight}
                onSelection={capture}
              />
              {images.map(({ src, alt }) => (
                <RichText
                  key={src}
                  className="question-image"
                  html={`<img src="${src.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')}" alt="${alt.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')}"/>`}
                />
              ))}
              {question.type === 'mcq' ? (
                <fieldset className="answer-options" disabled={expired || Boolean(tutorResult)}>
                  <legend className="sr-only">Choose your answer</legend>
                  {question.choices.map((choice, index) => {
                    const eliminated = response.eliminated.includes(choice.id);
                    return (
                      <div className="answer-row" key={choice.id}>
                        <label
                          className={`answer-choice ${response.answer === choice.id ? 'selected' : ''} ${eliminated ? 'eliminated' : ''}`}
                        >
                          <input
                            type="radio"
                            name={`answer-${question.id}`}
                            value={choice.id}
                            checked={response.answer === choice.id}
                            onChange={() => updateResponse({ answer: choice.id })}
                            aria-label={`Answer ${String.fromCharCode(65 + index)}`}
                          />
                          <span className="choice-letter" aria-hidden="true">
                            {String.fromCharCode(65 + index)}
                          </span>
                          <RichText html={choice.text} className="choice-text" />
                        </label>
                        {eliminator && (
                          <button
                            className={`eliminate-choice ${eliminated ? 'undo-elimination' : ''}`}
                            aria-label={
                              eliminated
                                ? `Restore choice ${String.fromCharCode(65 + index)}`
                                : `Eliminate choice ${String.fromCharCode(65 + index)}`
                            }
                            aria-pressed={eliminated}
                            onClick={() => eliminate(choice.id)}
                          >
                            {eliminated ? 'Undo' : <span>{String.fromCharCode(65 + index)}</span>}
                          </button>
                        )}
                      </div>
                    );
                  })}
                </fieldset>
              ) : (
                <div className="numeric-response">
                  <label htmlFor="numeric-answer">Your answer</label>
                  <input
                    id="numeric-answer"
                    aria-label="Numeric answer"
                    type="text"
                    inputMode="decimal"
                    maxLength={24}
                    autoComplete="off"
                    value={response.answer}
                    disabled={expired || Boolean(tutorResult)}
                    onChange={(event) => updateResponse({ answer: event.target.value })}
                  />
                  <p>Enter a number, decimal, or fraction. For example: 12, 0.75, or 3/4.</p>
                  <button onClick={() => setDialog('help')}>Student-produced response directions</button>
                </div>
              )}
              {attempt.mode === 'tutor' && (
                <div className="tutor-actions">
                  {!tutorResult ? (
                    <button
                      className="test-primary"
                      disabled={!response.answer || busy}
                      onClick={() => void submitTutor()}
                    >
                      Check answer
                    </button>
                  ) : (
                    <div className={`tutor-feedback ${tutorResult.correct ? 'correct' : 'incorrect'}`}>
                      <h3>{tutorResult.correct ? 'Correct' : 'Keep learning'}</h3>
                      <p>
                        Correct answer:{' '}
                        {tutorResult.question.correctAnswer ||
                          tutorResult.question.acceptedAnswers?.join(' or ')}
                      </p>
                      <RichText html={tutorResult.question.explanation} />
                      {tutorResult.question.choices.map(
                        (choice) =>
                          choice.rationale && (
                            <div key={choice.id}>
                              <strong>{choice.id}</strong>
                              <RichText html={choice.rationale} />
                            </div>
                          ),
                      )}
                      <button className="test-primary" onClick={next}>
                        Continue
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
          {lineReader && (
            <div
              className="line-reader-shade"
              aria-hidden="true"
              style={{
                background: `linear-gradient(to bottom, rgba(0,0,0,.20) 0, rgba(0,0,0,.20) ${Math.max(0, lineY - 19)}px, transparent ${Math.max(0, lineY - 19)}px, transparent ${lineY + 19}px, rgba(0,0,0,.20) ${lineY + 19}px)`,
              }}
            />
          )}
        </section>
      )}
      <footer className="test-footer">
        <div className="test-student">
          <span>{attempt.user?.name || user?.name || 'Student'}</span>
          <small role="status">{saveStatus}</small>
        </div>
        {!review ? (
          <button
            className="navigator-trigger"
            aria-label="Question menu"
            aria-expanded={navigatorOpen}
            onClick={() => setNavigatorOpen(!navigatorOpen)}
          >
            Question {attempt.currentQuestion + 1} of {questions.length}
            {navigatorOpen ? <ChevronDown size={16} /> : <ChevronUp size={16} />}
          </button>
        ) : (
          <span />
        )}
        <div className="test-footer-actions">
          {(review || attempt.currentQuestion > 0) && (
            <button className="test-primary" disabled={expired} onClick={back}>
              Back
            </button>
          )}
          <button className="test-primary" disabled={busy || expired} onClick={next}>
            Next
          </button>
        </div>
      </footer>
      {navigatorOpen && (
        <QuestionNavigator onClose={() => setNavigatorOpen(false)}>
          <div className="navigator-title">
            <h2>{sectionName} Questions</h2>
            <button aria-label="Close question menu" onClick={() => setNavigatorOpen(false)}>
              <X size={19} />
            </button>
          </div>
          {legend()}
          {navigationGrid()}
          <button
            className="test-outline"
            onClick={() => {
              recordElapsed();
              setNavigatorOpen(false);
              setReview(true);
            }}
          >
            Go to Review Page
          </button>
        </QuestionNavigator>
      )}
      {calculator && (
        <Suspense
          fallback={
            <div className="calculator-loading" role="status">
              Opening calculator…
            </div>
          }
        >
          <Calculator onClose={() => setCalculator(false)} />
        </Suspense>
      )}
      {dialog === 'reference' && (
        <TestDialog title="Math Reference" className="reference-dialog" onClose={() => setDialog(null)}>
          <MathReference />
        </TestDialog>
      )}
      {dialog === 'shortcuts' && (
        <TestDialog title="Keyboard Shortcuts" onClose={() => setDialog(null)}>
          <ShortcutList />
        </TestDialog>
      )}
      {dialog === 'help' && (
        <TestDialog title="Help and Directions" onClose={() => setDialog(null)}>
          <p>
            Choose one answer for each multiple-choice question. For student-produced responses, enter a
            number, decimal, or fraction; equivalent values are accepted when configured by the question
            author.
          </p>
          <p>
            Use Back and Next or the Question Menu to move within this module. Mark questions you want to
            revisit. Eliminating a choice never changes your selected answer.
          </p>
          <p>
            Turn Highlights &amp; Notes on, then select passage or question text to open the formatting
            palette. Choose a color or underline style, then use Add note to write in the notes side panel.
            The underline beneath Highlights &amp; Notes shows that the mode is active. Click it again to turn
            the mode off. Drag the notes panel handle to adjust its width. Changes save automatically. Click a
            saved highlight to edit it.
          </p>
          <p>
            Timed modules close when time expires. Submitted modules are locked. Full simulations use adaptive
            second modules and a break between sections.
          </p>
          <p>
            Line reader follows the pointer; Alt + Up/Down moves its focus band. The calculator panel can be
            moved, resized, and controlled by keyboard.
          </p>
          <p>
            This independent study platform is not affiliated with College Board. Scores and adaptive routing
            use documented internal estimates.
          </p>
        </TestDialog>
      )}
      {dialog === 'submit' && (
        <TestDialog title="Submit this module?" onClose={() => setDialog(null)}>
          <p>
            You have {questions.filter((item) => !attempt.responses[item.id]?.answer).length} unanswered
            questions. Your saved answers will be locked when you submit.
          </p>
          <p>
            {attempt.mode === 'full'
              ? 'The next module or section will open using the test’s configured adaptive rules.'
              : 'Continue to the next module or your results.'}
          </p>
          <div className="dialog-actions">
            <button className="test-outline" onClick={() => setDialog(null)}>
              Keep reviewing
            </button>
            <button className="test-primary" disabled={busy} onClick={() => void finish()}>
              {busy ? 'Submitting…' : 'Confirm submit'}
            </button>
          </div>
        </TestDialog>
      )}
      {dialog === 'exit' && (
        <TestDialog title="Save and exit" onClose={() => setDialog(null)}>
          <p>
            {attempt.mode === 'full'
              ? 'The clock keeps running while you are away. You can resume this attempt from your dashboard.'
              : 'Your answers are saved. Pause practice to save your remaining time before returning to the dashboard.'}
          </p>
          <div className="dialog-actions">
            <button className="test-outline" onClick={() => setDialog(null)}>
              Keep testing
            </button>
            <button
              className="test-primary"
              onClick={() => {
                recordElapsed();
                void flush()
                  .then(onExit)
                  .catch((failure: unknown) =>
                    setError(failure instanceof Error ? failure.message : 'Reconnect before exiting.'),
                  );
              }}
            >
              Save and exit test
            </button>
          </div>
        </TestDialog>
      )}
      {highlightsMode && annotationPosition && anchor && !dialog && !review && !otherWindow && (
        <AnnotationToolbar
          position={annotationPosition}
          color={highlightColor}
          underlineStyle={underlineStyle}
          canDelete={Boolean(editingHighlight)}
          hasNote={Boolean(annotationDraft.current?.noteAttached ?? annotationDraft.current?.note?.trim())}
          onColorChange={(color) => {
            saveAnnotation({ color });
          }}
          onUnderlineChange={(style) => {
            saveAnnotation({ underlineStyle: style });
          }}
          onDelete={deleteAnnotation}
          onAddNote={openAnnotationNote}
          onClose={closeAnnotation}
          busy={busy || expired}
        />
      )}
    </main>
  );
}

function QuestionNavigator({ onClose, children }: { onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const dialog = ref.current;
    dialog?.show();
    dialog?.querySelector<HTMLButtonElement>('button')?.focus();
    function outside(event: MouseEvent) {
      if (!dialog?.contains(event.target as Node) && !(event.target as Element).closest('.navigator-trigger'))
        onClose();
    }
    document.addEventListener('mousedown', outside);
    return () => {
      dialog?.close();
      document.removeEventListener('mousedown', outside);
      previous?.focus();
    };
  }, []);
  return (
    <dialog
      ref={ref}
      className="question-navigator"
      aria-label="Question navigation"
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.preventDefault();
          event.stopPropagation();
          onClose();
        }
      }}
    >
      {children}
    </dialog>
  );
}

function ShortcutList() {
  return (
    <>
      <p>
        Use Tab and Shift + Tab to reach every control. Enter or Space activates buttons. Arrow keys select
        radio answers.
      </p>
      <dl className="shortcut-list">
        {[
          ['Back', 'Ctrl + Alt + B'],
          ['Next', 'Ctrl + Alt + X'],
          ['Question menu', 'Ctrl + Alt + G'],
          ['Mark for review', 'Ctrl + Alt + V'],
          ['Calculator (Math)', 'Ctrl + Alt + C'],
          ['Reference (Math)', 'Ctrl + Alt + R'],
          ['Hide/show timer', 'Ctrl + Alt + T'],
          ['Option eliminator', 'Ctrl + Alt + O'],
          ['Select answer A–D', 'Ctrl + Shift + 1–4'],
          ['Eliminate/restore A–D', 'Ctrl + Alt + 1–4'],
          ['Highlights & Notes', 'Alt + Shift + H'],
          ['Line reader', 'Alt + Shift + L'],
          ['Move line reader', 'Alt + Up/Down'],
          ['Close tool/menu', 'Escape'],
        ].map(([label, shortcut]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>
              <kbd>{shortcut}</kbd>
            </dd>
          </div>
        ))}
      </dl>
      <p className="shortcut-note">
        Typing fields keep their normal shortcuts. Browser and operating-system shortcuts may vary. This
        platform uses alternate keys for Highlights and Line Reader to preserve browser controls.
      </p>
    </>
  );
}

function MathReference() {
  return (
    <>
      <p className="reference-caption">Original study reference for common SAT mathematics formulas.</p>
      <div className="math-reference-grid">
        <div>
          <h3>Circle</h3>
          <svg viewBox="0 0 160 100" aria-label="Circle with radius r" role="img">
            <circle cx="80" cy="50" r="38" />
            <path d="M80 50H118" />
            <text x="94" y="44">
              r
            </text>
          </svg>
          <RichText html={'$A=\\pi r^2$<br/>$C=2\\pi r$'} />
        </div>
        <div>
          <h3>Rectangle</h3>
          <svg viewBox="0 0 160 100" aria-label="Rectangle length l and width w" role="img">
            <rect x="22" y="23" width="116" height="55" />
            <text x="77" y="94">
              l
            </text>
            <text x="7" y="55">
              w
            </text>
          </svg>
          <RichText html={'$A=lw$'} />
        </div>
        <div>
          <h3>Triangle</h3>
          <svg viewBox="0 0 160 100" aria-label="Triangle base b and height h" role="img">
            <path d="M20 80L65 15L140 80Z M65 15V80" />
            <text x="83" y="96">
              b
            </text>
            <text x="69" y="51">
              h
            </text>
          </svg>
          <RichText html={'$A=\\frac12 bh$'} />
        </div>
        <div>
          <h3>Right triangle</h3>
          <svg viewBox="0 0 160 100" aria-label="Right triangle sides a b and hypotenuse c" role="img">
            <path d="M35 15V80H130Z M35 67H48V80" />
            <text x="19" y="50">
              a
            </text>
            <text x="78" y="96">
              b
            </text>
            <text x="83" y="42">
              c
            </text>
          </svg>
          <RichText html={'$a^2+b^2=c^2$'} />
        </div>
        <div>
          <h3>Special right triangles</h3>
          <RichText html={'<p>45°–45°–90°: $x, x, x\\sqrt2$</p><p>30°–60°–90°: $x, x\\sqrt3, 2x$</p>'} />
        </div>
        <div>
          <h3>Rectangular prism</h3>
          <RichText html={'$V=lwh$'} />
        </div>
        <div>
          <h3>Cylinder</h3>
          <RichText html={'$V=\\pi r^2h$'} />
        </div>
        <div>
          <h3>Sphere</h3>
          <RichText html={'$V=\\frac43\\pi r^3$'} />
        </div>
        <div>
          <h3>Cone</h3>
          <RichText html={'$V=\\frac13\\pi r^2h$'} />
        </div>
        <div>
          <h3>Pyramid</h3>
          <RichText html={'$V=\\frac13lwh$'} />
        </div>
      </div>
      <div className="reference-facts">
        <p>A circle contains 360 degrees or 2π radians.</p>
        <p>The sum of a triangle’s angles is 180 degrees.</p>
      </div>
    </>
  );
}
