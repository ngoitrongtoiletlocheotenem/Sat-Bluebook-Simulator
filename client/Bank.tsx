import { useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  Archive,
  ArrowDown,
  ArrowRight,
  ArrowUp,
  Check,
  CheckCircle2,
  Copy,
  Download,
  Eye,
  FileSpreadsheet,
  GripVertical,
  ImagePlus,
  Layers,
  Plus,
  Save,
  Search,
  Shuffle,
  Upload,
  X,
} from 'lucide-react';
import type {
  Attempt,
  Blueprint,
  BlueprintModule,
  Choice,
  ImportPreview,
  Question,
  Section,
  User,
} from '../shared/types';
import { api, download, json } from './api';
import { Empty, ErrorBox, Loading, Modal, PageHeading, Tag, useApp, useLoad } from './ui';

import { QuestionReview } from './Study';
import { QuestionImages } from './QuestionImages';
type BankPage = { items: Question[]; total: number; page: number; pageSize: number };
function RichEditor({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (s: string) => void;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const insert = (before: string, after = '') => {
    const t = ref.current;
    if (!t) return;
    const s = t.selectionStart,
      e = t.selectionEnd;
    onChange(value.slice(0, s) + before + value.slice(s, e) + after + value.slice(e));
    requestAnimationFrame(() => {
      t.focus();
      t.setSelectionRange(s + before.length, e + before.length);
    });
  };
  return (
    <label className="rich-editor">
      {label}
      <div className="rich-toolbar">
        <button type="button" aria-label={`Bold in ${label}`} onClick={() => insert('<strong>', '</strong>')}>
          <strong>B</strong>
        </button>
        <button type="button" aria-label={`Italic in ${label}`} onClick={() => insert('<em>', '</em>')}>
          <em>I</em>
        </button>
        <button type="button" onClick={() => insert('$x^2$')}>
          Math
        </button>
        <button
          type="button"
          onClick={() =>
            insert(
              '<table><thead><tr><th>Label</th><th>Value</th></tr></thead><tbody><tr><td>A</td><td>1</td></tr></tbody></table>',
            )
          }
        >
          Table
        </button>
        <button type="button" onClick={() => insert('<p>', '</p>')}>
          Paragraph
        </button>
      </div>
      <textarea
        ref={ref}
        aria-label={label}
        rows={label.includes('Passage') ? 5 : 3}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Text, safe HTML, or $LaTeX$"
      />
    </label>
  );
}
function QuestionEditor({
  initial,
  onClose,
  onSaved,
}: {
  initial?: Question;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { domains, user, toast } = useApp();
  const [q, setQ] = useState<Partial<Question>>(
    initial || {
      section: 'rw',
      domainId: domains.find((d) => d.section === 'rw')?.id || '',
      skillId: domains.find((d) => d.section === 'rw')?.skills[0]?.id || '',
      type: 'mcq',
      difficulty: 'medium',
      passage: '',
      stem: '',
      choices: ['A', 'B', 'C', 'D'].map((id) => ({ id, text: '', rationale: '' })),
      correctAnswer: 'A',
      acceptedAnswers: [],
      explanation: '',
      hint: '',
      strategy: '',
      tags: [],
      source: 'Original',
      license: 'Original; rights held by author',
      status: 'draft',
      images: [],
    },
  );
  const [preview, setPreview] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [scope, setScope] = useState(
      initial?.ownerId ? 'private' : user.role === 'student' ? 'private' : 'global',
    );
  const patch = (p: Partial<Question>) => setQ({ ...q, ...p });
  const choice = (index: number, p: Partial<Choice>) =>
    patch({ choices: q.choices!.map((c, i) => (i === index ? { ...c, ...p } : c)) });
  const moveChoice = (i: number, delta: number) => {
    const arr = [...q.choices!];
    const j = i + delta;
    if (j < 0 || j >= arr.length) return;
    [arr[i], arr[j]] = [arr[j], arr[i]];
    patch({ choices: arr });
  };
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await api(
        initial ? `/questions/${initial.id}` : '/questions',
        json(initial ? 'PUT' : 'POST', { ...q, scope, images: q.images?.filter(Boolean) }),
      );
      toast(initial ? 'New question version saved.' : 'Question created.');
      onSaved();
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const upload = async (file: File) => {
    const f = new FormData();
    f.set('file', file);
    try {
      const r = await api<{ url: string }>('/assets', { method: 'POST', body: f });
      patch({ images: [...(q.images || []), r.url] });
      toast('Image uploaded.');
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const domain = domains.find((d) => d.id === q.domainId);
  return (
    <Modal
      title={initial ? `Edit ${initial.publicId} · version ${initial.version + 1}` : 'Author a question'}
      wide
      onClose={onClose}
    >
      <div className="segmented">
        <button className={!preview ? 'active' : ''} onClick={() => setPreview(false)}>
          Edit content
        </button>
        <button className={preview ? 'active' : ''} onClick={() => setPreview(true)}>
          <Eye size={15} />
          Student preview
        </button>
      </div>
      {error && <ErrorBox message={error} />}
      <form onSubmit={save}>
        {preview ? (
          <QuestionReview
            showActions={false}
            question={
              {
                ...q,
                id: q.id || 'preview',
                publicId: q.publicId || 'Draft preview',
                version: q.version || 1,
              } as Question
            }
          />
        ) : (
          <div className="form-stack">
            <div className="form-row">
              <label>
                Section
                <select
                  value={q.section}
                  onChange={(e) => {
                    const d = domains.find((d) => d.section === e.target.value);
                    patch({ section: e.target.value as Section, domainId: d!.id, skillId: d!.skills[0].id });
                  }}
                >
                  <option value="rw">Reading and Writing</option>
                  <option value="math">Math</option>
                </select>
              </label>
              <label>
                Response type
                <select value={q.type} onChange={(e) => patch({ type: e.target.value as 'mcq' | 'spr' })}>
                  <option value="mcq">Multiple choice</option>
                  <option value="spr" disabled={q.section !== 'math'}>
                    Student-produced response
                  </option>
                </select>
              </label>
            </div>
            <div className="form-row">
              <label>
                Domain
                <select
                  value={q.domainId}
                  onChange={(e) => {
                    const d = domains.find((d) => d.id === e.target.value)!;
                    patch({ domainId: d.id, skillId: d.skills[0].id });
                  }}
                >
                  {domains
                    .filter((d) => d.section === q.section)
                    .map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.name}
                      </option>
                    ))}
                </select>
              </label>
              <label>
                Skill
                <select value={q.skillId} onChange={(e) => patch({ skillId: e.target.value })}>
                  {domain?.skills.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Difficulty
                <select
                  value={q.difficulty}
                  onChange={(e) => patch({ difficulty: e.target.value as Question['difficulty'] })}
                >
                  <option value="easy">Easy</option>
                  <option value="medium">Medium</option>
                  <option value="hard">Hard</option>
                </select>
              </label>
            </div>
            <RichEditor
              label="Passage / context"
              value={q.passage || ''}
              onChange={(passage) => patch({ passage })}
            />
            <RichEditor label="Question stem" value={q.stem || ''} onChange={(stem) => patch({ stem })} />
            {q.type === 'mcq' ? (
              <div className="choice-editor">
                <h3>Answer choices & rationale</h3>
                {q.choices?.map((c, i) => (
                  <div key={c.id} className="choice-edit-row">
                    <strong>{c.id}</strong>
                    <div>
                      <textarea
                        aria-label={`Choice ${c.id}`}
                        value={c.text}
                        onChange={(e) => choice(i, { text: e.target.value })}
                        required
                        rows={2}
                      />
                      <input
                        aria-label={`Rationale ${c.id}`}
                        value={c.rationale || ''}
                        onChange={(e) => choice(i, { rationale: e.target.value })}
                        placeholder="Explain why this choice is right or wrong"
                      />
                    </div>
                    <label className="correct-choice">
                      <input
                        type="radio"
                        name="correct"
                        checked={q.correctAnswer === c.id}
                        onChange={() => patch({ correctAnswer: c.id })}
                      />
                      Correct
                    </label>
                    <div>
                      <button
                        type="button"
                        className="icon-button"
                        aria-label={`Move choice ${c.id} up`}
                        onClick={() => moveChoice(i, -1)}
                        disabled={i === 0}
                      >
                        <ArrowUp size={16} />
                      </button>
                      <button
                        type="button"
                        className="icon-button"
                        aria-label={`Move choice ${c.id} down`}
                        onClick={() => moveChoice(i, 1)}
                        disabled={i === q.choices!.length - 1}
                      >
                        <ArrowDown size={16} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <label>
                Accepted numeric values (comma separated)
                <input
                  value={q.acceptedAnswers?.join(', ') || ''}
                  onChange={(e) =>
                    patch({
                      acceptedAnswers: e.target.value.split(',').map((s) => s.trim()),
                      correctAnswer: e.target.value.split(',')[0].trim(),
                    })
                  }
                  placeholder="0.5, 1/2"
                  required
                />
              </label>
            )}
            <RichEditor
              label="Full explanation"
              value={q.explanation || ''}
              onChange={(explanation) => patch({ explanation })}
            />
            <div className="form-row">
              <label>
                Hint
                <textarea value={q.hint || ''} onChange={(e) => patch({ hint: e.target.value })} rows={2} />
              </label>
              <label>
                Strategy note
                <textarea
                  value={q.strategy || ''}
                  onChange={(e) => patch({ strategy: e.target.value })}
                  rows={2}
                />
              </label>
            </div>
            <div className="image-author">
              <h3>Images and charts</h3>
              <p className="fine-print">
                If a figure could not be imported, upload it here to attach it directly to this question.
              </p>
              <label className="upload-button">
                <ImagePlus size={17} />
                Upload PNG, JPEG, WebP
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])}
                />
              </label>
              {q.images?.map((src, i) => (
                <div key={src} className="image-reference">
                  <img src={src} alt={`Question image ${i + 1}`} />
                  <input
                    aria-label={`Image URL ${i + 1}`}
                    value={src}
                    onChange={(e) =>
                      patch({ images: q.images!.map((s, j) => (j === i ? e.target.value : s)) })
                    }
                  />
                  <button
                    type="button"
                    className="icon-button"
                    onClick={() => patch({ images: q.images!.filter((_, j) => j !== i) })}
                    aria-label={`Remove image ${i + 1}`}
                  >
                    <X size={16} />
                  </button>
                </div>
              ))}
              <button
                type="button"
                className="text-button"
                onClick={() => patch({ images: [...(q.images || []), ''] })}
              >
                Add image reference
                <Plus size={15} />
              </button>
            </div>
            <div className="form-row">
              <label>
                Tags (comma separated)
                <input
                  value={q.tags?.join(', ') || ''}
                  onChange={(e) =>
                    patch({
                      tags: e.target.value
                        .split(',')
                        .map((t) => t.trim())
                        .filter(Boolean),
                    })
                  }
                />
              </label>
              <label>
                Subskill
                <input value={q.subskill || ''} onChange={(e) => patch({ subskill: e.target.value })} />
              </label>
            </div>
            <div className="form-row">
              <label>
                Source
                <input value={q.source || ''} onChange={(e) => patch({ source: e.target.value })} required />
              </label>
              <label>
                Source reference URL
                <input
                  value={q.sourceUrl || ''}
                  onChange={(e) => patch({ sourceUrl: e.target.value })}
                  type="url"
                />
              </label>
            </div>
            <label>
              Copyright / license / provenance
              <input value={q.license || ''} onChange={(e) => patch({ license: e.target.value })} required />
            </label>
            <div className="form-row">
              <label>
                Visibility
                <select value={scope} disabled={Boolean(initial)} onChange={(e) => setScope(e.target.value)}>
                  <option value="private">My private question bank</option>
                  {user.role !== 'student' && <option value="global">Shared question bank</option>}
                </select>
              </label>
              <label>
                Status
                <select
                  value={q.status}
                  onChange={(e) => patch({ status: e.target.value as Question['status'] })}
                >
                  <option value="draft">Draft</option>
                  <option value="published">Published</option>
                  <option value="archived">Archived</option>
                </select>
              </label>
              <label>
                Calculator metadata
                <select
                  value={q.calculator || 'allowed'}
                  onChange={(e) => patch({ calculator: e.target.value })}
                >
                  <option value="allowed">Allowed</option>
                  <option value="recommended">Recommended</option>
                  <option value="unnecessary">Unnecessary</option>
                  <option value="not-needed">Not needed</option>
                </select>
              </label>
            </div>
            {user.role !== 'student' && (
              <label>
                Administrative notes
                <textarea
                  value={q.adminNotes || ''}
                  onChange={(e) => patch({ adminNotes: e.target.value })}
                />
              </label>
            )}
          </div>
        )}
        <div className="modal-footer">
          <span className="fine-print">
            Editing creates a new version. Historical attempts keep their original content.
          </span>
          <button type="submit" className="primary" disabled={busy}>
            <Save size={16} />
            {busy ? 'Saving…' : initial ? 'Save new version' : 'Create question'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
function ImportQuestions({
  onClose,
  onImported,
  onManualEntry,
}: {
  onClose: () => void;
  onImported: () => void;
  onManualEntry: () => void;
}) {
  const { user, toast } = useApp();
  const [file, setFile] = useState<File | null>(null),
    [preview, setPreview] = useState<ImportPreview | null>(null),
    [scope, setScope] = useState(user.role === 'student' ? 'private' : 'global'),
    [mapping, setMapping] = useState(''),
    [repairingRow, setRepairingRow] = useState<number | null>(null),
    [uploadingImages, setUploadingImages] = useState(false),
    [failedImageRows, setFailedImageRows] = useState<Set<number>>(new Set()),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [report, setReport] = useState<{ imported: number; skipped: number; errors: unknown[] } | null>(null);
  const hasFailedReadyImages = preview?.rows.some(
    (row) => !row.errors.length && !row.duplicate && failedImageRows.has(row.row),
  );
  const parse = async () => {
    if (!file) return;
    setBusy(true);
    setError('');
    try {
      const f = new FormData();
      f.set('file', file);
      f.set('scope', scope);
      if (mapping) f.set('mapping', mapping);
      setPreview(await api<ImportPreview>('/imports/preview', { method: 'POST', body: f }));
      setFailedImageRows(new Set());
      setRepairingRow(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const saveImages = async (images: string[]) => {
    const row = repairingRow!;
    const updated = await api<ImportPreview>(
      `/imports/${preview!.id}/rows/${row}/images`,
      json('PATCH', { images }),
    );
    setPreview(updated);
    setFailedImageRows((previous) => new Set([...previous].filter((number) => number !== row)));
    setRepairingRow(null);
    toast('Images saved for this question.');
  };
  const confirm = async () => {
    setBusy(true);
    try {
      const r = await api<{ imported: number; skipped: number; errors: unknown[] }>(
        `/imports/${preview!.id}/confirm`,
        json('POST', { skipDuplicates: true, scope }),
      );
      setReport(r);
      onImported();
      toast(`${r.imported} questions imported.`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal title="Import your question collection" wide onClose={onClose} closeDisabled={uploadingImages}>
      <div className="import-steps">
        <span className={!preview ? 'active' : ''}>1 · Upload</span>
        <ArrowRight size={15} />
        <span className={preview && !report ? 'active' : ''}>2 · Preview & validate</span>
        <ArrowRight size={15} />
        <span className={report ? 'active' : ''}>3 · Import report</span>
      </div>
      {error && <ErrorBox message={error} />}
      {!preview && error && (
        <div className="import-manual-fallback">
          <p>If this file cannot be read, enter the question and attach its figures by hand.</p>
          <button className="secondary" onClick={onManualEntry}>
            Enter question manually
          </button>
        </div>
      )}
      <p className="muted">
        Bring questions you own or have permission to use. Invalid rows are rejected; duplicates are
        identified before anything is saved.
      </p>
      {!preview ? (
        <div className="form-stack">
          <label className="dropzone">
            <Upload size={28} />
            <strong>{file ? file.name : 'Choose a CSV, XLSX, or JSON file'}</strong>
            <span>Up to 5 MB · supplied content only</span>
            <input
              type="file"
              accept=".csv,.xlsx,.json"
              aria-label="Upload question file"
              onChange={(e) => setFile(e.target.files?.[0] || null)}
            />
          </label>
          <label>
            Destination
            <select value={scope} onChange={(e) => setScope(e.target.value)}>
              <option value="private">My private question bank</option>
              {user.role !== 'student' && <option value="global">Shared question bank</option>}
            </select>
          </label>
          <details>
            <summary>Map custom column names</summary>
            <label>
              Canonical field → source column (JSON)
              <textarea
                rows={3}
                value={mapping}
                onChange={(e) => setMapping(e.target.value)}
                placeholder={'{"stem":"Question Text","correctAnswer":"Answer"}'}
              />
            </label>
          </details>
          <div className="template-downloads">
            <span>Download a template:</span>
            {['csv', 'xlsx', 'json'].map((format) => (
              <button
                className="text-button"
                key={format}
                onClick={() =>
                  download(`/imports/template?format=${format}`, `pathwise-template.${format}`).catch((e) =>
                    setError(e.message),
                  )
                }
              >
                <FileSpreadsheet size={15} />
                {format.toUpperCase()}
              </button>
            ))}
          </div>
          <button className="primary" disabled={!file || busy || uploadingImages} onClick={parse}>
            Parse & preview
            <ArrowRight size={17} />
          </button>
        </div>
      ) : report ? (
        <div className="import-report">
          <CheckCircle2 size={42} />
          <h3>Your import is saved.</h3>
          <p>
            {report.imported} imported · {report.skipped} skipped
          </p>
          {report.errors?.length > 0 && <pre>{JSON.stringify(report.errors, null, 2)}</pre>}
          <button className="primary" onClick={onClose}>
            Back to library
            <ArrowRight size={17} />
          </button>
        </div>
      ) : (
        <>
          <p className="import-image-help">
            Check the figures for each question. If an image is missing, unreadable, or was not detected,
            attach it manually in that row. Text-only questions do not need this step.
          </p>
          <div className="import-totals">
            <Tag tone="green">{preview.valid} valid</Tag>
            <Tag tone="peach">{preview.invalid} invalid</Tag>
            <Tag>{preview.duplicates} duplicates</Tag>
          </div>
          <div className="table-scroll import-preview">
            <table>
              <thead>
                <tr>
                  <th>Row</th>
                  <th>Question</th>
                  <th>Images & graphs</th>
                  <th>Validation</th>
                </tr>
              </thead>
              <tbody>
                {preview.rows.map((row) => (
                  <tr key={row.row}>
                    <td>{row.row}</td>
                    <td>
                      <strong>{row.question.publicId || `Row ${row.row}`}</strong>
                      <p>{row.question.stem?.replace(/<[^>]*>/g, '').slice(0, 110)}</p>
                    </td>
                    <td className="import-row-images">
                      <div className="import-row-thumbnails">
                        {row.question.images
                          ?.slice(0, 10)
                          .map((url, index) =>
                            /^(https:\/\/|\/(?:assets|uploads)\/)/.test(url) ? (
                              <img
                                key={`${index}:${url}`}
                                src={url}
                                alt={`Imported image ${index + 1} for ${row.question.publicId || row.row}`}
                                loading="lazy"
                                onError={() =>
                                  setFailedImageRows((previous) => new Set([...previous, row.row]))
                                }
                              />
                            ) : null,
                          )}
                      </div>
                      <span
                        className={
                          row.imageErrors?.length || failedImageRows.has(row.row)
                            ? 'validation-error'
                            : 'fine-print'
                        }
                      >
                        {row.imageErrors?.length || failedImageRows.has(row.row)
                          ? 'Image needs attention'
                          : row.question.images?.length
                            ? `${row.question.images.length} image${row.question.images.length === 1 ? '' : 's'}`
                            : 'No image detected'}
                      </span>
                      <button
                        className="secondary small"
                        disabled={busy || repairingRow !== null}
                        aria-label={`${row.imageErrors?.length || failedImageRows.has(row.row) ? 'Repair' : row.question.images?.length ? 'Edit' : 'Attach'} images for ${row.question.publicId || `row ${row.row}`}`}
                        onClick={() => setRepairingRow(row.row)}
                      >
                        <ImagePlus size={15} />
                        {row.imageErrors?.length || failedImageRows.has(row.row)
                          ? 'Repair images'
                          : row.question.images?.length
                            ? 'Edit images'
                            : 'Attach images manually'}
                      </button>
                    </td>
                    <td>
                      {row.errors.length ? (
                        <span className="validation-error">{row.errors.join('; ')}</span>
                      ) : row.duplicate ? (
                        <Tag>Duplicate · skipped</Tag>
                      ) : (
                        <Tag tone="green">Ready</Tag>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {repairingRow !== null &&
            (() => {
              const row = preview.rows.find((item) => item.row === repairingRow)!;
              return (
                <QuestionImages
                  key={row.row}
                  questionId={row.question.publicId || `Row ${row.row}`}
                  images={row.question.images || []}
                  onSave={saveImages}
                  onCancel={() => setRepairingRow(null)}
                  onBusyChange={setUploadingImages}
                />
              );
            })()}
          {hasFailedReadyImages && (
            <p className="validation-error">
              Some image previews could not load. Repair or remove those images before confirming.
            </p>
          )}
          <div className="modal-footer">
            <button
              className="secondary"
              disabled={busy || repairingRow !== null}
              onClick={() => setPreview(null)}
            >
              Choose another file
            </button>
            <button
              className="primary"
              disabled={!preview.valid || busy || repairingRow !== null || hasFailedReadyImages}
              onClick={confirm}
            >
              <Check size={17} />
              {busy ? 'Importing…' : 'Confirm valid questions'}
            </button>
          </div>
        </>
      )}
    </Modal>
  );
}
export function QuestionBank() {
  const { domains, user, toast } = useApp();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [q, setQ] = useState(''),
    [section, setSection] = useState(''),
    [domain, setDomain] = useState(''),
    [difficulty, setDifficulty] = useState(''),
    [scope, setScope] = useState(''),
    [bookmarked, setBookmarked] = useState(params.get('bookmarked') === 'true'),
    [page, setPage] = useState(1),
    [edit, setEdit] = useState<Question | boolean | null>(null),
    [view, setView] = useState<Question | null>(null),
    [importing, setImporting] = useState(false);
  const query = new URLSearchParams({
    q,
    section,
    domainId: domain,
    difficulty,
    scope,
    page: String(page),
    ...(bookmarked ? { bookmarked: 'true' } : {}),
  });
  const { data, error, loading, reload } = useLoad(
    () => api<BankPage>(`/questions?${query}`),
    [q, section, domain, difficulty, scope, page, bookmarked],
  );
  const show = async (id: string) => {
    try {
      setView(await api<Question>(`/questions/${id}`));
    } catch (e) {
      toast((e as Error).message);
    }
  };
  const retry = async (id: string) => {
    try {
      const a = await api<Attempt>('/attempts', json('POST', { mode: 'tutor', questionIds: [id], count: 1 }));
      navigate(`/test/${a.id}`);
    } catch (e) {
      toast((e as Error).message);
    }
  };
  const archive = async (question: Question) => {
    try {
      await api(`/questions/${question.id}`, { method: 'DELETE' });
      toast('Question archived. Historical attempts are preserved.');
      await reload();
    } catch (e) {
      toast((e as Error).message);
    }
  };
  const change = (f: () => void) => {
    f();
    setPage(1);
  };
  return (
    <>
      <PageHeading
        eyebrow="YOUR QUESTION LIBRARY"
        title="Good practice starts here."
        description="Explore original questions, save the useful ones, or build your own collection."
      >
        <button
          className="secondary"
          onClick={() =>
            download(`/questions/export?scope=${scope || 'all'}`, 'pathwise-questions.json').catch((e) =>
              toast(e.message),
            )
          }
        >
          <Download size={16} />
          Export
        </button>
        <button className="secondary" onClick={() => setImporting(true)}>
          <Upload size={16} />
          Import
        </button>
        <button className="primary" onClick={() => setEdit(true)}>
          <Plus size={17} />
          Add question
        </button>
      </PageHeading>
      <div className="filter-bar bank-filters">
        <div className="search-input">
          <Search size={17} />
          <input
            value={q}
            onChange={(e) => change(() => setQ(e.target.value))}
            placeholder="Search questions, identifiers, or tags"
            aria-label="Search questions"
          />
        </div>
        <select
          aria-label="Filter by section"
          value={section}
          onChange={(e) =>
            change(() => {
              setSection(e.target.value);
              setDomain('');
            })
          }
        >
          <option value="">Both sections</option>
          <option value="rw">Reading and Writing</option>
          <option value="math">Math</option>
        </select>
        <select
          aria-label="Filter by domain"
          value={domain}
          onChange={(e) => change(() => setDomain(e.target.value))}
        >
          <option value="">All domains</option>
          {domains
            .filter((d) => !section || d.section === section)
            .map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
        </select>
        <select
          aria-label="Difficulty"
          value={difficulty}
          onChange={(e) => change(() => setDifficulty(e.target.value))}
        >
          <option value="">Any difficulty</option>
          <option value="easy">Easy</option>
          <option value="medium">Medium</option>
          <option value="hard">Hard</option>
        </select>
        <select
          aria-label="Bank visibility"
          value={scope}
          onChange={(e) => change(() => setScope(e.target.value))}
        >
          <option value="">All visible questions</option>
          <option value="global">Shared bank</option>
          <option value="private">My private bank</option>
        </select>
        <button
          className={`secondary small ${bookmarked ? 'selected' : ''}`}
          onClick={() => change(() => setBookmarked(!bookmarked))}
        >
          Saved only
        </button>
      </div>
      {error && <ErrorBox message={error} retry={reload} />}
      <section className="panel bank-panel">
        <div className="panel-heading">
          <h2>{bookmarked ? 'Your saved collection' : 'Explore the library'}</h2>
          <span className="muted">{data?.total || 0} questions · original & supplied content</span>
        </div>
        {loading ? (
          <Loading />
        ) : !data?.items.length ? (
          <Empty
            title="No questions in this view."
            description="Try another filter, or add your own original questions."
          />
        ) : (
          <>
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Question</th>
                    <th>Domain & skill</th>
                    <th>Difficulty</th>
                    <th>Source</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {data.items.map((question) => {
                    const d = domains.find((d) => d.id === question.domainId),
                      canEdit = user.role !== 'student' || question.ownerId === user.id;
                    return (
                      <tr key={question.id}>
                        <td className="bank-question">
                          <button className="question-link" onClick={() => show(question.id)}>
                            {question.publicId}
                          </button>
                          <p>{question.stem.replace(/<[^>]*>/g, '').slice(0, 100)}</p>
                          <small>
                            {question.type.toUpperCase()} · v{question.version} · {question.status}
                            {question.ownerId ? ' · private' : ''}
                          </small>
                        </td>
                        <td>
                          {d?.name}
                          <small className="table-detail">
                            {d?.skills.find((s) => s.id === question.skillId)?.name}
                          </small>
                        </td>
                        <td>
                          <Tag
                            tone={
                              question.difficulty === 'easy'
                                ? 'green'
                                : question.difficulty === 'hard'
                                  ? 'peach'
                                  : 'neutral'
                            }
                          >
                            {question.difficulty}
                          </Tag>
                        </td>
                        <td>{question.source}</td>
                        <td>
                          <div className="table-actions">
                            <button
                              className="icon-button"
                              onClick={() => show(question.id)}
                              aria-label={`Preview ${question.publicId}`}
                            >
                              <Eye size={17} />
                            </button>
                            {canEdit && (
                              <>
                                <button
                                  className="text-button"
                                  onClick={async () =>
                                    setEdit(await api<Question>(`/questions/${question.id}`))
                                  }
                                >
                                  Edit
                                </button>
                                <button
                                  className="icon-button"
                                  onClick={() => archive(question)}
                                  aria-label={`Archive ${question.publicId}`}
                                >
                                  <Archive size={17} />
                                </button>
                              </>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="pagination">
              <span>
                Page {page} of {Math.max(1, Math.ceil(data.total / data.pageSize))}
              </span>
              <div>
                <button className="secondary small" disabled={page === 1} onClick={() => setPage(page - 1)}>
                  Previous
                </button>
                <button
                  className="secondary small"
                  disabled={page * data.pageSize >= data.total}
                  onClick={() => setPage(page + 1)}
                >
                  Next
                </button>
              </div>
            </div>
          </>
        )}
      </section>
      {edit && (
        <QuestionEditor
          initial={typeof edit === 'object' ? edit : undefined}
          onClose={() => setEdit(null)}
          onSaved={reload}
        />
      )}{' '}
      {view && (
        <Modal title={view.publicId} wide onClose={() => setView(null)}>
          <QuestionReview question={view} onRetry={() => retry(view.id)} />
        </Modal>
      )}
      {importing && (
        <ImportQuestions
          onClose={() => setImporting(false)}
          onImported={reload}
          onManualEntry={() => {
            setImporting(false);
            setEdit(true);
          }}
        />
      )}
    </>
  );
}
const fullModules = (): BlueprintModule[] =>
  ['rw', 'math'].flatMap((s) =>
    ['mixed', 'higher', 'lower'].map((route, i) => ({
      section: s as Section,
      index: i === 0 ? 1 : 2,
      route: route as BlueprintModule['route'],
      count: s === 'rw' ? 27 : 22,
      durationSeconds: s === 'rw' ? 1920 : 2100,
      questionIds: [],
    })),
  );
function BlueprintEditor({
  initial,
  onClose,
  onSaved,
}: {
  initial?: Blueprint;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { toast } = useApp();
  const [b, setB] = useState<Partial<Blueprint>>(
      initial || {
        title: '',
        description: '',
        kind: 'full',
        published: false,
        seed: 'pathwise-' + Date.now(),
        routingThreshold: 0.65,
        routingModelVersion: 'accuracy-v1',
        modules: fullModules(),
      },
    ),
    [selectedModule, setSelectedModule] = useState(0),
    [search, setSearch] = useState(''),
    [page, setPage] = useState(1),
    [chosen, setChosen] = useState<Record<string, Question>>({}),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  const m = b.modules![selectedModule];
  const { data, loading } = useLoad(
    () => api<BankPage>(`/questions?section=${m.section}&q=${encodeURIComponent(search)}&page=${page}`),
    [m.section, search, page],
  );
  const modulePatch = (p: Partial<BlueprintModule>) =>
    setB({ ...b, modules: b.modules!.map((m, i) => (i === selectedModule ? { ...m, ...p } : m)) });
  const toggle = (q: Question) => {
    setChosen({ ...chosen, [q.id]: q });
    modulePatch({
      questionIds: m.questionIds.includes(q.id)
        ? m.questionIds.filter((id) => id !== q.id)
        : [...m.questionIds, q.id],
    });
  };
  const move = (i: number, j: number) => {
    if (j < 0 || j >= m.questionIds.length) return;
    const ids = [...m.questionIds];
    [ids[i], ids[j]] = [ids[j], ids[i]];
    modulePatch({ questionIds: ids });
  };
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await api(initial ? `/blueprints/${initial.id}` : '/blueprints', json(initial ? 'PUT' : 'POST', b));
      toast('Blueprint saved.');
      onSaved();
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal title={initial ? 'Edit test blueprint' : 'Build a test blueprint'} wide onClose={onClose}>
      {error && <ErrorBox message={error} />}
      <form onSubmit={save} className="form-stack">
        <div className="form-row">
          <label>
            Test title
            <input
              value={b.title}
              onChange={(e) => setB({ ...b, title: e.target.value })}
              required
              maxLength={150}
            />
          </label>
          <label>
            Test structure
            <select
              value={b.kind}
              onChange={(e) =>
                setB({
                  ...b,
                  kind: e.target.value as 'full' | 'custom',
                  modules:
                    e.target.value === 'full'
                      ? fullModules()
                      : [
                          {
                            section: 'rw',
                            index: 1,
                            route: 'mixed',
                            count: 10,
                            durationSeconds: 900,
                            questionIds: [],
                          },
                        ],
                })
              }
            >
              <option value="full">Standard full SAT blueprint</option>
              <option value="custom">Custom mode · flexible timing and counts</option>
            </select>
          </label>
        </div>
        <label>
          Description
          <input value={b.description} onChange={(e) => setB({ ...b, description: e.target.value })} />
        </label>
        <div className="form-row">
          <label>
            Reproducible seed
            <input value={b.seed} onChange={(e) => setB({ ...b, seed: e.target.value })} required />
          </label>
          <label>
            Higher-route accuracy threshold
            <input
              type="number"
              min="0"
              max="1"
              step="0.01"
              value={b.routingThreshold}
              onChange={(e) => setB({ ...b, routingThreshold: Number(e.target.value) })}
            />
          </label>
          <label className="checkbox-row">
            <input
              type="checkbox"
              checked={b.published}
              onChange={(e) => setB({ ...b, published: e.target.checked })}
            />
            Published
          </label>
        </div>
        <div className="blueprint-tabs">
          {b.modules!.map((m, i) => (
            <button
              type="button"
              key={i}
              className={selectedModule === i ? 'active' : ''}
              onClick={() => {
                setSelectedModule(i);
                setPage(1);
              }}
            >
              {m.section === 'rw' ? 'RW' : 'Math'} · M{m.index} · {m.route}
            </button>
          ))}
        </div>
        <div className="form-row">
          {b.kind === 'custom' && (
            <label>
              Section
              <select
                value={m.section}
                onChange={(e) => modulePatch({ section: e.target.value as Section, questionIds: [] })}
              >
                <option value="rw">Reading and Writing</option>
                <option value="math">Math</option>
              </select>
            </label>
          )}
          <label>
            Question count
            <input
              type="number"
              min="1"
              max="100"
              value={m.count}
              disabled={b.kind === 'full'}
              onChange={(e) => modulePatch({ count: Number(e.target.value) })}
            />
          </label>
          <label>
            Time (minutes)
            <input
              type="number"
              min="1"
              max="120"
              value={m.durationSeconds / 60}
              disabled={b.kind === 'full'}
              onChange={(e) => modulePatch({ durationSeconds: Number(e.target.value) * 60 })}
            />
          </label>
        </div>
        <div className="info-note">
          <strong>Manual or random assembly.</strong>
          <p>
            Select exactly {m.count} questions for this module, or leave it empty for deterministic random
            assembly. Standard SAT blueprints enforce module counts and times. Selected question versions are
            frozen when a student starts.
          </p>
        </div>
        <div className="builder-question-layout">
          <section>
            <h3>Available questions</h3>
            <div className="search-input">
              <Search size={16} />
              <input
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setPage(1);
                }}
                placeholder="Search this section"
                aria-label="Search builder questions"
              />
            </div>
            {loading ? (
              <Loading />
            ) : (
              data?.items.map((q) => (
                <button
                  type="button"
                  className={`builder-question ${m.questionIds.includes(q.id) ? 'selected' : ''}`}
                  key={q.id}
                  onClick={() => toggle(q)}
                >
                  <span>{m.questionIds.includes(q.id) ? <Check size={15} /> : <Plus size={15} />}</span>
                  <div>
                    <strong>{q.publicId}</strong>
                    <small>{q.stem.replace(/<[^>]*>/g, '').slice(0, 70)}</small>
                  </div>
                  <Tag>{q.difficulty}</Tag>
                </button>
              ))
            )}
            <div className="pagination">
              <button
                type="button"
                className="secondary small"
                disabled={page === 1}
                onClick={() => setPage(page - 1)}
              >
                Previous
              </button>
              <button
                type="button"
                className="secondary small"
                disabled={!data || page * data.pageSize >= data.total}
                onClick={() => setPage(page + 1)}
              >
                Next
              </button>
            </div>
          </section>
          <section>
            <h3>
              Module order · {m.questionIds.length} / {m.count}
            </h3>
            {!m.questionIds.length ? (
              <div className="builder-random">
                <Shuffle size={28} />
                <p>A balanced pool will be generated from your seed.</p>
              </div>
            ) : (
              m.questionIds.map((id, i) => (
                <div
                  className="selected-question"
                  key={id}
                  draggable
                  onDragStart={(e) => e.dataTransfer.setData('text/plain', String(i))}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => {
                    e.preventDefault();
                    const from = Number(e.dataTransfer.getData('text/plain'));
                    if (Number.isInteger(from) && from >= 0 && from < m.questionIds.length) {
                      const ids = [...m.questionIds];
                      const [item] = ids.splice(from, 1);
                      ids.splice(i, 0, item);
                      modulePatch({ questionIds: ids });
                    }
                  }}
                >
                  <GripVertical size={15} />
                  <span>
                    {i + 1}. {chosen[id]?.publicId || id.slice(0, 12)}
                  </span>
                  <button
                    type="button"
                    className="icon-button"
                    onClick={() => move(i, i - 1)}
                    aria-label={`Move question ${i + 1} up`}
                  >
                    <ArrowUp size={14} />
                  </button>
                  <button
                    type="button"
                    className="icon-button"
                    onClick={() => move(i, i + 1)}
                    aria-label={`Move question ${i + 1} down`}
                  >
                    <ArrowDown size={14} />
                  </button>
                  <button
                    type="button"
                    className="icon-button"
                    onClick={() => modulePatch({ questionIds: m.questionIds.filter((q) => q !== id) })}
                    aria-label={`Remove question ${i + 1}`}
                  >
                    <X size={14} />
                  </button>
                </div>
              ))
            )}
          </section>
        </div>
        <div className="modal-footer">
          <span className="fine-print">
            Routing is configurable internal practice logic, not College Board’s private model.
          </span>
          <button className="primary" type="submit" disabled={busy}>
            <Save size={17} />
            {busy ? 'Saving…' : 'Save blueprint'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
export function TestBuilder() {
  const { user, toast } = useApp();
  const navigate = useNavigate();
  const { data, error, loading, reload } = useLoad(() => api<Blueprint[]>('/blueprints'));
  const [edit, setEdit] = useState<Blueprint | boolean | null>(null),
    [busy, setBusy] = useState('');
  const launch = async (b: Blueprint) => {
    setBusy(b.id);
    try {
      const a = await api<Attempt>(
        '/attempts',
        json('POST', { mode: b.kind === 'full' ? 'full' : 'practice', blueprintId: b.id }),
      );
      navigate(`/test/${a.id}`);
    } catch (e) {
      toast((e as Error).message);
    } finally {
      setBusy('');
    }
  };
  const duplicate = async (b: Blueprint) => {
    try {
      const { id: _id, ...copy } = b;
      await api('/blueprints', json('POST', { ...copy, title: `${b.title} (copy)`, published: false }));
      await reload();
      toast('Blueprint duplicated.');
    } catch (e) {
      toast((e as Error).message);
    }
  };
  const publish = async (b: Blueprint) => {
    try {
      await api(`/blueprints/${b.id}`, json('PUT', { ...b, published: !b.published }));
      await reload();
      toast(b.published ? 'Blueprint unpublished.' : 'Blueprint published.');
    } catch (e) {
      toast((e as Error).message);
    }
  };
  return (
    <>
      <PageHeading
        eyebrow="ASSEMBLE YOUR NEXT CHALLENGE"
        title={
          user.role === 'student'
            ? 'Ready for your next assessment?'
            : 'Thoughtfully built. Ready to practice.'
        }
        description="Reproducible question pools, versioned adaptive routes, and a focused test experience."
      >
        {user.role !== 'student' && (
          <button className="primary" onClick={() => setEdit(true)}>
            <Plus size={17} />
            Build a test
          </button>
        )}
      </PageHeading>
      {loading ? (
        <Loading />
      ) : error ? (
        <ErrorBox message={error} retry={reload} />
      ) : !data?.length ? (
        <Empty
          title="A space for your next test."
          description="Teachers can publish reusable blueprints here. You can create personal practice in the Practice Studio."
        />
      ) : (
        <div className="blueprint-grid">
          {data.map((b) => (
            <section className="panel blueprint-card" key={b.id}>
              <div className="blueprint-top">
                <span className="quick-icon sage">
                  <Layers size={24} />
                </span>
                <Tag tone={b.published ? 'green' : 'neutral'}>{b.published ? 'Published' : 'Draft'}</Tag>
              </div>
              <h2>{b.title}</h2>
              <p>{b.description}</p>
              <div className="blueprint-details">
                <span>{b.kind === 'full' ? 'Full adaptive SAT' : 'Custom practice'}</span>
                <span>{b.modules.length} module pools</span>
                <span>Threshold {Math.round(b.routingThreshold * 100)}%</span>
              </div>
              <p className="fine-print">
                Seed: {b.seed} · {b.routingModelVersion}
              </p>
              <div className="blueprint-actions">
                <button className="primary small" onClick={() => launch(b)} disabled={busy === b.id}>
                  Start test
                  <ArrowRight size={16} />
                </button>
                {user.role !== 'student' && (
                  <>
                    <button className="secondary small" onClick={() => setEdit(b)}>
                      Edit
                    </button>
                    <button
                      className="icon-button"
                      onClick={() => duplicate(b)}
                      aria-label={`Duplicate ${b.title}`}
                    >
                      <Copy size={16} />
                    </button>
                    <button className="text-button" onClick={() => publish(b)}>
                      {b.published ? 'Unpublish' : 'Publish'}
                    </button>
                  </>
                )}
              </div>
            </section>
          ))}
        </div>
      )}
      {edit && (
        <BlueprintEditor
          initial={typeof edit === 'object' ? edit : undefined}
          onClose={() => setEdit(null)}
          onSaved={reload}
        />
      )}
    </>
  );
}
export function UsersPage() {
  const { user, toast } = useApp();
  const { data, error, loading, reload } = useLoad(() =>
    user.role === 'admin' ? api<User[]>('/users') : Promise.resolve([]),
  );
  const role = async (id: string, role: string) => {
    try {
      await api(`/users/${id}`, json('PUT', { role }));
      toast('User role updated.');
      await reload();
    } catch (e) {
      toast((e as Error).message);
    }
  };
  if (user.role !== 'admin')
    return (
      <Empty
        title="Administrator workspace"
        description="Your current role does not have access to user management."
      />
    );
  return (
    <>
      <PageHeading
        eyebrow="ADMINISTRATION"
        title="The people behind the progress."
        description="Manage student, teacher, and administrator access."
      />
      {loading ? (
        <Loading />
      ) : error ? (
        <ErrorBox message={error} retry={reload} />
      ) : (
        <section className="panel table-scroll">
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Email</th>
                <th>Role</th>
              </tr>
            </thead>
            <tbody>
              {data!.map((u) => (
                <tr key={u.id}>
                  <td>{u.name}</td>
                  <td>{u.email}</td>
                  <td>
                    <select
                      aria-label={`Role for ${u.name}`}
                      disabled={u.id === user.id}
                      value={u.role}
                      onChange={(e) => role(u.id, e.target.value)}
                    >
                      <option value="student">Student</option>
                      <option value="teacher">Teacher</option>
                      <option value="admin">Admin</option>
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </>
  );
}
