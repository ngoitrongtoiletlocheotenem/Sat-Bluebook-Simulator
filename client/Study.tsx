import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import {
  ArrowRight,
  ArrowUpRight,
  BookOpen,
  Bookmark,
  CheckCircle2,
  ChevronRight,
  Clock3,
  Compass,
  Flag,
  Layers,
  Play,
  RotateCcw,
  Sparkles,
  Target,
  TrendingUp,
} from 'lucide-react';
import type {
  Attempt,
  AttemptInput,
  Dashboard as DashboardData,
  ErrorItem,
  HistoryItem,
  Mode,
  Performance,
  Question,
} from '../shared/types';
import { api, json } from './api';
import {
  date,
  Empty,
  ErrorBox,
  Go,
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
import RichText from './RichText';
import TaxonomySettings from './TaxonomySettings';
export function ScoreChart({ history }: { history: HistoryItem[] }) {
  const points = history.filter((h) => h.mode === 'full' && h.totalScore !== null).slice(-12);
  if (!points.length)
    return (
      <div className="chart-empty">
        <svg viewBox="0 0 500 130" aria-hidden="true">
          <path d="M0 30H500M0 75H500M0 120H500" stroke="#e8ece8" />
          <path
            d="M0 110C80 110 60 90 130 91S220 70 270 76 340 37 380 43 450 20 500 20"
            fill="none"
            stroke="#b6c7bf"
            strokeWidth="2"
            strokeDasharray="5 6"
          />
        </svg>
        <span>Your first full test starts the story.</span>
      </div>
    );
  const x = (i: number) => 30 + i * (510 / Math.max(1, points.length - 1));
  const y = (n: number) => 150 - ((n - 400) / 1200) * 130;
  return (
    <div className="score-chart">
      <svg
        viewBox="0 0 560 200"
        role="img"
        aria-label="SAT score history: total, Reading and Writing, and Math"
      >
        <defs>
          <linearGradient id="score-fill" x1="0" y1="0" x2="0" y2="1">
            <stop stopColor="#4b8177" stopOpacity=".15" />
            <stop offset="1" stopColor="#4b8177" stopOpacity="0" />
          </linearGradient>
        </defs>
        {[400, 800, 1200, 1600].map((n) => (
          <g key={n}>
            <text x="0" y={y(n) + 4} fontSize="10" fill="#78817e">
              {n}
            </text>
            <path d={`M30 ${y(n)}H550`} stroke="#edf0ed" />
          </g>
        ))}
        <path
          d={`M${x(0)} 150 ${points.map((p, i) => `L${x(i)} ${y(p.totalScore!)}`).join(' ')} L${x(points.length - 1)} 150Z`}
          fill="url(#score-fill)"
        />
        {(['totalScore', 'rwScore', 'mathScore'] as const).map((key, k) => (
          <g key={key}>
            <polyline
              points={points.map((p, i) => `${x(i)},${y(p[key] || 400)}`).join(' ')}
              fill="none"
              stroke={['#27675c', '#d49943', '#7181aa'][k]}
              strokeWidth={k === 0 ? 3 : 1.5}
            />
            {points.map((p, i) => (
              <circle
                key={i}
                cx={x(i)}
                cy={y(p[key] || 400)}
                r={k === 0 ? 4 : 2}
                fill={['#27675c', '#d49943', '#7181aa'][k]}
              >
                <title>
                  {date(p.completedAt)}: {p[key]}
                </title>
              </circle>
            ))}
          </g>
        ))}
        {points.map((p, i) => (
          <text key={i} x={x(i)} y="178" textAnchor="middle" fontSize="9" fill="#78817e">
            {new Date(p.completedAt).toLocaleDateString('en', { month: 'short', day: 'numeric' })}
          </text>
        ))}
      </svg>
      <div className="chart-legend">
        <span>
          <i className="green-dot" />
          Total
        </span>
        <span>
          <i className="gold-dot" />
          Reading & Writing
        </span>
        <span>
          <i className="blue-dot" />
          Math
        </span>
      </div>
    </div>
  );
}
function DomainRow({ p }: { p: Performance }) {
  return (
    <div className="domain-progress-row">
      <div>
        <span>{p.name}</span>
        <strong>{p.attempts ? percent(p.accuracy) : '—'}</strong>
      </div>
      <div className="progress-track">
        <i style={{ width: p.attempts ? percent(p.accuracy) : '0%' }} />
      </div>
      <small>{p.attempts ? `${p.correct} correct · ${p.attempts} responses` : 'Ready when you are'}</small>
    </div>
  );
}
export function Dashboard() {
  const { user, domains } = useApp();
  const navigate = useNavigate();
  const { data, error, loading, reload } = useLoad(() => api<DashboardData>('/dashboard'));
  const [busy, setBusy] = useState(false);
  const start = async () => {
    setBusy(true);
    try {
      const a = await api<Attempt>('/attempts', json('POST', { mode: 'full' }));
      navigate(`/test/${a.id}`);
    } catch (e) {
      alert((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  if (loading) return <Loading />;
  if (error) return <ErrorBox message={error} retry={reload} />;
  const d = data!,
    scores = d.history.filter((h) => h.mode === 'full' && h.totalScore !== null),
    latest = scores[scores.length - 1],
    previous = scores[scores.length - 2],
    delta = latest && previous ? latest.totalScore! - previous.totalScore! : null;
  return (
    <>
      <PageHeading
        eyebrow="MAKE TODAY COUNT"
        title={`Good to see you, ${user.name.split(' ')[0]}.`}
        description="A clearer picture of your progress. A thoughtful plan for what’s next."
      >
        <span className="date-pill">
          <Clock3 size={14} />
          {new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric', year: 'numeric' }).format(
            new Date(),
          )}
        </span>
      </PageHeading>
      <section className="dashboard-hero">
        <div>
          <Tag tone="green">
            <Sparkles size={13} /> YOUR PATH, YOUR PACE
          </Tag>
          <h2>
            Practice with purpose.
            <br />
            Walk in with confidence.
          </h2>
          <p>
            Get a complete picture of where you stand with
            <br className="desktop-only" /> a realistic, adaptive Digital SAT practice test.
          </p>
          <button className="primary" onClick={start} disabled={busy}>
            <Play size={16} fill="currentColor" />
            {busy ? 'Preparing your test…' : 'Take a full practice test'}
            <ArrowUpRight size={17} />
          </button>
          <div className="hero-meta">
            <span>98 questions</span>
            <i />
            <span>2 hr 14 min + break</span>
            <i />
            <span>Adaptive modules</span>
          </div>
        </div>
        <div className="hero-art" aria-hidden="true">
          <div className="hero-orbit outer" />
          <div className="hero-orbit middle" />
          <div className="hero-orbit inner" />
          <div className="hero-center">
            <span>ONE STEP</span>
            <Compass size={66} strokeWidth={1} />
            <span>CLOSER</span>
          </div>
          <span className="art-badge badge-a">
            <CheckCircle2 size={16} />
            Build understanding
          </span>
          <span className="art-badge badge-b">
            <TrendingUp size={16} />
            See your progress
          </span>
          <i className="art-spark">✦</i>
          <i className="art-point" />
        </div>
      </section>
      {d.activeAttempts.length > 0 && (
        <div className="resume-banner">
          <div>
            <Play size={19} />
            <span>
              <strong>Your work is right where you left it.</strong> {d.activeAttempts[0].title}
            </span>
          </div>
          <Link className="secondary small" to={`/test/${d.activeAttempts[0].id}`}>
            Resume test
            <ArrowRight size={16} />
          </Link>
        </div>
      )}
      <section className="metrics-grid">
        <Metric
          label="Latest estimated score"
          value={latest?.totalScore ?? '—'}
          detail={
            latest
              ? delta === null
                ? 'Your first full test'
                : `${delta >= 0 ? '+' : ''}${delta} from your previous test`
              : 'Take a full test to find your baseline'
          }
        />
        <Metric
          label="Questions practiced"
          value={d.stats.questionsAnswered.toLocaleString()}
          detail="Every question is a step forward"
        />
        <Metric
          label="Overall accuracy"
          value={d.stats.questionsAnswered ? percent(d.stats.accuracy) : '—'}
          detail="Across your completed practice"
        />
        <Metric
          label="Average question time"
          value={d.stats.questionsAnswered ? time(d.stats.averageMs) : '—'}
          detail="Find the pace that works for you"
        />
      </section>
      <div className="dashboard-grid">
        <section className="panel">
          <div className="panel-heading">
            <div>
              <span className="eyebrow">THE BIG PICTURE</span>
              <h2>Your score story</h2>
            </div>
            <Link to="/history">
              View progress
              <ArrowUpRight size={15} />
            </Link>
          </div>
          <ScoreChart history={d.history} />
        </section>
        <section className="panel next-step">
          <div className="panel-heading">
            <div>
              <span className="eyebrow">A LITTLE DIRECTION</span>
              <h2>Your next best step</h2>
            </div>
            <Target size={23} />
          </div>
          {d.recommendations.length ? (
            d.recommendations.slice(0, 2).map((r, i) => (
              <div className="recommendation" key={i}>
                <span className="recommendation-number">0{i + 1}</span>
                <div>
                  <h3>{r.title}</h3>
                  <p>{r.reason}</p>
                  <Link
                    to={`/practice?mode=${r.mode}&domain=${r.domainId || ''}&skill=${r.skillId || ''}&count=${r.count}`}
                  >
                    Let’s practice
                    <ArrowRight size={15} />
                  </Link>
                </div>
              </div>
            ))
          ) : (
            <div className="recommendation">
              <span className="recommendation-number">01</span>
              <div>
                <h3>Start with a baseline</h3>
                <p>A full test helps us find the skills that deserve your attention.</p>
                <button className="text-button" onClick={start}>
                  Find my starting point
                  <ArrowRight size={15} />
                </button>
              </div>
            </div>
          )}
        </section>
      </div>
      <section className="panel domain-panel">
        <div className="panel-heading">
          <div>
            <span className="eyebrow">BUILDING BLOCKS</span>
            <h2>Every skill has room to grow</h2>
          </div>
          <Link to="/practice">
            Explore practice
            <ArrowUpRight size={15} />
          </Link>
        </div>
        <div className="domain-grid">
          {domains.map((domain) => {
            const p = d.domainStats.find((p) => p.id === domain.id);
            return (
              <DomainRow
                key={domain.id}
                p={
                  p ?? {
                    id: domain.id,
                    name: domain.name,
                    section: domain.section,
                    attempts: 0,
                    correct: 0,
                    accuracy: 0,
                    averageMs: 0,
                    level: 0,
                  }
                }
              />
            );
          })}
        </div>
      </section>
      <div className="dashboard-grid lower">
        <section className="panel">
          <div className="panel-heading">
            <h2>Keep the learning going</h2>
            <BookOpen size={21} />
          </div>
          <Link to="/errors" className="quick-row">
            <span className="quick-icon peach">
              <Flag size={20} />
            </span>
            <div>
              <strong>Your mistake journal</strong>
              <p>
                {d.stats.errors
                  ? `${d.stats.errors} questions waiting for a fresh look.`
                  : 'Turn a wrong answer into your next breakthrough.'}
              </p>
            </div>
            <ChevronRight size={19} />
          </Link>
          <Link to="/bank?bookmarked=true" className="quick-row">
            <span className="quick-icon sage">
              <Bookmark size={20} />
            </span>
            <div>
              <strong>Your saved questions</strong>
              <p>{d.stats.bookmarks} bookmarks. A little library of things to revisit.</p>
            </div>
            <ChevronRight size={19} />
          </Link>
        </section>
        <section className="panel">
          <div className="panel-heading">
            <h2>Recent sessions</h2>
            <Link to="/history">
              See all
              <ArrowUpRight size={15} />
            </Link>
          </div>
          {d.history.length ? (
            d.history
              .slice(-3)
              .reverse()
              .map((h) => (
                <Link className="session-row" key={h.id} to={`/results/${h.id}`}>
                  <span className="quick-icon neutral">
                    <Layers size={18} />
                  </span>
                  <div>
                    <strong>{h.title}</strong>
                    <small>{date(h.completedAt)}</small>
                  </div>
                  <Tag>{percent(h.accuracy)}</Tag>
                  <ArrowUpRight size={17} />
                </Link>
              ))
          ) : (
            <div className="quiet-empty">
              A clean slate, full of possibility.
              <br />
              <span>Your completed sessions will appear here.</span>
            </div>
          )}
        </section>
      </div>
    </>
  );
}
export function Practice() {
  const { domains, toast } = useApp();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [mode, setMode] = useState<Mode>((params.get('mode') as Mode) || 'practice');
  const [section, setSection] = useState(''),
    [domain, setDomain] = useState(params.get('domain') || ''),
    [skill, setSkill] = useState(params.get('skill') || ''),
    [difficulty, setDifficulty] = useState(''),
    [count, setCount] = useState(Number(params.get('count')) || 10),
    [multiplier, setMultiplier] = useState('1'),
    [timing, setTiming] = useState('0'),
    [breakMinutes, setBreakMinutes] = useState('10'),
    [seed, setSeed] = useState(''),
    [excludeSeen, setExcludeSeen] = useState(false),
    [includeWrong, setIncludeWrong] = useState(false),
    [tags, setTags] = useState(''),
    [source, setSource] = useState(''),
    [customDistribution, setCustomDistribution] = useState(false),
    [distribution, setDistribution] = useState<Record<string, number>>({}),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const start = async () => {
    setBusy(true);
    setError('');
    try {
      const input: AttemptInput = {
        mode,
        ...(mode !== 'full' && mode !== 'module' ? { count } : {}),
        ...(mode === 'full' ? { breakSeconds: Number(breakMinutes) * 60 } : {}),
        timeMultiplier: Number(multiplier),
        excludeSeen,
        includeWrong,
        ...(tags
          ? {
              tags: tags
                .split(',')
                .map((t) => t.trim())
                .filter(Boolean),
            }
          : {}),
        ...(source ? { source } : {}),
        ...(customDistribution && section && mode !== 'full' && mode !== 'module'
          ? {
              domainDistribution: Object.fromEntries(
                domains
                  .filter((d) => d.section === section)
                  .map((d) => [d.id, distribution[d.id] ?? d.percentage])
                  .filter(([, weight]) => Number(weight) > 0),
              ) as Record<string, number>,
            }
          : {}),
        ...(section ? { section: section as 'rw' | 'math' } : {}),
        ...(domain ? { domainId: domain } : {}),
        ...(skill ? { skillId: skill } : {}),
        ...(difficulty ? { difficulty: difficulty as 'easy' | 'medium' | 'hard' } : {}),
        ...(seed ? { seed } : {}),
        ...(Number(timing) ? { timedSeconds: Number(timing) * 60 } : {}),
      };
      const a = await api<Attempt>('/attempts', json('POST', input));
      toast('Your practice is ready.');
      navigate(`/test/${a.id}`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const modes = [
    {
      id: 'tutor',
      icon: BookOpen,
      title: 'Tutor mode',
      desc: 'One question. Immediate feedback. A deeper understanding.',
    },
    {
      id: 'practice',
      icon: Target,
      title: 'Custom practice',
      desc: 'Your topics, your difficulty, your own pace.',
    },
    {
      id: 'module',
      icon: Clock3,
      title: 'Timed module',
      desc: 'Build your rhythm in one realistic SAT module.',
    },
    {
      id: 'full',
      icon: Layers,
      title: 'Full SAT simulation',
      desc: 'Four modules. Adaptive routes. The complete experience.',
    },
    {
      id: 'wrong',
      icon: RotateCcw,
      title: 'Review mistakes',
      desc: 'A fresh chance at the questions you missed.',
    },
    {
      id: 'weak',
      icon: TrendingUp,
      title: 'Strengthen weak skills',
      desc: 'Let your results point to the practice you need.',
    },
    {
      id: 'bookmarks',
      icon: Bookmark,
      title: 'Saved questions',
      desc: 'Pick up the questions you wanted to revisit.',
    },
  ];
  const current = modes.find((m) => m.id === mode) || modes[1];
  return (
    <>
      <PageHeading
        eyebrow="THE PRACTICE STUDIO"
        title="A session shaped around you."
        description="Choose your focus. Find your rhythm. Build a little more confidence."
      />
      <div className="practice-layout">
        <section className="practice-mode-grid">
          {modes.map((m) => (
            <button
              key={m.id}
              className={`mode-card ${mode === m.id ? 'selected' : ''}`}
              onClick={() => setMode(m.id as Mode)}
            >
              <span className="mode-icon">
                <m.icon size={24} />
              </span>
              <h3>{m.title}</h3>
              <p>{m.desc}</p>
              <span className="mode-select">
                {mode === m.id ? <CheckCircle2 size={19} /> : <ArrowUpRight size={19} />}
              </span>
            </button>
          ))}
        </section>
        <section className="panel practice-config">
          <span className="eyebrow">MAKE IT YOURS</span>
          <h2>{current.title}</h2>
          <p className="muted">{current.desc}</p>
          {error && <ErrorBox message={error} />}
          <div className="form-stack">
            {mode !== 'full' && (
              <>
                <label>
                  Section
                  <select
                    value={section}
                    onChange={(e) => {
                      setSection(e.target.value);
                      setDomain('');
                      setSkill('');
                    }}
                  >
                    <option value="">
                      {mode === 'module' ? 'Reading and Writing (default)' : 'Both sections'}
                    </option>
                    <option value="rw">Reading and Writing</option>
                    <option value="math">Math</option>
                  </select>
                </label>
                {mode !== 'module' && (
                  <>
                    <label>
                      Domain
                      <select
                        value={domain}
                        onChange={(e) => {
                          setDomain(e.target.value);
                          setSkill('');
                        }}
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
                    </label>
                    <label>
                      Skill
                      <select value={skill} onChange={(e) => setSkill(e.target.value)}>
                        <option value="">All skills</option>
                        {domains
                          .filter((d) => (!domain || d.id === domain) && (!section || d.section === section))
                          .flatMap((d) => d.skills)
                          .map((s) => (
                            <option key={s.id} value={s.id}>
                              {s.name}
                            </option>
                          ))}
                      </select>
                    </label>
                    <div className="form-row">
                      <label>
                        Difficulty
                        <select value={difficulty} onChange={(e) => setDifficulty(e.target.value)}>
                          <option value="">Balanced mix</option>
                          <option value="easy">Easy</option>
                          <option value="medium">Medium</option>
                          <option value="hard">Hard</option>
                        </select>
                      </label>
                      <label>
                        Questions
                        <input
                          type="number"
                          min="1"
                          max="100"
                          value={count}
                          onChange={(e) => setCount(Number(e.target.value))}
                        />
                      </label>
                    </div>
                    <label>
                      Time limit
                      <select value={timing} onChange={(e) => setTiming(e.target.value)}>
                        <option value="0">Untimed · pause anytime</option>
                        <option value="10">10 minutes</option>
                        <option value="20">20 minutes</option>
                        <option value="30">30 minutes</option>
                      </select>
                    </label>
                  </>
                )}
              </>
            )}
            <label>
              Practice time accommodation
              <select value={multiplier} onChange={(e) => setMultiplier(e.target.value)}>
                <option value="1">Standard time</option>
                <option value="1.5">1.5× time</option>
                <option value="2">2× time</option>
              </select>
            </label>
            {mode === 'full' && (
              <label>
                Between-section break
                <select value={breakMinutes} onChange={(e) => setBreakMinutes(e.target.value)}>
                  <option value="10">10 minutes · standard</option>
                  <option value="15">15 minutes · practice accommodation</option>
                  <option value="20">20 minutes · practice accommodation</option>
                  <option value="0">No break · custom practice setting</option>
                </select>
              </label>
            )}
            <details className="advanced-options">
              <summary>Advanced options</summary>
              <label>
                Random seed
                <input
                  value={seed}
                  onChange={(e) => setSeed(e.target.value)}
                  placeholder="Generated automatically"
                />
              </label>
              {mode !== 'full' && mode !== 'module' && (
                <label className="checkbox-row">
                  <input
                    type="checkbox"
                    checked={excludeSeen}
                    onChange={(e) => setExcludeSeen(e.target.checked)}
                  />
                  Exclude questions I’ve seen
                </label>
              )}
              {mode !== 'full' && mode !== 'module' && (
                <>
                  <label className="checkbox-row">
                    <input
                      type="checkbox"
                      checked={includeWrong}
                      onChange={(e) => setIncludeWrong(e.target.checked)}
                    />
                    Include only previously wrong questions
                  </label>
                  <label>
                    Tags (comma separated)
                    <input
                      value={tags}
                      onChange={(e) => setTags(e.target.value)}
                      placeholder="e.g. original, algebra"
                    />
                  </label>
                  <label>
                    Question source
                    <input
                      value={source}
                      onChange={(e) => setSource(e.target.value)}
                      placeholder="Any source"
                    />
                  </label>
                  <label className="checkbox-row">
                    <input
                      type="checkbox"
                      checked={customDistribution}
                      onChange={(e) => setCustomDistribution(e.target.checked)}
                      disabled={!section}
                    />
                    Set a domain distribution {section ? '' : '(choose a section first)'}
                  </label>
                  {customDistribution &&
                    section &&
                    domains
                      .filter((d) => d.section === section)
                      .map((d) => (
                        <label key={d.id}>
                          {d.name} · relative weight
                          <input
                            type="number"
                            min="0"
                            max="100"
                            value={distribution[d.id] ?? d.percentage}
                            onChange={(e) =>
                              setDistribution({ ...distribution, [d.id]: Number(e.target.value) })
                            }
                          />
                        </label>
                      ))}
                </>
              )}
            </details>
            {mode === 'full' && (
              <div className="info-note">
                <strong>Just like test day.</strong>
                <p>
                  54 Reading and Writing questions, 44 Math questions, a 10-minute break, and adaptive second
                  modules. No pause in standard simulation.
                </p>
              </div>
            )}
            <button className="primary full" onClick={start} disabled={busy}>
              {busy ? 'Preparing…' : 'Start session'}
              <ArrowRight size={18} />
            </button>
            <small className="fine-print">
              Time accommodations here are for practice only. Original demonstration questions; scores are
              estimates.
            </small>
          </div>
        </section>
      </div>
    </>
  );
}
export function History() {
  const [period, setPeriod] = useState('all');
  const { data, error, loading, reload } = useLoad(
    () => api<DashboardData>(`/dashboard${period === 'all' ? '' : `?days=${period}`}`),
    [period],
  );
  if (loading) return <Loading />;
  if (error) return <ErrorBox message={error} retry={reload} />;
  const history = data!.history.filter(
    (h) => period === 'all' || Date.now() - new Date(h.completedAt).getTime() <= Number(period) * 86400000,
  );
  return (
    <>
      <PageHeading
        eyebrow="PROGRESS, IN PERSPECTIVE"
        title="Look how far you’re going."
        description="A single score is a snapshot. Your story is in the progress."
      />
      <div className="segmented period-tabs">
        {['7', '30', '90', 'all'].map((p) => (
          <button key={p} onClick={() => setPeriod(p)} className={period === p ? 'active' : ''}>
            {p === 'all' ? 'All time' : `${p} days`}
          </button>
        ))}
      </div>
      <section className="panel">
        <div className="panel-heading">
          <h2>Estimated score history</h2>
          <Tag>FULL SAT SESSIONS</Tag>
        </div>
        <ScoreChart history={history} />
      </section>
      <section className="panel spaced">
        <div className="panel-heading">
          <h2>Your sessions</h2>
          <span className="muted">{history.length} completed</span>
        </div>
        {!history.length ? (
          <Empty
            title="Your story is just beginning."
            description="Finish a practice session and your results will be saved here."
          >
            <Link className="primary" to="/practice">
              <Go>Start practicing</Go>
            </Link>
          </Empty>
        ) : (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Session</th>
                  <th>Date</th>
                  <th>Estimated score</th>
                  <th>RW / Math</th>
                  <th>Accuracy</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {[...history].reverse().map((h) => (
                  <tr key={h.id}>
                    <td>
                      <strong>{h.title}</strong>
                      <small className="table-detail">{h.mode}</small>
                    </td>
                    <td>{date(h.completedAt)}</td>
                    <td>{h.totalScore ?? '—'}</td>
                    <td>
                      {h.rwScore ?? '—'} / {h.mathScore ?? '—'}
                    </td>
                    <td>{percent(h.accuracy)}</td>
                    <td>
                      <Link className="text-button" to={`/results/${h.id}`}>
                        View report
                        <ArrowUpRight size={15} />
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      <section className="panel spaced">
        <div className="panel-heading">
          <h2>Domain and skill performance</h2>
          <span className="muted">{period === 'all' ? 'All completed sessions' : `Last ${period} days`}</span>
        </div>
        <div className="domain-grid">
          {data!.domainStats.map((p) => (
            <DomainRow key={p.id} p={p} />
          ))}
        </div>
        <div className="domain-trend-grid">
          {data!.domainStats.map((p) => {
            const points = (data!.domainHistory || [])
              .filter((h) => h.domains.some((d) => d.id === p.id && d.attempts))
              .map((h) => ({ date: h.completedAt, p: h.domains.find((d) => d.id === p.id)! }));
            return (
              <div className="domain-trend" key={p.id}>
                <strong>{p.name}</strong>
                <svg viewBox="0 0 240 90" role="img" aria-label={`${p.name} accuracy over time`}>
                  <path d="M12 15H228M12 45H228M12 75H228" stroke="#e1e8da" strokeDasharray="3 4" />
                  {points.length > 0 && (
                    <>
                      <polyline
                        points={points
                          .map(
                            (v, i) =>
                              `${12 + (i * 216) / Math.max(1, points.length - 1)},${75 - v.p.accuracy * 60}`,
                          )
                          .join(' ')}
                        fill="none"
                        stroke="#62814b"
                        strokeWidth="2"
                      />
                      {points.map((v, i) => (
                        <circle
                          key={i}
                          cx={12 + (i * 216) / Math.max(1, points.length - 1)}
                          cy={75 - v.p.accuracy * 60}
                          r="3"
                          fill="#62814b"
                        >
                          <title>
                            {date(v.date)}: {percent(v.p.accuracy)}
                          </title>
                        </circle>
                      ))}
                    </>
                  )}
                </svg>
                <small>
                  {points.length
                    ? `${points.length} sessions · average ${time(p.averageMs)} / question`
                    : 'Your trend starts with your first response'}
                </small>
              </div>
            );
          })}
        </div>
        <div className="table-scroll spaced">
          <table>
            <thead>
              <tr>
                <th>Skill</th>
                <th>Responses</th>
                <th>Accuracy</th>
                <th>Average time</th>
                <th>Mastery estimate</th>
                <th>Recent accuracy</th>
                <th>Change</th>
              </tr>
            </thead>
            <tbody>
              {data!.skillStats.map((p) => (
                <tr key={p.id}>
                  <td>{p.name}</td>
                  <td>{p.attempts}</td>
                  <td>{percent(p.accuracy)}</td>
                  <td>{time(p.averageMs)}</td>
                  <td>{p.level} / 7</td>
                  <td>{p.attempts ? percent(p.recentAccuracy || 0) : '—'}</td>
                  <td>
                    {p.attempts
                      ? `${(p.trend || 0) >= 0 ? '+' : ''}${Math.round((p.trend || 0) * 100)} pp`
                      : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
export function QuestionReview({
  question,
  answer,
  elapsedMs,
  onRetry,
  showActions = true,
}: {
  question: Question;
  answer?: string;
  elapsedMs?: number;
  onRetry?: () => void;
  showActions?: boolean;
}) {
  const { domains, toast } = useApp();
  const [saved, setSaved] = useState(Boolean(question.bookmarked));
  const domain = domains.find((d) => d.id === question.domainId),
    skill = domain?.skills.find((s) => s.id === question.skillId);
  const bookmark = async () => {
    try {
      const r = await api<{ bookmarked: boolean }>(`/bookmarks/${question.id}`, json('POST'));
      setSaved(r.bookmarked);
      toast(r.bookmarked ? 'Question saved.' : 'Bookmark removed.');
    } catch (e) {
      toast((e as Error).message);
    }
  };
  return (
    <article className="question-review">
      <div className="review-meta">
        <Tag>{domain?.name || question.domainId}</Tag>
        <Tag>{skill?.name || question.skillId}</Tag>
        <Tag>{question.difficulty}</Tag>
        {elapsedMs !== undefined && (
          <Tag>
            <Clock3 size={13} />
            {time(elapsedMs)}
          </Tag>
        )}
      </div>
      {question.passage && (
        <div className="review-passage">
          <RichText content={question.passage} />
        </div>
      )}
      <div className="review-stem">
        <RichText content={question.stem} />
      </div>
      {question.images?.map((src) => (
        <img key={src} src={src} alt="Question illustration" className="review-image" />
      ))}
      {question.type === 'mcq' && question.choices.length > 0 ? (
        <div className="review-choices">
          {question.choices.map((c) => (
            <div
              key={c.id}
              className={`${c.id === question.correctAnswer ? 'correct' : ''} ${c.id === answer && c.id !== question.correctAnswer ? 'incorrect' : ''}`}
            >
              <strong>{c.id}</strong>
              <div>
                <RichText content={c.text} />
                {c.rationale && (
                  <small>
                    <RichText content={c.rationale} />
                  </small>
                )}
              </div>
              {c.id === question.correctAnswer && <CheckCircle2 size={18} />}
            </div>
          ))}
        </div>
      ) : (
        <div className="info-note">
          Accepted answers: {question.acceptedAnswers?.join(', ') || question.correctAnswer}
        </div>
      )}
      {answer !== undefined && (
        <p className="answer-summary">
          Your answer: <strong>{answer || 'Unanswered'}</strong> · Correct:{' '}
          <strong>{question.correctAnswer || question.acceptedAnswers?.join(', ')}</strong>
        </p>
      )}
      <div className="explanation">
        <h3>The reasoning</h3>
        <RichText content={question.explanation || 'No explanation was provided for this question.'} />
        {question.strategy && (
          <p>
            <strong>Strategy:</strong> {question.strategy}
          </p>
        )}
      </div>
      {showActions && (
        <div className="review-actions">
          <button className="secondary" onClick={bookmark} aria-pressed={saved}>
            <Bookmark size={16} />
            {saved ? 'Question saved' : 'Save question'}
          </button>
          {onRetry && (
            <button className="primary" onClick={onRetry}>
              <RotateCcw size={16} />
              Retry question
            </button>
          )}
        </div>
      )}
    </article>
  );
}
export function Errors() {
  const { domains, toast } = useApp();
  const navigate = useNavigate();
  const [section, setSection] = useState(''),
    [domain, setDomain] = useState(''),
    [skill, setSkill] = useState(''),
    [difficulty, setDifficulty] = useState(''),
    [days, setDays] = useState('all'),
    [page, setPage] = useState(1),
    [status, setStatus] = useState('open'),
    [selected, setSelected] = useState<ErrorItem | null>(null);
  const query = new URLSearchParams({
    section,
    domainId: domain,
    skillId: skill,
    difficulty,
    page: String(page),
    status: status === 'never' ? 'never-retried' : status === 'still' ? 'still-wrong' : status,
    ...(days === 'all' ? {} : { days }),
  });
  const { data, error, loading, reload } = useLoad(
    () => api<{ items: ErrorItem[]; total: number }>(`/errors?${query}`),
    [section, domain, skill, difficulty, days, status, page],
  );
  const change = (f: () => void) => {
    f();
    setPage(1);
  };
  const retry = async (qid?: string) => {
    try {
      const a = await api<Attempt>(
        '/attempts',
        json('POST', { mode: qid ? 'practice' : 'wrong', questionIds: qid ? [qid] : undefined, count: 10 }),
      );
      navigate(`/test/${a.id}`);
    } catch (e) {
      toast((e as Error).message);
    }
  };
  const update = async (e: ErrorItem, change: Record<string, unknown>) => {
    try {
      await api(`/errors/${e.id}`, json('PUT', change));
      toast('Journal updated.');
      await reload();
      if (selected?.id === e.id) setSelected({ ...e, ...change });
    } catch (e) {
      toast((e as Error).message);
    }
  };
  if (loading) return <Loading />;
  if (error) return <ErrorBox message={error} retry={reload} />;
  const items = data!.items;
  return (
    <>
      <PageHeading
        eyebrow="EVERY MISTAKE IS INFORMATION"
        title="Let’s turn it into understanding."
        description="Revisit the questions that challenged you. Write down the why. Try again."
      >
        <button className="primary" onClick={() => retry()} disabled={!items.length}>
          <RotateCcw size={16} />
          Practice my mistakes
        </button>
      </PageHeading>
      <div className="filter-bar">
        <select
          aria-label="Filter mistakes by section"
          value={section}
          onChange={(e) => {
            change(() => {
              setSection(e.target.value);
              setDomain('');
              setSkill('');
            });
          }}
        >
          <option value="">Both sections</option>
          <option value="rw">Reading and Writing</option>
          <option value="math">Math</option>
        </select>
        <select
          aria-label="Filter mistakes by domain"
          value={domain}
          onChange={(e) =>
            change(() => {
              setDomain(e.target.value);
              setSkill('');
            })
          }
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
          aria-label="Review status"
          value={status}
          onChange={(e) => change(() => setStatus(e.target.value))}
        >
          <option value="open">Needs review</option>
          <option value="never">Never retried</option>
          <option value="still">Still wrong after retry</option>
          <option value="mastered">Mastered</option>
          <option value="all">All questions</option>
        </select>
        <select
          aria-label="Mistake skill"
          value={skill}
          onChange={(e) => change(() => setSkill(e.target.value))}
        >
          <option value="">All skills</option>
          {domains
            .filter((d) => (!section || d.section === section) && (!domain || d.id === domain))
            .flatMap((d) => d.skills)
            .map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
        </select>
        <select
          aria-label="Mistake difficulty"
          value={difficulty}
          onChange={(e) => change(() => setDifficulty(e.target.value))}
        >
          <option value="">Any difficulty</option>
          <option value="easy">Easy</option>
          <option value="medium">Medium</option>
          <option value="hard">Hard</option>
        </select>
        <select
          aria-label="Mistake date range"
          value={days}
          onChange={(e) => change(() => setDays(e.target.value))}
        >
          <option value="all">All time</option>
          <option value="7">Last 7 days</option>
          <option value="30">Last 30 days</option>
          <option value="90">Last 90 days</option>
        </select>
        <span>{data!.total} questions</span>
      </div>
      <section className="panel">
        {!items.length ? (
          <Empty
            title="A fresh page in your journal."
            description="Questions you miss will appear here automatically, with explanations and a chance to retry."
          >
            <Link className="secondary" to="/practice">
              Find a practice session
              <ArrowRight size={16} />
            </Link>
          </Empty>
        ) : (
          <div className="error-list">
            {items.map((e) => (
              <div className="error-row" key={e.id}>
                <span className={`quick-icon ${e.mastered ? 'sage' : 'peach'}`}>
                  {e.mastered ? <CheckCircle2 size={21} /> : <Flag size={21} />}
                </span>
                <div>
                  <button className="question-link" onClick={() => setSelected(e)}>
                    {e.question.publicId} · {domains.find((d) => d.id === e.question.domainId)?.name}
                  </button>
                  <p>{e.question.stem.replace(/<[^>]*>/g, '').slice(0, 120)}</p>
                  <small>
                    {date(e.createdAt)} · {e.retryCount} retries · {time(e.elapsedMs)}
                    {e.reason ? ` · ${e.reason}` : ''}
                  </small>
                </div>
                <Tag tone={e.mastered ? 'green' : 'neutral'}>
                  {e.mastered ? 'Mastered' : e.lastCorrect ? 'Correct on retry' : 'Needs review'}
                </Tag>
                <button className="secondary small" onClick={() => retry(e.question.id)}>
                  Retry
                  <RotateCcw size={14} />
                </button>
              </div>
            ))}
          </div>
        )}
      </section>
      {selected && (
        <Modal title="A closer look at your mistake" wide onClose={() => setSelected(null)}>
          <QuestionReview
            question={selected.question}
            answer={selected.answer}
            elapsedMs={selected.elapsedMs}
            onRetry={() => retry(selected.question.id)}
          />
          <div className="journal-controls">
            <label>
              What got in the way?
              <select
                value={selected.reason || ''}
                onChange={(e) => update(selected, { reason: e.target.value || null })}
              >
                <option value="">Choose a reason</option>
                {[
                  'Concept gap',
                  'Misread question',
                  'Calculation error',
                  'Grammar rule',
                  'Vocabulary',
                  'Time pressure',
                  'Careless mistake',
                  'Guessed',
                  'Other',
                ].map((r) => (
                  <option key={r}>{r}</option>
                ))}
              </select>
            </label>
            <button className="secondary" onClick={() => update(selected, { mastered: !selected.mastered })}>
              <CheckCircle2 size={16} />
              {selected.mastered ? 'Reopen for review' : 'Mark mastered'}
            </button>
          </div>
        </Modal>
      )}
      {data!.total > 100 && (
        <div className="pagination">
          <span>
            Page {page} of {Math.ceil(data!.total / 100)}
          </span>
          <div>
            <button className="secondary small" disabled={page === 1} onClick={() => setPage(page - 1)}>
              Previous
            </button>
            <button
              className="secondary small"
              disabled={page * 100 >= data!.total}
              onClick={() => setPage(page + 1)}
            >
              Next
            </button>
          </div>
        </div>
      )}
    </>
  );
}
export function SettingsPage() {
  const { user, refreshUser, toast } = useApp();
  const [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  const save = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setBusy(true);
    const f = new FormData(e.currentTarget);
    try {
      await api('/profile', json('PUT', { name: f.get('name'), targetScore: Number(f.get('targetScore')) }));
      await refreshUser();
      toast('Your profile is updated.');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <PageHeading
        eyebrow="YOUR WORKSPACE"
        title="Make yourself at home."
        description="A few personal details to keep your study journey yours."
      />
      <section className="panel settings-panel">
        <h2>Your profile</h2>
        {error && <ErrorBox message={error} />}
        <form className="form-stack" onSubmit={save}>
          <label>
            Name
            <input name="name" defaultValue={user.name} required maxLength={100} />
          </label>
          <label>
            Email
            <input value={user.email} readOnly />
          </label>
          <label>
            Target SAT score
            <input
              name="targetScore"
              type="number"
              min="400"
              max="1600"
              step="10"
              defaultValue={user.targetScore || 1400}
            />
          </label>
          <button className="primary" disabled={busy}>
            Save profile
            <CheckCircle2 size={17} />
          </button>
        </form>
        <div className="info-note">
          <strong>Independent, thoughtful practice.</strong>
          <p>
            Pathwise is not affiliated with College Board. Scores and mastery levels are internal estimates.
            Your account has the {user.role} role.
          </p>
        </div>
      </section>
      {user.role === 'admin' && <TaxonomySettings />}
    </>
  );
}
