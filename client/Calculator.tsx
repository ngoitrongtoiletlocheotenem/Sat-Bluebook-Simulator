import { useEffect, useMemo, useRef, useState } from 'react';
import { Calculator as CalculatorIcon, Move, X } from 'lucide-react';
import { desmosApiVersion, isDesmosBridgeMessage } from './desmos';

/** A small expression parser: no JavaScript evaluation or executable input. */
export function evaluateExpression(source: string, x = 0, degrees = false): number {
  const normalized = source
    .replace(/×/g, '*')
    .replace(/÷/g, '/')
    .replace(/−/g, '-')
    .replace(/π/g, 'pi')
    .replace(/\s/g, '');
  if (!normalized || normalized.length > 500)
    throw new Error('Enter an expression of at most 500 characters.');
  const tokens = normalized.match(/(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?|[a-z]+|[()+\-*/^,]/gi) || [];
  if (tokens.join('') !== normalized)
    throw new Error('Use numbers, operators, parentheses, and supported functions.');
  let index = 0;
  const angle = (value: number) => (degrees ? (value * Math.PI) / 180 : value);
  const functions: Record<string, (value: number) => number> = {
    sqrt: Math.sqrt,
    abs: Math.abs,
    sin: (value) => Math.sin(angle(value)),
    cos: (value) => Math.cos(angle(value)),
    tan: (value) => Math.tan(angle(value)),
    asin: (value) => Math.asin(value) * (degrees ? 180 / Math.PI : 1),
    acos: (value) => Math.acos(value) * (degrees ? 180 / Math.PI : 1),
    atan: (value) => Math.atan(value) * (degrees ? 180 / Math.PI : 1),
    log: Math.log10,
    ln: Math.log,
    exp: Math.exp,
    floor: Math.floor,
    ceil: Math.ceil,
  };
  const peek = () => tokens[index];
  function primary(): number {
    const token = tokens[index++];
    if (!token) throw new Error('Expression is incomplete.');
    if (token === '(') {
      const value = addition();
      if (tokens[index++] !== ')') throw new Error('Close the parentheses.');
      return value;
    }
    if (/^(?:\d|\.)/.test(token)) return Number(token);
    if (token.toLowerCase() === 'x') return x;
    if (token.toLowerCase() === 'pi') return Math.PI;
    if (token.toLowerCase() === 'e') return Math.E;
    const fn = functions[token.toLowerCase()];
    if (!fn || tokens[index++] !== '(') throw new Error(`Unsupported expression near ${token}.`);
    const value = addition();
    if (tokens[index++] !== ')') throw new Error('Close the function parentheses.');
    return fn(value);
  }
  function power(): number {
    const value = primary();
    return peek() === '^' ? (index++, value ** unary()) : value;
  }
  function unary(): number {
    if (peek() === '+') {
      index++;
      return unary();
    }
    if (peek() === '-') {
      index++;
      return -unary();
    }
    return power();
  }
  function multiply(): number {
    let value = unary();
    while (peek() === '*' || peek() === '/') {
      const operator = tokens[index++];
      const right = unary();
      value = operator === '*' ? value * right : value / right;
    }
    return value;
  }
  function addition(): number {
    let value = multiply();
    while (peek() === '+' || peek() === '-') {
      const operator = tokens[index++];
      const right = multiply();
      value = operator === '+' ? value + right : value - right;
    }
    return value;
  }
  const result = addition();
  if (index !== tokens.length) throw new Error('Use * for multiplication, for example 2*x.');
  if (!Number.isFinite(result)) throw new Error('The expression has no finite real result.');
  return result;
}

export default function Calculator({ onClose }: { onClose: () => void }) {
  const [mode, setMode] = useState<'scientific' | 'graph'>('scientific');
  const [expression, setExpression] = useState('');
  const [answer, setAnswer] = useState('');
  const [history, setHistory] = useState<{ expression: string; answer: string }[]>([]);
  const [degrees, setDegrees] = useState(false);
  const [graph, setGraph] = useState('x^2');
  const [extent, setExtent] = useState(10);
  const [width, setWidth] = useState(Math.min(520, window.innerWidth - 24));
  const [position, setPosition] = useState({ x: Math.max(12, window.innerWidth - 544), y: 114 });
  const [desmosStatus, setDesmosStatus] = useState<'loading' | 'ready' | 'failed'>('loading');
  const [desmosRetry, setDesmosRetry] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const desmos = useRef<HTMLIFrameElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; y: number; originX: number; originY: number } | null>(null);
  const env = (import.meta as ImportMeta & { env: Record<string, string> }).env;
  const key = env.VITE_DESMOS_API_KEY?.trim();
  const version = desmosApiVersion(env.VITE_DESMOS_API_VERSION);
  useEffect(() => {
    input.current?.focus();
  }, []);
  useEffect(() => {
    if (!key || !desmos.current) return;
    const frame = desmos.current;
    setDesmosStatus('loading');
    const timeout = setTimeout(() => setDesmosStatus('failed'), 20000);
    const initialize = () =>
      frame.contentWindow?.postMessage({ type: 'pathwise-desmos-init', key, version }, '*');
    const receive = (event: MessageEvent) => {
      if (event.source !== frame.contentWindow || !isDesmosBridgeMessage(event.data)) return;
      if (event.data.type === 'pathwise-desmos-bridge-ready') initialize();
      else if (event.data.type === 'pathwise-desmos-ready') {
        clearTimeout(timeout);
        setDesmosStatus('ready');
      } else {
        clearTimeout(timeout);
        setDesmosStatus('failed');
      }
    };
    window.addEventListener('message', receive);
    frame.addEventListener('load', initialize);
    return () => {
      clearTimeout(timeout);
      window.removeEventListener('message', receive);
      frame.removeEventListener('load', initialize);
    };
  }, [key, version, desmosRetry]);
  useEffect(() => {
    if (!key || desmosStatus === 'failed') input.current?.focus();
  }, [key, desmosStatus]);
  function insert(value: string) {
    const start = input.current?.selectionStart ?? expression.length;
    const end = input.current?.selectionEnd ?? start;
    setExpression(expression.slice(0, start) + value + expression.slice(end));
    requestAnimationFrame(() => {
      input.current?.focus();
      input.current?.setSelectionRange(start + value.length, start + value.length);
    });
  }
  function calculate() {
    try {
      const result = Number(evaluateExpression(expression, 0, degrees).toPrecision(12)).toString();
      setAnswer(result);
      setHistory((items) => [{ expression, answer: result }, ...items].slice(0, 8));
    } catch (error) {
      setAnswer(error instanceof Error ? error.message : 'Invalid expression');
    }
  }
  const graphData = useMemo(() => {
    let path = '';
    let started = false;
    let previousY: number | null = null;
    let valid = 0;
    let error = '';
    for (let i = 0; i <= 480; i++) {
      try {
        const y = evaluateExpression(graph, ((i / 480) * 2 - 1) * extent, degrees);
        const svgY = 150 - (y / extent) * 150;
        if (svgY < -150 || svgY > 450 || (previousY !== null && Math.abs(svgY - previousY) > 100)) {
          started = false;
          previousY = svgY;
          continue;
        }
        path += `${started ? 'L' : 'M'}${i.toFixed(1)},${svgY.toFixed(1)} `;
        started = true;
        previousY = svgY;
        valid++;
      } catch (failure) {
        started = false;
        error = failure instanceof Error ? failure.message : 'Invalid graph';
      }
    }
    return { path, error: valid ? '' : error || 'No points in this viewing window.' };
  }, [graph, extent, degrees]);
  return (
    <div
      ref={panel}
      className="calculator-panel"
      role="dialog"
      aria-label="Calculator"
      aria-modal="false"
      style={{ left: position.x, top: position.y, width }}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          if (event.defaultPrevented || (event.target as Element).closest('.desmos-container')) return;
          event.stopPropagation();
          onClose();
        }
      }}
    >
      <div
        className="calculator-title"
        onPointerDown={(event) => {
          if ((event.target as Element).closest('button')) return;
          drag.current = { x: event.clientX, y: event.clientY, originX: position.x, originY: position.y };
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerMove={(event) => {
          if (!drag.current) return;
          setPosition({
            x: Math.max(
              0,
              Math.min(window.innerWidth - 100, drag.current.originX + event.clientX - drag.current.x),
            ),
            y: Math.max(
              0,
              Math.min(window.innerHeight - 100, drag.current.originY + event.clientY - drag.current.y),
            ),
          });
        }}
        onPointerUp={() => {
          drag.current = null;
        }}
        onPointerCancel={() => {
          drag.current = null;
        }}
      >
        <span>
          <CalculatorIcon size={17} />{' '}
          {key && desmosStatus !== 'failed' ? 'Desmos Graphing Calculator' : 'Calculator'}
        </span>
        <span>
          <Move size={15} aria-label="Drag panel to move" />
          <button onClick={onClose} aria-label="Close calculator">
            <X size={20} />
          </button>
        </span>
      </div>
      {key && desmosStatus !== 'failed' ? (
        <div className="desmos-workspace" aria-busy={desmosStatus === 'loading'}>
          <iframe
            key={desmosRetry}
            className="desmos-frame"
            ref={desmos}
            src="/desmos-calculator.html"
            sandbox="allow-scripts"
            title="Desmos Graphing Calculator"
          />
          {desmosStatus === 'loading' && (
            <div className="desmos-loading" role="status">
              <span className="desmos-loading-spinner" aria-hidden="true" />
              Loading Desmos…
            </div>
          )}
        </div>
      ) : (
        <>
          {key && desmosStatus === 'failed' && (
            <div className="desmos-fallback-message" role="status">
              <span>Desmos could not load. The development calculator is available below.</span>
              <button
                type="button"
                onClick={() => {
                  setDesmosStatus('loading');
                  setDesmosRetry((retry) => retry + 1);
                }}
              >
                Retry Desmos
              </button>
            </div>
          )}
          <p className="calculator-disclosure">
            Development calculator · original scientific and graph tools
          </p>
          <div className="calculator-tabs">
            <button aria-pressed={mode === 'scientific'} onClick={() => setMode('scientific')}>
              Scientific
            </button>
            <button aria-pressed={mode === 'graph'} onClick={() => setMode('graph')}>
              Graphing
            </button>
            <button aria-label="Toggle degree or radian mode" onClick={() => setDegrees(!degrees)}>
              {degrees ? 'DEG' : 'RAD'}
            </button>
          </div>
          {mode === 'scientific' ? (
            <>
              <label className="calculator-expression">
                Expression
                <input
                  ref={input}
                  aria-label="Calculator expression"
                  value={expression}
                  onChange={(event) => setExpression(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') calculate();
                  }}
                />
              </label>
              <output className="calculator-answer" aria-live="polite">
                {answer || '0'}
              </output>
              <div className="calculator-keypad">
                {[
                  'sin(',
                  'cos(',
                  'tan(',
                  'sqrt(',
                  'ln(',
                  'log(',
                  '^',
                  'pi',
                  '(',
                  ')',
                  '7',
                  '8',
                  '9',
                  '÷',
                  '4',
                  '5',
                  '6',
                  '×',
                  '1',
                  '2',
                  '3',
                  '−',
                  '0',
                  '.',
                  'e',
                  '+',
                ].map((value) => (
                  <button key={value} onClick={() => insert(value)}>
                    {value}
                  </button>
                ))}
                <button
                  onClick={() => {
                    setExpression('');
                    setAnswer('');
                  }}
                >
                  Clear
                </button>
                <button
                  onClick={() => setExpression(expression.slice(0, -1))}
                  aria-label="Delete last calculator character"
                >
                  ⌫
                </button>
                <button className="calculator-equals" onClick={calculate}>
                  =
                </button>
              </div>
              {!!history.length && (
                <details className="calculator-history">
                  <summary>Calculation history</summary>
                  {history.map((item, i) => (
                    <button key={i} onClick={() => setExpression(item.expression)}>
                      {item.expression} = {item.answer}
                    </button>
                  ))}
                </details>
              )}
            </>
          ) : (
            <>
              <label className="calculator-expression">
                y =
                <input
                  aria-label="Graph expression"
                  value={graph}
                  onChange={(event) => setGraph(event.target.value)}
                />
              </label>
              <svg
                viewBox="0 0 480 300"
                role="img"
                aria-label={`Graph of y equals ${graph}`}
                className="calculator-graph"
              >
                <defs>
                  <pattern id="calculator-grid" width="24" height="15" patternUnits="userSpaceOnUse">
                    <path d="M24 0H0V15" fill="none" stroke="#ddd" strokeWidth=".6" />
                  </pattern>
                  <clipPath id="calculator-clip">
                    <rect width="480" height="300" />
                  </clipPath>
                </defs>
                <rect width="480" height="300" fill="url(#calculator-grid)" />
                <path d="M0 150H480 M240 0V300" stroke="#555" />
                <text x="462" y="143" fontSize="12">
                  x
                </text>
                <text x="248" y="13" fontSize="12">
                  y
                </text>
                <text x="244" y="165" fontSize="10">
                  0
                </text>
                <text x="5" y="165" fontSize="10">
                  −{extent}
                </text>
                <text x="449" y="165" fontSize="10">
                  {extent}
                </text>
                <path
                  d={graphData.path}
                  fill="none"
                  stroke="#0077c8"
                  strokeWidth="2"
                  clipPath="url(#calculator-clip)"
                />
              </svg>
              {graphData.error && (
                <p className="calculator-error" role="status">
                  {graphData.error}
                </p>
              )}
              <label className="calculator-range">
                Graph viewing range: ±{extent}
                <input
                  aria-label="Graph viewing range"
                  type="range"
                  min="2"
                  max="50"
                  value={extent}
                  onChange={(event) => setExtent(Number(event.target.value))}
                />
              </label>
              <p className="calculator-hint">
                Use x, +, −, *, /, ^, sin, cos, tan, sqrt, abs, log, ln. Example: 2*x+1
              </p>
            </>
          )}
        </>
      )}
      <label className="calculator-range">
        Panel width
        <input
          type="range"
          aria-label="Calculator panel width"
          min="300"
          max={Math.max(300, window.innerWidth - 24)}
          value={width}
          onChange={(event) => setWidth(Number(event.target.value))}
        />
      </label>
    </div>
  );
}
