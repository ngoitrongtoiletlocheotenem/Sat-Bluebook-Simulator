import { useState } from 'react';
import { Plus, Save } from 'lucide-react';
import type { Domain, Skill } from '../shared/types';
import { api, json } from './api';
import { ErrorBox, useApp } from './ui';
export default function TaxonomySettings() {
  const { domains, toast } = useApp();
  const [draft, setDraft] = useState<Domain[]>(structuredClone(domains)),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  const change = (id: string, p: Partial<Domain>) =>
    setDraft(draft.map((d) => (d.id === id ? { ...d, ...p } : d)));
  const skillChange = (domainId: string, index: number, p: Partial<Skill>) =>
    setDraft(
      draft.map((d) =>
        d.id === domainId ? { ...d, skills: d.skills.map((s, i) => (i === index ? { ...s, ...p } : s)) } : d,
      ),
    );
  const save = async () => {
    setBusy(true);
    setError('');
    try {
      await api(
        '/taxonomy',
        json('PUT', {
          domains: draft.map(({ skills: _skills, ...d }) => d),
          skills: draft.flatMap((d) => d.skills),
        }),
      );
      toast('Taxonomy saved. Refresh your workspace to use updated labels.');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="panel spaced">
      <div className="panel-heading">
        <div>
          <span className="eyebrow">ADMINISTRATOR SETTINGS</span>
          <h2>Domains and skills</h2>
        </div>
        <button className="primary small" onClick={save} disabled={busy}>
          <Save size={15} />
          {busy ? 'Saving…' : 'Save taxonomy'}
        </button>
      </div>
      <p className="muted">
        Keep established identifiers stable. Edit labels or extend the taxonomy; standard full-SAT blueprints
        retain the official eight-domain distribution. Custom practice supports your own domain weights.
      </p>
      {error && <ErrorBox message={error} />}
      <div className="taxonomy-grid">
        {draft.map((d) => (
          <details key={d.id} className="taxonomy-domain">
            <summary>
              {d.name || 'New domain'} · {d.section === 'rw' ? 'Reading and Writing' : 'Math'}
            </summary>
            <div className="form-stack">
              <div className="form-row">
                <label>
                  Identifier
                  <input
                    value={d.id}
                    readOnly={domains.some((x) => x.id === d.id)}
                    onChange={(e) =>
                      change(d.id, {
                        id: e.target.value,
                        skills: d.skills.map((s) => ({ ...s, domainId: e.target.value })),
                      })
                    }
                  />
                </label>
                <label>
                  Section
                  <select
                    value={d.section}
                    disabled={domains.some((x) => x.id === d.id)}
                    onChange={(e) => change(d.id, { section: e.target.value as 'rw' | 'math' })}
                  >
                    <option value="rw">Reading and Writing</option>
                    <option value="math">Math</option>
                  </select>
                </label>
              </div>
              <label>
                Domain name
                <input value={d.name} onChange={(e) => change(d.id, { name: e.target.value })} />
              </label>
              <div className="form-row">
                <label>
                  Approximate percentage
                  <input
                    type="number"
                    min="0"
                    max="100"
                    value={d.percentage}
                    onChange={(e) => change(d.id, { percentage: Number(e.target.value) })}
                  />
                </label>
                <label>
                  Expected question range
                  <input
                    value={d.questionRange}
                    onChange={(e) => change(d.id, { questionRange: e.target.value })}
                  />
                </label>
              </div>
              {d.skills.map((s, i) => (
                <div className="form-row" key={`${d.id}-${i}`}>
                  <label>
                    Skill identifier
                    <input
                      value={s.id}
                      readOnly={domains.flatMap((d) => d.skills).some((x) => x.id === s.id)}
                      onChange={(e) => skillChange(d.id, i, { id: e.target.value })}
                    />
                  </label>
                  <label>
                    Skill name
                    <input value={s.name} onChange={(e) => skillChange(d.id, i, { name: e.target.value })} />
                  </label>
                </div>
              ))}
              <button
                className="secondary small"
                onClick={() =>
                  change(d.id, {
                    skills: [
                      ...d.skills,
                      { id: `skill-${crypto.randomUUID().slice(0, 8)}`, domainId: d.id, name: '' },
                    ],
                  })
                }
              >
                <Plus size={15} />
                Add skill
              </button>
            </div>
          </details>
        ))}
      </div>
      <div className="review-actions spaced">
        <button
          className="secondary"
          onClick={() =>
            setDraft([
              ...draft,
              {
                id: `domain-${crypto.randomUUID().slice(0, 8)}`,
                section: 'rw',
                name: '',
                percentage: 0,
                questionRange: 'custom',
                skills: [],
              },
            ])
          }
        >
          <Plus size={16} />
          Add domain
        </button>
        <button className="secondary" onClick={() => location.reload()}>
          Refresh updated workspace
        </button>
      </div>
    </section>
  );
}
