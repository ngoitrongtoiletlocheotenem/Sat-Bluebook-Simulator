import { useEffect, useRef, useState } from 'react';
import { ImagePlus, Save, X } from 'lucide-react';
import type { QuestionAsset } from '../shared/types';
import { api } from './api';
import { ErrorBox } from './ui';

export function QuestionImages({
  questionId,
  images,
  onSave,
  onCancel,
  onBusyChange,
}: {
  questionId: string;
  images: string[];
  onSave: (images: string[]) => Promise<void>;
  onCancel: () => void;
  onBusyChange: (busy: boolean) => void;
}) {
  const [draft, setDraft] = useState(images);
  const [failed, setFailed] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState('');
  const [errors, setErrors] = useState<string[]>([]);
  const [dragging, setDragging] = useState(false);
  const inFlight = useRef(false);
  const hasUnavailable = draft.some(
    (url) => failed.has(url) || !/^(https:\/\/|\/(?:assets|uploads)\/)/.test(url),
  );
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    heading.current?.focus();
    heading.current?.scrollIntoView({ block: 'nearest' });
    return () => previous?.focus();
  }, []);

  const upload = async (files: File[]) => {
    if (inFlight.current || !files.length) return;
    if (draft.length + files.length > 10) {
      setErrors(['Each question supports up to 10 images. Remove unwanted references before uploading.']);
      return;
    }
    inFlight.current = true;
    setBusy(true);
    onBusyChange(true);
    setErrors([]);
    const failures: string[] = [];
    const uploaded: string[] = [];
    try {
      for (const [index, file] of files.entries()) {
        setProgress(`Uploading ${index + 1} of ${files.length}…`);
        if (!/\.(png|jpe?g|webp)$/i.test(file.name)) {
          failures.push(`${file.name}: use a PNG, JPEG, or WebP image.`);
          continue;
        }
        if (file.size > 5 * 1024 * 1024) {
          failures.push(`${file.name}: maximum file size is 5 MB.`);
          continue;
        }
        const body = new FormData();
        body.set('file', file);
        try {
          const image = await api<QuestionAsset>('/assets', { method: 'POST', body });
          uploaded.push(image.url);
        } catch (e) {
          failures.push(`${file.name}: ${(e as Error).message}`);
        }
      }
      setDraft((previous) => [...previous, ...uploaded]);
      setErrors(failures);
    } finally {
      setProgress('');
      setBusy(false);
      onBusyChange(false);
      inFlight.current = false;
    }
  };
  const save = async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    onBusyChange(true);
    setErrors([]);
    try {
      await onSave(draft);
    } catch (e) {
      setErrors([(e as Error).message]);
    } finally {
      setBusy(false);
      onBusyChange(false);
      inFlight.current = false;
    }
  };

  return (
    <section className="question-image-repair" aria-label={`Images for ${questionId}`}>
      <h3 ref={heading} tabIndex={-1}>
        Images for {questionId}
      </h3>
      <p>
        Use this manual step when the importer could not read a figure or find its image. Remove a broken
        reference, then upload the original image or graph. Saved images attach directly to this question; you
        do not need to edit the spreadsheet.
      </p>
      {draft.length > 0 && (
        <div className="repair-image-grid">
          {draft.map((url, index) => {
            const previewable = /^(https:\/\/|\/(?:assets|uploads)\/)/.test(url);
            const unavailable = !previewable || failed.has(url);
            return (
              <article className="repair-image-card" key={`${index}:${url}`}>
                {unavailable ? (
                  <div className="repair-image-missing">
                    <ImagePlus size={24} /> Image unavailable
                  </div>
                ) : (
                  <img
                    src={url}
                    alt={`Question image ${index + 1}`}
                    onError={() => setFailed((previous) => new Set([...previous, url]))}
                  />
                )}
                <p className="repair-image-reference" title={url.startsWith('data:') ? undefined : url}>
                  {url.startsWith('data:')
                    ? 'Embedded image data could not be imported'
                    : url || 'Empty image reference'}
                </p>
                <button
                  type="button"
                  className="secondary small"
                  aria-label={`Remove image ${index + 1}`}
                  disabled={busy}
                  onClick={() => setDraft((previous) => previous.filter((_, i) => i !== index))}
                >
                  <X size={15} /> Remove image {index + 1}
                </button>
              </article>
            );
          })}
        </div>
      )}
      <label
        className={`image-dropzone${dragging ? ' dragging' : ''}`}
        onDragOver={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => {
          event.preventDefault();
          setDragging(false);
          void upload(Array.from(event.dataTransfer.files));
        }}
      >
        <ImagePlus size={25} aria-hidden="true" />
        <strong>Upload images for this question</strong>
        <span>Drop files here or choose PNG, JPEG, WebP · up to 5 MB each</span>
        <input
          type="file"
          multiple
          accept="image/png,image/jpeg,image/webp,.png,.jpg,.jpeg,.webp"
          aria-label="Upload replacement images"
          disabled={busy}
          onChange={(event) => {
            const files = Array.from(event.target.files || []);
            event.target.value = '';
            void upload(files);
          }}
        />
      </label>
      <div role="status" aria-live="polite" className="image-upload-status">
        {progress}
      </div>
      {errors.length > 0 && <ErrorBox message={errors.join(' ')} />}
      {hasUnavailable && (
        <p className="validation-error">
          Remove the unavailable image reference before saving its replacement.
        </p>
      )}
      <p className="fine-print">
        Only this question’s images change. Text, choices, answers, and explanations stay as parsed. Uploaded
        image links can be opened by anyone who has the link.
      </p>
      <div className="repair-image-actions">
        <button type="button" className="secondary" disabled={busy} onClick={onCancel}>
          Cancel image changes
        </button>
        <button
          type="button"
          className="primary"
          aria-label="Save images"
          disabled={busy || hasUnavailable}
          onClick={() => void save()}
        >
          <Save size={16} /> {busy ? 'Working…' : 'Save images'}
        </button>
      </div>
    </section>
  );
}
