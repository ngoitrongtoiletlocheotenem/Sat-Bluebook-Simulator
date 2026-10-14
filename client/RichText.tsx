import { useEffect, useMemo, useRef, useState } from 'react';
import DOMPurify from 'dompurify';
import katex from 'katex';
import 'katex/dist/katex.min.css';
import { Minus, Plus, RotateCcw, X } from 'lucide-react';
import type { Highlight } from '../shared/types';

export type TextHighlight = Highlight;
const EMPTY_HIGHLIGHTS: TextHighlight[] = [];

const excluded = 'script,style,.katex,.katex-display,[data-no-annotation]';

function textNodes(root: Node): Text[] {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes: Text[] = [];
  for (let current = walker.nextNode(); current; current = walker.nextNode()) {
    if (!current.parentElement?.closest(excluded)) nodes.push(current as Text);
  }
  return nodes;
}

/** Offsets refer to sanitized prose, excluding generated math accessibility nodes. */
export function captureTextSelection(): Omit<TextHighlight, 'id' | 'color' | 'note'> | null {
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed || !selection.rangeCount) return null;
  const range = selection.getRangeAt(0);
  const startElement =
    range.startContainer instanceof Element ? range.startContainer : range.startContainer.parentElement;
  const boundary = startElement?.closest<HTMLElement>('[data-annotation-field]');
  if (!boundary || !boundary.contains(range.endContainer) || startElement?.closest(excluded)) return null;
  const field = boundary.dataset.annotationField as 'passage' | 'stem';
  const before = range.cloneRange();
  before.selectNodeContents(boundary);
  before.setEnd(range.startContainer, range.startOffset);
  const start = textNodes(before.cloneContents()).reduce((sum, node) => sum + node.length, 0);
  const text = textNodes(range.cloneContents())
    .map((node) => node.data)
    .join('');
  if (!text.trim()) return null;
  return { field, start, end: start + text.length, text };
}

function renderMath(root: HTMLElement) {
  for (const node of textNodes(root)) {
    const expression = /\$\$([\s\S]+?)\$\$|\\\[([\s\S]+?)\\\]|\\\(([\s\S]+?)\\\)|\$([^$\n]+?)\$/g;
    const matches = Array.from(node.data.matchAll(expression));
    if (!matches.length) continue;
    const fragment = document.createDocumentFragment();
    let offset = 0;
    for (const match of matches) {
      fragment.append(document.createTextNode(node.data.slice(offset, match.index)));
      const math = document.createElement('span');
      const source = match[1] ?? match[2] ?? match[3] ?? match[4];
      katex.render(source, math, {
        displayMode: Boolean(match[1] || match[2]),
        throwOnError: false,
        trust: false,
        strict: 'warn',
        maxExpand: 1000,
      });
      fragment.append(math);
      offset = (match.index ?? 0) + match[0].length;
    }
    fragment.append(document.createTextNode(node.data.slice(offset)));
    node.replaceWith(fragment);
  }
}

function renderHighlights(root: HTMLElement, highlights: TextHighlight[], annotationsEnabled = true) {
  // Rebuild from immutable question text every time. The question version never changes.
  const nodes = textNodes(root);
  let offset = 0;
  const prose = nodes.map((node) => node.data).join('');
  const valid = highlights.filter(
    (h) => h.start >= 0 && h.end > h.start && prose.slice(h.start, h.end) === h.text,
  );
  for (const node of nodes) {
    const from = offset;
    offset += node.length;
    const matches = valid.filter((h) => h.start < offset && h.end > from).sort((a, b) => a.start - b.start);
    if (!matches.length) continue;
    const fragment = document.createDocumentFragment();
    let cursor = 0;
    for (const highlight of matches) {
      const start = Math.max(cursor, highlight.start - from, 0);
      const end = Math.min(node.length, highlight.end - from);
      if (end <= start) continue;
      fragment.append(document.createTextNode(node.data.slice(cursor, start)));
      const mark = document.createElement('mark');
      mark.dataset.highlightId = highlight.id;
      const underline =
        highlight.underlineStyle ??
        (highlight.underline || highlight.style === 'underline' ? 'dotted' : 'none');
      mark.className = `text-highlight highlight-${['yellow', 'blue', 'pink'].includes(highlight.color || '') ? highlight.color : 'yellow'}${underline !== 'none' ? ` highlight-underlined underline-${underline}` : ''}${annotationsEnabled ? '' : ' annotation-disabled'}`;
      if (annotationsEnabled) {
        mark.tabIndex = 0;
        mark.setAttribute('role', 'button');
        mark.setAttribute(
          'aria-label',
          `Edit highlight: ${highlight.text}${highlight.note ? '. Has note' : ''}`,
        );
        mark.title = highlight.note || 'Edit highlight and note';
      } else if (highlight.note) mark.title = highlight.note;
      mark.textContent = node.data.slice(start, end);
      fragment.append(mark);
      cursor = end;
    }
    fragment.append(document.createTextNode(node.data.slice(cursor)));
    node.replaceWith(fragment);
  }
}

