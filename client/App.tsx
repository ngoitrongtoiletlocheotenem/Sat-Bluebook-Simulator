import { useEffect, useState } from 'react';
import { Link, NavLink, Route, Routes, useNavigate, useParams } from 'react-router-dom';
import {
  ArrowUpRight,
  BookOpen,
  ChartNoAxesCombined,
  Check,
  Compass,
  Files,
  Flag,
  GraduationCap,
  LayoutDashboard,
  LogOut,
  Menu,
  Settings,
  ShieldCheck,
  Sparkles,
  Target,
  X,
} from 'lucide-react';
import type { Domain, User } from '../shared/types';
import { api, json } from './api';
import { AppContext, ErrorBox, Loading } from './ui';
import { Dashboard, Practice, History, Errors, SettingsPage } from './Study';
import { QuestionBank, TestBuilder, UsersPage } from './Bank';
import Report from './Report';
import Statistics from './Statistics';
import Player from './Player';
function PlayerRoute() {
  const { id } = useParams();
  const navigate = useNavigate();
  return (
    <Player attemptId={id!} onExit={() => navigate('/')} onComplete={(id) => navigate(`/results/${id}`)} />
  );
}
function Auth({ onAuth }: { onAuth: () => Promise<void> }) {
  const [register, setRegister] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const submit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    const f = new FormData(e.currentTarget);
    try {
      await api(
        `/auth/${register ? 'register' : 'login'}`,
        json('POST', { email: f.get('email'), password: f.get('password'), name: f.get('name') }),
      );
      await onAuth();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <main className="auth-page">
      <section className="auth-story">
        <Link className="brand" to="/">
          <span className="brand-mark">
            <Compass size={26} />
          </span>
          pathwise<span className="brand-dot">.</span>
        </Link>
        <div className="auth-story-body">
          <span className="eyebrow">YOUR NEXT CHAPTER STARTS HERE</span>
          <h1>
            A little practice.
            <br />A clearer path.
            <br />
            <em>A bigger future.</em>
          </h1>
          <p>
            Your Digital SAT workspace for turning
            <br />
            “I don’t get it” into “I’ve got this.”
          </p>
          <div className="auth-orbits">
            <div />
            <div />
            <div />
            <span>
              <GraduationCap size={64} strokeWidth={1} />
            </span>
            <i className="orbit-dot one" />
            <i className="orbit-dot two" />
          </div>
        </div>
        <footer>Thoughtful practice. Measurable progress.</footer>
      </section>
      <section className="auth-form">
        <div className="auth-form-inner">
          <span className="tag green">
            <Sparkles size={13} /> DIGITAL SAT STUDIO
          </span>
          <h2>{register ? 'Make room for progress.' : 'Welcome back.'}</h2>
          <p>
            {register ? 'Create your account and take the first step.' : 'Pick up right where you left off.'}
          </p>
          {error && <ErrorBox message={error} />}
          <form onSubmit={submit}>
            {register && (
              <label>
                Your name
                <input name="name" autoComplete="name" required maxLength={100} placeholder="Alex Morgan" />
              </label>
            )}
            <label>
              Email address
              <input name="email" type="email" autoComplete="email" required placeholder="you@example.com" />
            </label>
            <label>
              Password
              <input
                name="password"
                type="password"
                autoComplete={register ? 'new-password' : 'current-password'}
                required
                minLength={register ? 10 : 1}
                maxLength={128}
                placeholder={register ? 'At least 10 characters' : 'Enter your password'}
              />
            </label>
            <button className="primary full" disabled={busy}>
              {busy ? 'Please wait…' : register ? 'Create account' : 'Sign in'}
              <ArrowUpRight size={18} />
            </button>
          </form>
          <p className="auth-switch">
            {register ? 'Already have an account?' : 'New to Pathwise?'}{' '}
            <button
              onClick={() => {
                setRegister(!register);
                setError('');
              }}
            >
              {register ? 'Sign in' : 'Create an account'}
            </button>
          </p>
          <div className="auth-note">
            <ShieldCheck size={20} />
            <span>
              Your progress stays private.
              <br />
              No official SAT affiliation. Scores are estimates.
            </span>
          </div>
        </div>
      </section>
    </main>
  );
}
export default function App() {
  const [user, setUser] = useState<User | null>(null),
    [domains, setDomains] = useState<Domain[]>([]),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(''),
    [notice, setNotice] = useState(''),
    [menu, setMenu] = useState(false);
  const navigate = useNavigate();
  const refreshUser = async () => {
    const me = await api<{ user: User | null; csrfToken: string }>('/me');
    setUser(me.user);
  };
  useEffect(() => {
    Promise.all([refreshUser(), api<Domain[]>('/taxonomy').then(setDomains)])
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);
  useEffect(() => {
    if (notice) {
      const t = setTimeout(() => setNotice(''), 4500);
      return () => clearTimeout(t);
    }
  }, [notice]);
  if (loading) return <Loading />;
  if (error)
    return (
      <main className="boot-error">
        <h1>Let’s get your workspace connected.</h1>
        <ErrorBox message={error} retry={() => location.reload()} />
      </main>
    );
  if (!user) return <Auth onAuth={refreshUser} />;
  const logout = async () => {
    await api('/auth/logout', json('POST'));
    setUser(null);
    navigate('/');
  };
  const nav = [
    { to: '/', icon: LayoutDashboard, label: 'Overview' },
    { to: '/practice', icon: Target, label: 'Practice studio' },
    { to: '/history', icon: ChartNoAxesCombined, label: 'Progress & history' },
    { to: '/errors', icon: Flag, label: 'Mistake journal' },
    { to: '/bank', icon: BookOpen, label: 'Question library' },
    { to: '/tests', icon: Files, label: 'Test builder' },
  ];
  return (
    <AppContext.Provider value={{ user, domains, refreshUser, toast: setNotice }}>
      <Routes>
        <Route path="/test/:id" element={<PlayerRoute />} />
        <Route
          path="*"
          element={
            <div className="app-shell">
              <aside className={`sidebar ${menu ? 'open' : ''}`}>
                <Link className="brand" to="/">
                  <span className="brand-mark">
                    <Compass size={25} />
                  </span>
                  pathwise<span className="brand-dot">.</span>
                </Link>
                <button
                  className="mobile-close icon-button"
                  onClick={() => setMenu(false)}
                  aria-label="Close navigation"
                >
                  <X />
                </button>
                <div className="workspace-label">YOUR STUDY WORKSPACE</div>
                <nav>
                  {nav.map((n) => (
                    <NavLink key={n.to} to={n.to} end={n.to === '/'} onClick={() => setMenu(false)}>
                      <n.icon size={19} />
                      {n.label}
                    </NavLink>
                  ))}
                  {user.role === 'admin' && (
                    <NavLink to="/users">
                      <ShieldCheck size={19} />
                      User management
                    </NavLink>
                  )}
                  {user.role !== 'student' && (
                    <NavLink to="/statistics">
                      <ChartNoAxesCombined size={19} />
                      Student statistics
                    </NavLink>
                  )}
                </nav>
                <div className="sidebar-note">
                  <span className="mini-icon">
                    <GraduationCap size={24} />
                  </span>
                  <h3>Small steps add up.</h3>
                  <p>Understanding one mistake is progress worth making.</p>
                  <Link to="/practice">
                    Find your next step <ArrowUpRight size={15} />
                  </Link>
                </div>
                <div className="sidebar-bottom">
                  <NavLink to="/settings">
                    <Settings size={18} />
                    Settings
                  </NavLink>
                  <button onClick={logout}>
                    <LogOut size={18} />
                    Sign out
                  </button>
                  <div className="user-mini">
                    <span>{user.name.slice(0, 1).toUpperCase()}</span>
                    <div>
                      <strong>{user.name}</strong>
                      <small>
                        {user.role === 'student' ? 'Student workspace' : `${user.role} workspace`}
                      </small>
                    </div>
                    <span className="online-dot" />
                  </div>
                </div>
              </aside>
              <div className="content-shell">
                <header className="topbar">
                  <button
                    className="mobile-menu icon-button"
                    onClick={() => setMenu(true)}
                    aria-label="Open navigation"
                  >
                    <Menu />
                  </button>
                  <span className="topbar-breadcrumb">
                    Your workspace <span>/</span> Digital SAT
                  </span>
                  <div>
                    <span className="workspace-status">
                      <i /> Learning at your pace
                    </span>
                    <Link className="avatar" to="/settings" aria-label="Account settings">
                      {user.name.slice(0, 1).toUpperCase()}
                    </Link>
                  </div>
                </header>
                <main className="page-content">
                  <Routes>
                    <Route path="/" element={<Dashboard />} />
                    <Route path="/practice" element={<Practice />} />
                    <Route path="/history" element={<History />} />
                    <Route path="/errors" element={<Errors />} />
                    <Route path="/bank" element={<QuestionBank />} />
                    <Route path="/tests" element={<TestBuilder />} />
                    <Route path="/users" element={<UsersPage />} />
                    <Route path="/settings" element={<SettingsPage />} />
                    <Route path="/statistics" element={<Statistics />} />
                    <Route path="/results/:id" element={<Report />} />
                    <Route path="*" element={<Dashboard />} />
                  </Routes>
                </main>
                <footer className="site-footer">
                  <span>PATHWISE · DIGITAL SAT STUDIO</span>
                  <span>Independent practice. Estimated scores.</span>
                </footer>
              </div>
            </div>
          }
        />
      </Routes>
      {notice && (
        <div className="toast" role="status">
          <Check size={18} />
          {notice}
          <button aria-label="Dismiss notification" onClick={() => setNotice('')}>
            <X size={16} />
          </button>
        </div>
      )}
    </AppContext.Provider>
  );
}
