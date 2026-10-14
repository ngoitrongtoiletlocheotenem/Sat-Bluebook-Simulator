import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  ArrowRight,
  ArrowUpRight,
  Bookmark,
  CheckCircle2,
  Clock3,
  Download,
  Flag,
  Printer,
} from 'lucide-react';
import type { Attempt, Result, ReviewItem } from '../shared/types';
import { api, json } from './api';
import {
  date,
  Empty,
  ErrorBox,
  Loading,
  Metric,
  Modal,
  PageHeading,
  percent,
  Tag,
  time,
  useApp,
  useLoad,
} from './ui';
import { QuestionReview } from './Study';
export default function Report() {
  const { id } = useParams();
  const { domains, toast } = useApp();
  const navigate = useNavigate();
  const { data, error, loading, reload } = useLoad(() => api<Result>(`/attempts/${id}/result`), [id]);
  const [tab, setTab] = useState('all'),
    [selected, setSelected] = useState<ReviewItem | null>(null);
  if (loading) return <Loading />;
  if (error) return <ErrorBox message={error} retry={reload} />;
  const r = data!,
    items = r.review
      .filter(
        (q) =>
          tab === 'all' ||
          (tab === 'wrong'
            ? !q.correct
            : tab === 'marked'
              ? q.response.marked
              : tab === 'slow'
                ? q.response.elapsedMs > 90000
                : tab === 'rapid'
                  ? q.response.elapsedMs > 0 && q.response.elapsedMs < 3000 && Boolean(q.response.answer)
                  : !q.response.answer),
      )
      .sort((a, b) => (tab === 'slow' ? b.response.elapsedMs - a.response.elapsedMs : 0));
  const retry = async (qid: string) => {
    try {
      const a = await api<Attempt>(
        '/attempts',
        json('POST', { mode: 'practice', questionIds: [qid], count: 1 }),
      );
      navigate(`/test/${a.id}`);
    } catch (e) {
      toast((e as Error).message);
    }
  };
  return (
    <>
      <div className="no-print">
        <PageHeading
          eyebrow="A MOMENT TO REFLECT"
          title="You showed up. Here’s what you learned."
          description="Understand your results, find your focus, and keep moving forward."
        >
          <button className="secondary" onClick={() => window.print()}>
            <Printer size={16} />
            Print report
          </button>
          <button className="primary" onClick={() => window.print()}>
            <Download size={16} />
            Save as PDF
          </button>
        </PageHeading>
      </div>
      <article className="score-report">
        <div className="report-brand">
          <strong>pathwise.</strong>
          <span>DIGITAL SAT · PRACTICE SCORE REPORT</span>
        </div>
        <div className="report-metadata">
          <span>{r.student}</span>
          <span>{r.title}</span>
          <span>{date(r.completedAt)}</span>
        </div>
        <div className="report-score">
          <div>
            <span>{r.mode === 'full' ? r.scoreLabel : 'Practice performance'}</span>
            <div className="total-score-line">
              <h2>{r.mode === 'full' ? 'Total Score' : 'Accuracy'}</h2>
              <i />
              <strong>{r.totalScore !== null ? r.totalScore : percent(r.accuracy)}</strong>
              {r.scoreRange && (
                <span className="score-range">
                  Range {r.scoreRange[0]}–{r.scoreRange[1]}
                </span>
              )}
            </div>
          </div>
          <div className="section-scores">
            {r.rwScore !== null && (
              <div>
                <span>Reading and Writing</span>
                <strong>{r.rwScore}</strong>
                <small>200–800</small>
              </div>
            )}
            {r.mathScore !== null && (
              <div>
                <span>Math</span>
                <strong>{r.mathScore}</strong>
                <small>200–800</small>
              </div>
            )}
          </div>
        </div>
        <div className="report-heading">
          <h2>Knowledge and Skills</h2>
          <p>View your performance across areas measured on the SAT</p>
        </div>
        <div className="knowledge-columns">
          {(['rw', 'math'] as const).map((section) => (
            <section key={section}>
              <h3>{section === 'rw' ? 'Reading and Writing' : 'Math'}</h3>
              {domains
                .filter((d) => d.section === section)
                .map((domain) => {
                  const p = r.domains.find((p) => p.id === domain.id),
                    level = p?.attempts ? p.level : 0;
                  return (
                    <div key={domain.id} className="knowledge-domain">
                      <h4>{domain.name}</h4>
                      <p>
                        {domain.percentage}% of section · approximately {domain.questionRange} questions
                      </p>
                      <div
                        className="seven-bands"
                        role="img"
                        aria-label={`${domain.name}: ${p?.attempts ? `estimated level ${level} of 7` : 'no responses'}`}
                      >
                        {Array.from({ length: 7 }, (_, i) => (
                          <span key={i} className={i < level ? 'filled' : ''} />
                        ))}
                      </div>
                      <small>
                        {p?.attempts
                          ? `${p.correct} / ${p.attempts} correct · ${percent(p.accuracy)} accuracy`
                          : 'No questions assessed in this session'}
                      </small>
                    </div>
                  );
                })}
            </section>
          ))}
        </div>
        <div className="report-disclaimer">
          <strong>Independent practice estimates.</strong> Scores and seven-segment levels use an internal
          model and are not official College Board results. {r.scoreModelVersion} · No official percentiles or
          calibration claimed.
        </div>
      </article>
      <div className="no-print">
        <section className="metrics-grid spaced">
          <Metric
            label="Accuracy"
            value={percent(r.accuracy)}
            detail={`${r.correct} correct of ${r.total} questions`}
          />
          <Metric
            label="Time on questions"
            value={time(r.elapsedMs)}
            detail={`${time(r.averageMs)} average per question`}
          />
          <Metric label="Unanswered" value={r.unanswered} detail="A useful clue for your pacing" />
          <Metric label="Marked for review" value={r.marked} detail="Questions worth another look" />
        </section>
        <div className="result-route">
          <span>
            <CheckCircle2 size={17} />
            Adaptive routes
          </span>
          {Object.entries(r.routes).length ? (
            Object.entries(r.routes).map(([section, route]) => (
              <Tag key={section}>
                {section === 'rw' ? 'Reading and Writing' : 'Math'}: {route}
              </Tag>
            ))
          ) : (
            <span>Single-session practice</span>
          )}
          {r.previousDelta !== null && r.previousDelta !== undefined && (
            <Tag tone="green">
              {r.previousDelta >= 0 ? '+' : ''}
              {r.previousDelta} from previous full test
            </Tag>
          )}
        </div>
        <section className="panel spaced">
          <div className="panel-heading">
            <div>
              <span className="eyebrow">UNDERSTAND THE WHY</span>
              <h2>Your question review</h2>
            </div>
            <Link to="/errors">
              Open mistake journal
              <ArrowUpRight size={15} />
            </Link>
          </div>
          <div className="segmented">
            {[
              ['all', 'All questions'],
              ['wrong', 'Incorrect'],
              ['unanswered', 'Unanswered'],
              ['marked', 'Marked'],
              ['slow', 'Slowest (90s+)'],
              ['rapid', 'Rapid answers (<3s)'],
            ].map(([key, label]) => (
              <button key={key} className={tab === key ? 'active' : ''} onClick={() => setTab(key)}>
                {label}
              </button>
            ))}
          </div>
          {!items.length ? (
            <Empty
              title="Nothing in this view."
              description="Choose another filter to explore your responses."
            />
          ) : (
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Question</th>
                    <th>Domain / skill</th>
                    <th>Your answer</th>
                    <th>Outcome</th>
                    <th>Time</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {items.map((q) => {
                    const d = domains.find((d) => d.id === q.question.domainId);
                    return (
                      <tr key={`${q.moduleId}-${q.question.id}`}>
                        <td>
                          <button className="question-link" onClick={() => setSelected(q)}>
                            Question {r.review.indexOf(q) + 1}
                          </button>
                          <small className="table-detail">{q.question.publicId}</small>
                        </td>
                        <td>
                          {d?.name}
                          <small className="table-detail">
                            {d?.skills.find((s) => s.id === q.question.skillId)?.name} ·{' '}
                            {q.question.difficulty}
                          </small>
                        </td>
                        <td>
                          {q.response.answer || '—'}
                          {q.response.marked && <Flag className="inline-icon" size={13} />}
                        </td>
                        <td>
                          <Tag tone={q.correct ? 'green' : 'peach'}>
                            {q.correct ? 'Correct' : q.response.answer ? 'Incorrect' : 'Unanswered'}
                          </Tag>
                        </td>
                        <td>{time(q.response.elapsedMs)}</td>
                        <td>
                          <button className="text-button" onClick={() => setSelected(q)}>
                            Review
                            <ArrowRight size={15} />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
        <section className="panel spaced">
          <div className="panel-heading">
            <h2>Skill and difficulty detail</h2>
            <Clock3 size={19} />
          </div>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Skill / difficulty</th>
                  <th>Responses</th>
                  <th>Accuracy</th>
                  <th>Average time</th>
                </tr>
              </thead>
              <tbody>
                {[...r.skills, ...r.difficulties].map((p, i) => (
                  <tr key={`${p.id}-${i}`}>
                    <td>{p.name}</td>
                    <td>{p.attempts}</td>
                    <td>{percent(p.accuracy)}</td>
                    <td>{time(p.averageMs)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
        <div className="report-next">
          <div>
            <span className="eyebrow">THE NEXT CHAPTER</span>
            <h2>A result is a starting point.</h2>
            <p>Take what you learned into your next practice session.</p>
          </div>
          <Link className="primary" to="/practice">
            Build on this
            <ArrowRight size={18} />
          </Link>
        </div>
      </div>
      {selected && (
        <Modal title="Question review" wide onClose={() => setSelected(null)}>
          <QuestionReview
            question={selected.question}
            answer={selected.response.answer}
            elapsedMs={selected.response.elapsedMs}
            onRetry={() => retry(selected.question.id)}
          />
          {selected.response.note && (
            <div className="info-note">
              <Bookmark size={15} />
              <strong>Your note</strong>
              <p>{selected.response.note}</p>
            </div>
          )}
        </Modal>
      )}
    </>
  );
}