export function RichText({
  html,
  content,
  className = '',
  field,
  highlights = EMPTY_HIGHLIGHTS,
  annotationsEnabled = true,
  onHighlight,
  onSelection,
}: {
  html?: string | null;
  content?: string | null;
  className?: string;
  field?: 'passage' | 'stem';
  highlights?: TextHighlight[];
  annotationsEnabled?: boolean;
  onHighlight?: (id: string) => void;
  onSelection?: () => void;
}) {
  const root = useRef<HTMLDivElement>(null);
  const [image, setImage] = useState<{ src: string; alt: string } | null>(null);
  const [zoom, setZoom] = useState(1);
  const sanitized = useMemo(
    () =>
      DOMPurify.sanitize(html ?? content ?? '', {
        USE_PROFILES: { html: true },
        FORBID_TAGS: ['form', 'input', 'button', 'iframe', 'object', 'embed'],
        FORBID_ATTR: ['style', 'srcset'],
        ALLOW_DATA_ATTR: false,
      }),
    [html, content],
  );
  useEffect(() => {
    if (!root.current) return;
    root.current.innerHTML = sanitized;
    renderMath(root.current);
    renderHighlights(
      root.current,
      highlights.filter((highlight) => highlight.field === field),
      annotationsEnabled,
    );
    root.current.querySelectorAll('img').forEach((element) => {
      element.tabIndex = 0;
      element.setAttribute('role', 'button');
      element.setAttribute('aria-label', `Enlarge image: ${element.alt || 'question image'}`);
      element.loading = 'lazy';
    });
  }, [sanitized, highlights, field, annotationsEnabled]);
  function activate(target: EventTarget | null) {
    if (!(target instanceof Element)) return;
    const mark = target.closest<HTMLElement>('[data-highlight-id]');
    if (annotationsEnabled && mark?.dataset.highlightId) onHighlight?.(mark.dataset.highlightId);
    const img = target.closest('img');
    if (img) {
      setImage({ src: img.src, alt: img.alt });
      setZoom(1);
    }
  }
  return (
    <>
      <div
        ref={root}
        className={`rich-text ${className}`}
        data-annotation-field={field}
        onPointerUp={annotationsEnabled ? onSelection : undefined}
        onKeyUp={annotationsEnabled ? onSelection : undefined}
        onClick={(event) => activate(event.target)}
        onKeyDown={(event) => {
          if (
            (event.key === 'Enter' || event.key === ' ') &&
            event.target instanceof Element &&
            (event.target.matches('img') || (annotationsEnabled && event.target.matches('mark')))
          ) {
            event.preventDefault();
            activate(event.target);
          }
        }}
      />
      {image && <ImageViewer image={image} zoom={zoom} setZoom={setZoom} onClose={() => setImage(null)} />}
    </>
  );
}

function ImageViewer({
  image,
  zoom,
  setZoom,
  onClose,
}: {
  image: { src: string; alt: string };
  zoom: number;
  setZoom: (zoom: number) => void;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const viewport = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; y: number; left: number; top: number } | null>(null);
  useEffect(() => {
    dialog.current?.showModal();
    return () => dialog.current?.close();
  }, []);
  return (
    <dialog
      ref={dialog}
      className="image-viewer"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      aria-label="Question image viewer"
    >
      <div className="viewer-toolbar">
        <span>{image.alt || 'Question image'}</span>
        <button
          aria-label="Zoom image out"
          disabled={zoom <= 0.5}
          onClick={() => setZoom(Math.max(0.5, zoom - 0.25))}
        >
          <Minus size={18} />
        </button>
        <span>{Math.round(zoom * 100)}%</span>
        <button
          aria-label="Zoom image in"
          disabled={zoom >= 4}
          onClick={() => setZoom(Math.min(4, zoom + 0.25))}
        >
          <Plus size={18} />
        </button>
        <button
          aria-label="Reset image zoom"
          onClick={() => {
            setZoom(1);
            viewport.current?.scrollTo(0, 0);
          }}
        >
          <RotateCcw size={18} />
        </button>
        <button aria-label="Close image viewer" onClick={onClose}>
          <X size={20} />
        </button>
      </div>
      <div
        className="viewer-viewport"
        ref={viewport}
        onPointerDown={(event) => {
          if (!viewport.current) return;
          drag.current = {
            x: event.clientX,
            y: event.clientY,
            left: viewport.current.scrollLeft,
            top: viewport.current.scrollTop,
          };
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerMove={(event) => {
          if (!drag.current || !viewport.current) return;
          viewport.current.scrollLeft = drag.current.left + drag.current.x - event.clientX;
          viewport.current.scrollTop = drag.current.top + drag.current.y - event.clientY;
        }}
        onPointerUp={() => {
          drag.current = null;
        }}
        onPointerCancel={() => {
          drag.current = null;
        }}
      >
        <img
          draggable={false}
          src={image.src}
          alt={image.alt}
          style={{ width: `${zoom * 100}%`, maxWidth: 'none' }}
        />
      </div>
      <p className="viewer-hint">Drag to pan. Use the zoom controls or scroll to inspect details.</p>
    </dialog>
  );
}

export default RichText;
