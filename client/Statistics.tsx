import { api } from './api';
import { date, Empty, ErrorBox, Loading, Metric, PageHeading, percent, Tag, useApp, useLoad } from './ui';
type StatisticsData = {
  summary: {
    students: number;
    attempts: number;
    completedAttempts: number;
    sharedQuestions: number;
    questionsAnswered: number;
    accuracy: number | null;
  };
  students: {
    id: string;
    name: string;
    email: string;
    attempts: number;
    fullAttempts: number;
    practiceAttempts: number;
    completedAttempts: number;
    accuracy: number | null;
    questionsAnswered: number;
    latestScore: number | null;
    lastActivity: string | null;
  }[];
  questions: {
    id: string;
    publicId: string;
    section: string;
    domainId: string;
    skillId: string;
    difficulty: string;
    usageCount: number;
    graded: number;
    correct: number;
    accuracy: number | null;
  }[];
};
export default function Statistics() {
  const { user, domains } = useApp();
  const { data, error, loading, reload } = useLoad(() =>
    user.role === 'student' ? Promise.resolve(null) : api<StatisticsData>('/statistics'),
  );
  if (user.role === 'student')
    return (
      <Empty
        title="Teacher and administrator workspace"
        description="Statistics for other students require an authorized role."
      />
    );
  if (loading) return <Loading />;
  if (error) return <ErrorBox message={error} retry={reload} />;
  const d = data!;
  return (
    <>
      <PageHeading
        eyebrow="TEACHER & ADMINISTRATOR INSIGHTS"
        title="See the learning take shape."
        description="Real participation, student results, and shared question performance."
      />
      <section className="metrics-grid">
        <Metric label="Students" value={d.summary.students} detail="Registered student accounts" />
        <Metric
          label="Completed sessions"
          value={d.summary.completedAttempts}
          detail={`${d.summary.attempts} sessions started`}
        />
        <Metric
          label="Shared questions"
          value={d.summary.sharedQuestions}
          detail="Private student content stays private"
        />
        <Metric
          label="Response accuracy"
          value={d.summary.accuracy === null ? '—' : percent(d.summary.accuracy)}
          detail={`${d.summary.questionsAnswered} graded responses`}
        />
      </section>
      <section className="panel">
        <div className="panel-heading">
          <h2>Student progress</h2>
          <Tag>ACTUAL RESULTS</Tag>
        </div>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Student</th>
                <th>Completed</th>
                <th>Full / practice started</th>
                <th>Responses</th>
                <th>Accuracy</th>
                <th>Latest estimated score</th>
                <th>Last active</th>
              </tr>
            </thead>
            <tbody>
              {d.students.map((s) => (
                <tr key={s.id}>
                  <td>
                    <strong>{s.name}</strong>
                    <small className="table-detail">{s.email}</small>
                  </td>
                  <td>{s.completedAttempts}</td>
                  <td>
                    {s.fullAttempts} / {s.practiceAttempts}
                  </td>
                  <td>{s.questionsAnswered}</td>
                  <td>{s.accuracy === null ? '—' : percent(s.accuracy)}</td>
                  <td>{s.latestScore ?? '—'}</td>
                  <td>{s.lastActivity ? date(s.lastActivity) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <section className="panel spaced">
        <div className="panel-heading">
          <h2>Shared question statistics</h2>
          <span className="muted">Up to 1,000 questions</span>
        </div>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Identifier</th>
                <th>Domain</th>
                <th>Difficulty</th>
                <th>Usage</th>
                <th>Graded</th>
                <th>Correct</th>
                <th>Accuracy</th>
              </tr>
            </thead>
            <tbody>
              {d.questions.map((q) => (
                <tr key={q.id}>
                  <td>{q.publicId}</td>
                  <td>{domains.find((d) => d.id === q.domainId)?.name || q.domainId}</td>
                  <td>
                    <Tag>{q.difficulty}</Tag>
                  </td>
                  <td>{q.usageCount}</td>
                  <td>{q.graded}</td>
                  <td>{q.correct}</td>
                  <td>{q.accuracy === null ? '—' : percent(q.accuracy)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
