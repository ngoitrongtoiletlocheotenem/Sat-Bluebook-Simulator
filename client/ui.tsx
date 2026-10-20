import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { X, LoaderCircle, ArrowRight, Compass, AlertCircle } from 'lucide-react';
import type { Domain, User } from '../shared/types';
export const AppContext = createContext<{
  user: User;
  domains: Domain[];
  refreshUser: () => Promise<void>;
  toast: (s: string) => void;
}>({ user: null!, domains: [], refreshUser: async () => {}, toast: () => {} });
export const useApp = () => useContext(AppContext);
export function useLoad<T>(loader: () => Promise<T>, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null),
    [error, setError] = useState(''),
    [loading, setLoading] = useState(true);
  const latest = useRef(loader);
  latest.current = loader;
  const serial = useRef(0);
  const reload = async () => {
    const id = ++serial.current;
    setLoading(true);
    setError('');
    try {
      const value = await latest.current();
      if (id === serial.current) setData(value);
    } catch (e) {
      if (id === serial.current) setError(e instanceof Error ? e.message : 'Could not load data.');
    } finally {
      if (id === serial.current) setLoading(false);
    }
  };
  useEffect(() => {
    void reload();
    return () => {
      serial.current++;
    };
  }, deps);
  return { data, error, loading, reload, setData };
}
export function Loading() {
  return (
    <div className="loading">
      <LoaderCircle className="spin" size={24} /> Loading your workspace…
    </div>
  );
}
export function ErrorBox({ message, retry }: { message: string; retry?: () => void }) {
  return (
    <div className="error-box" role="alert">
      <AlertCircle size={20} />
      <span>{message}</span>
      {retry && <button onClick={retry}>Try again</button>}
    </div>
  );
}
export function Empty({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children?: ReactNode;
}) {
  return (
    <div className="empty">
      <div className="empty-icon">
        <Compass size={30} />
      </div>
      <h3>{title}</h3>
      <p>{description}</p>
      {children}
    </div>
  );
}
export function Modal({
  title,
  onClose,
  children,
  wide = false,
  closeDisabled = false,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
  closeDisabled?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const d = ref.current;
    d?.showModal();
    return () => {
      d?.close();
      previous?.focus();
    };
  }, []);
  return (
    <dialog
      ref={ref}
      className={`modal ${wide ? 'wide' : ''}`}
      aria-label={title}
      onCancel={(event) => {
        event.preventDefault();
        if (!closeDisabled) onClose();
      }}
      onClick={(e) => {
        if (e.target === ref.current && !closeDisabled) onClose();
      }}
    >
      <header>
        <h2>{title}</h2>
        <button className="icon-button" aria-label="Close dialog" disabled={closeDisabled} onClick={onClose}>
          <X />
        </button>
      </header>
      <div className="modal-body">{children}</div>
    </dialog>
  );
}
export function PageHeading({
  eyebrow,
  title,
  description,
  children,
}: {
  eyebrow: string;
  title: string;
  description?: string;
  children?: ReactNode;
}) {
  return (
    <div className="page-heading">
      <div>
        <span className="eyebrow">{eyebrow}</span>
        <h1>{title}</h1>
        {description && <p>{description}</p>}
      </div>
      <div className="heading-actions">{children}</div>
    </div>
  );
}
export function Tag({ children, tone = 'neutral' }: { children: ReactNode; tone?: string }) {
  return <span className={`tag ${tone}`}>{children}</span>;
}
export function Metric({ label, value, detail }: { label: string; value: ReactNode; detail: string }) {
  return (
    <div className="metric">
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{detail}</small>
    </div>
  );
}
export const percent = (n: number) => `${Math.round(n <= 1 ? n * 100 : n)}%`;
export const time = (ms: number) =>
  ms < 60000 ? `${Math.round(ms / 1000)}s` : `${Math.floor(ms / 60000)}m ${Math.round((ms % 60000) / 1000)}s`;
export const date = (s: string) =>
  new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(s));
export function Go({ children }: { children: ReactNode }) {
  return (
    <>
      {children}
      <ArrowRight size={17} />
    </>
  );
}
