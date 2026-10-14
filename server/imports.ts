import type { Knex } from 'knex';
import { randomUUID, createHash } from 'node:crypto';
import ExcelJS from 'exceljs';
import { parse } from 'csv-parse/sync';
import type { ImportPreview, ImportRow, Question, User } from '../shared/types.js';
import { questionSchema, ApiError } from './validation.js';
import { createQuestion, questionQuery, toQuestion } from './questions.js';
import { encode, json, now } from './db.js';
import { DOMAINS, SKILLS } from './taxonomy.js';
import { loadTaxonomy } from './taxonomy-management.js';

const fingerprint = (q: any) =>
  createHash('sha256')
    .update(
      `${q.section}|${String(q.stem).trim().toLowerCase()}|${String(q.passage || '')
        .trim()
        .toLowerCase()}`,
    )
    .digest('hex');
export const TEMPLATE_COLUMNS = [
  'publicId',
  'section',
  'domainId',
  'skillId',
  'type',
  'difficulty',
  'passage',
  'stem',
  'choiceA',
  'choiceB',
  'choiceC',
  'choiceD',
  'correctAnswer',
  'acceptedAnswers',
  'explanation',
  'rationaleA',
  'rationaleB',
  'rationaleC',
  'rationaleD',
  'tags',
  'images',
  'license',
  'source',
];
const templateQuestion = {
  publicId: 'YOUR-001',
  section: 'math',
  domainId: 'math-algebra',
  skillId: 'math-algebra-1',
  type: 'mcq',
  difficulty: 'easy',
  passage: '',
  stem: 'If $2x+3=11$, what is $x$?',
  choiceA: '2',
  choiceB: '3',
  choiceC: '4',
  choiceD: '5',
  correctAnswer: 'C',
  acceptedAnswers: '',
  explanation: 'Subtract 3, then divide by 2 to get $x=4$.',
  rationaleA: 'Substitution gives 7, not 11.',
  rationaleB: 'Substitution gives 9, not 11.',
  rationaleC: 'Substitution gives 11.',
  rationaleD: 'Substitution gives 13, not 11.',
  tags: 'original,algebra',
  images: '',
  license: 'Your original content or explicit permission statement',
  source: 'User authored',
};
function list(value: any): string[] {
  if (Array.isArray(value)) return value.map(String);
  if (!value) return [];
  try {
    const x = JSON.parse(value);
    if (Array.isArray(x)) return x.map(String);
  } catch {}
  return String(value)
    .split(/[;,]/)
    .map((s) => s.trim())
    .filter(Boolean);
}
function decodeRow(row: Record<string, any>, mapping: Record<string, string> = {}) {
  const q: any = { ...row };
  for (const [target, source] of Object.entries(mapping)) q[target] = row[source];
  for (const key of Object.keys(q)) if (q[key] === null || q[key] === undefined) delete q[key];
  q.section = String(q.section || '')
    .toLowerCase()
    .replace(/[ &-]/g, '');
  if (['readingwriting', 'readingandwriting', 'reading'].includes(q.section)) q.section = 'rw';
  q.type = String(q.type || 'mcq').toLowerCase();
  q.difficulty = String(q.difficulty || 'medium').toLowerCase();
  q.domainId =
    DOMAINS.find((d) => d.name.toLowerCase() === String(q.domainId).toLowerCase())?.id || q.domainId;
  q.skillId =
    SKILLS.find((s) => s.domainId === q.domainId && s.name.toLowerCase() === String(q.skillId).toLowerCase())
      ?.id || q.skillId;
  if (typeof q.choices === 'string')
    try {
      q.choices = JSON.parse(q.choices);
    } catch {
      q.choices = [];
    }
  if (!q.choices)
    q.choices =
      q.type === 'mcq'
        ? 'ABCD'.split('').map((id) => ({
            id,
            text: String(q[`choice${id}`] || ''),
            rationale: String(q[`rationale${id}`] || ''),
          }))
        : [];
  q.tags = list(q.tags);
  q.images = list(q.images);
  q.acceptedAnswers = list(q.acceptedAnswers);
  if (q.difficultyValue !== undefined) q.difficultyValue = Number(q.difficultyValue);
  if (q.private !== undefined) q.private = q.private === true || q.private === 'true';
  return q;
}
export async function parseFile(buffer: Buffer, filename: string): Promise<Record<string, any>[]> {
  if (/\.json$/i.test(filename)) {
    let value: any;
    try {
      value = JSON.parse(buffer.toString('utf8'));
    } catch {
      throw new ApiError(422, 'Invalid JSON');
    }
    const rows = Array.isArray(value) ? value : value.questions;
    if (!Array.isArray(rows)) throw new ApiError(422, 'JSON must contain an array of questions');
    return rows;
  }
  if (/\.csv$/i.test(filename)) {
    try {
      return parse(buffer.toString('utf8'), {
        columns: true,
        bom: true,
        skip_empty_lines: true,
        max_record_size: 100_000,
        relax_column_count: false,
      });
    } catch {
      throw new ApiError(422, 'Invalid CSV; check its headers and quoting');
    }
  }
  if (/\.xlsx$/i.test(filename)) {
    // Reject highly expanded ZIP archives before ExcelJS decompresses workbook XML.
    let expanded = 0;
    for (let offset = 0; offset + 46 < buffer.length; offset++)
      if (buffer.readUInt32LE(offset) === 0x02014b50) {
        expanded += buffer.readUInt32LE(offset + 24);
        if (expanded > 30_000_000) throw new ApiError(413, 'Expanded workbook exceeds 30 MB');
      }
    const book = new ExcelJS.Workbook();
    try {
      await book.xlsx.load(buffer as any);
    } catch {
      throw new ApiError(422, 'Invalid XLSX workbook');
    }
    const sheet = book.worksheets[0];
    if (!sheet) return [];
    if (sheet.rowCount > 5001) throw new ApiError(413, 'Maximum 5000 rows per import');
    const headers = Array.from({ length: sheet.columnCount }, (_, i) =>
      String(sheet.getRow(1).getCell(i + 1).text || ''),
    );
    const rows: Record<string, any>[] = [];
    for (let r = 2; r <= sheet.rowCount; r++) {
      const item: Record<string, any> = {};
      for (let c = 0; c < headers.length; c++)
        if (headers[c]) item[headers[c]!] = sheet.getRow(r).getCell(c + 1).text;
      if (Object.values(item).some(Boolean)) rows.push(item);
    }
    return rows;
  }
  throw new ApiError(415, 'Upload a .csv, .xlsx, or .json question file');
}
export async function previewImport(
  db: Knex,
  user: User,
  rows: Record<string, any>[],
  mapping: Record<string, string> = {},
  scope = 'private',
): Promise<ImportPreview> {
  if (rows.length > 5000) throw new ApiError(413, 'Maximum 5000 rows per import');
  if (scope === 'global' && user.role === 'student')
    throw new ApiError(403, 'Students can import into their private bank only');
  const taxonomy = await loadTaxonomy(db);
  const existing = await questionQuery(db, user),
    ids = new Set<string>(existing.map((r) => r.public_id)),
    fingerprints = new Set(existing.map((r) => fingerprint(json(r.content))));
  const previewRows: ImportRow[] = rows.map((raw, index) => {
    const row = decodeRow(raw, mapping);
    row.private = scope !== 'global';
    const valid = questionSchema.safeParse(row),
      errors = valid.success
        ? []
        : valid.error.issues.map((i) => `${i.path.join('.') || 'question'}: ${i.message}`);
    if (!taxonomy.some((d) => d.id === row.domainId && d.section === row.section))
      errors.push('Domain does not match section');
    if (!taxonomy.some((d) => d.id === row.domainId && d.skills.some((s) => s.id === row.skillId)))
      errors.push('Skill does not match domain');
    if (
      row.type === 'mcq' &&
      Array.isArray(row.choices) &&
      row.choices.some((c: any) => !String(c?.text || '').trim())
    )
      errors.push('All four answer choices require text');
    const duplicate = ids.has(row.publicId) || fingerprints.has(fingerprint(row));
    ids.add(row.publicId);
    fingerprints.add(fingerprint(row));
    return {
      row: index + 2,
      question: (valid.success ? valid.data : row) as Partial<Question>,
      errors,
      duplicate,
    };
  });
  const preview: ImportPreview = {
    id: randomUUID(),
    rows: previewRows,
    valid: previewRows.filter((r) => !r.errors.length && !r.duplicate).length,
    invalid: previewRows.filter((r) => r.errors.length).length,
    duplicates: previewRows.filter((r) => r.duplicate).length,
    columns: Object.keys(rows[0] || {}),
  };
  await db('import_jobs').insert({
    id: preview.id,
    user_id: user.id,
    status: 'preview',
    preview: encode({ ...preview, scope }),
    created_at: now(),
  });
  return preview;
}
export async function confirmImport(db: Knex, user: User, id: string, skipDuplicates = true) {
  return db.transaction(async (trx) => {
    const query = trx('import_jobs').where({ id, user_id: user.id });
    if (db.client.config.client === 'pg') query.forUpdate();
    const job = await query.first();
    if (!job) throw new ApiError(404, 'Import not found');
    if (job.status === 'completed') return json(job.report);
    const preview = json<ImportPreview & { scope: string }>(job.preview);
    if (preview.scope === 'global' && user.role === 'student')
      throw new ApiError(403, 'Shared import permission required');
    if (preview.duplicates && !skipDuplicates)
      throw new ApiError(409, 'Resolve duplicates or enable skipDuplicates before importing');
    let imported = 0,
      skipped = 0;
    const errors: { row: number; errors: string[] }[] = [];
    for (const row of preview.rows) {
      if (row.errors.length) {
        errors.push({ row: row.row, errors: row.errors });
        skipped++;
        continue;
      }
      if (row.duplicate) {
        skipped++;
        continue;
      }
      try {
        await createQuestion(trx, user, row.question);
        imported++;
      } catch (e) {
        if (e instanceof ApiError) {
          errors.push({ row: row.row, errors: [e.message] });
          skipped++;
        } else throw e;
      }
    }
    await trx('import_jobs')
      .where({ id })
      .update({ status: 'completed', report: encode({ imported, skipped, errors }) });
    return { imported, skipped, errors };
  });
}
export async function template(format: string) {
  if (format === 'json') {
    const q = decodeRow(templateQuestion);
    return {
      type: 'application/json',
      filename: 'question-template.json',
      data: Buffer.from(JSON.stringify([q], null, 2)),
    };
  }
  if (format === 'xlsx') {
    const book = new ExcelJS.Workbook(),
      sheet = book.addWorksheet('Questions');
    sheet.addRow(TEMPLATE_COLUMNS);
    sheet.addRow(TEMPLATE_COLUMNS.map((c) => (templateQuestion as any)[c] || ''));
    sheet.getRow(1).font = { bold: true };
    sheet.columns.forEach((c) => {
      c.width = 22;
    });
    return {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      filename: 'question-template.xlsx',
      data: Buffer.from(await book.xlsx.writeBuffer()),
    };
  }
  const quote = (s: any) => `"${String(s || '').replace(/"/g, '""')}"`;
  return {
    type: 'text/csv',
    filename: 'question-template.csv',
    data: Buffer.from(
      [
        TEMPLATE_COLUMNS.map(quote).join(','),
        TEMPLATE_COLUMNS.map((c) => quote((templateQuestion as any)[c])).join(','),
      ].join('\r\n'),
    ),
  };
}
export async function exportQuestions(db: Knex, user: User) {
  return (await questionQuery(db, user)).map((r) => {
    const q = toQuestion(r, true);
    if (user.role !== 'admin') delete q.adminNotes;
    return q;
  });
}
