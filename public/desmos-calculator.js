(() => {
  'use strict';
  let initialized = false;
  let calculator;
  let observer;
  let script;
  let timeout;
  let settled = false;

  const reply = (type) => window.parent.postMessage({ type }, '*');
  const fail = () => {
    if (settled) return;
    settled = true;
    clearTimeout(timeout);
    if (script) {
      script.onload = null;
      script.onerror = null;
      script.remove();
    }
    observer?.disconnect();
    if (typeof calculator?.destroy === 'function') calculator.destroy();
    calculator = undefined;
    reply('pathwise-desmos-error');
  };

  window.addEventListener('message', (event) => {
    if (event.source !== window.parent || initialized) return;
    const input = event.data;
    if (
      !input ||
      input.type !== 'pathwise-desmos-init' ||
      typeof input.key !== 'string' ||
      !input.key.trim() ||
      input.key.length > 1000
    )
      return;
    const version =
      typeof input.version === 'string' && /^1\.\d+$/.test(input.version) ? input.version : '1.12';
    initialized = true;
    script = document.createElement('script');
    script.src = `https://www.desmos.com/api/v${version}/calculator.js?apiKey=${encodeURIComponent(input.key.trim())}`;
    script.async = true;
    script.onerror = fail;
    script.onload = () => {
      try {
        if (typeof window.Desmos?.GraphingCalculator !== 'function') {
          fail();
          return;
        }
        const element = document.getElementById('calculator');
        calculator = window.Desmos.GraphingCalculator(element, {
          expressions: true,
          settingsMenu: true,
          zoomButtons: true,
        });
        if (typeof calculator?.destroy !== 'function' || typeof calculator.resize !== 'function') {
          fail();
          return;
        }
        observer = new ResizeObserver(() => calculator?.resize());
        observer.observe(element);
        settled = true;
        clearTimeout(timeout);
        script.onload = null;
        script.onerror = null;
        reply('pathwise-desmos-ready');
      } catch {
        fail();
      }
    };
    timeout = setTimeout(fail, 15000);
    document.head.append(script);
  });

  window.addEventListener('pagehide', () => {
    clearTimeout(timeout);
    observer?.disconnect();
    if (typeof calculator?.destroy === 'function') calculator.destroy();
    calculator = undefined;
  });

  reply('pathwise-desmos-bridge-ready');
})();
