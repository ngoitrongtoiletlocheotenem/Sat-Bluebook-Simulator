# Desmos calculator integration

Researched on **9 October 2026 (Asia/Saigon)** from live official Desmos documentation. The separate web search/open tool returned HTTP 500; direct HTTPS requests to the official pages succeeded.

## Configuration and behavior

The operator configures `VITE_DESMOS_API_KEY` and `VITE_DESMOS_API_VERSION` in the local `.env`. The supplied API example uses version `1.12`; that version's official documentation was fetched successfully. Vite embeds these browser settings during the frontend build, so changing them requires `npm run build` before restarting the built application. Do not hardcode the key in source, copy another project's key, or include its value in documentation/screenshots/logs.

The calculator loads the official script lazily when the student opens the Math calculator. It creates a `Desmos.GraphingCalculator` inside an owned calculator iframe. The configured path follows the official `/api/v1.12/calculator.js?apiKey=...` pattern. The API documentation requires an operator-issued key from [My API](https://www.desmos.com/my-api). [Official Desmos API v1.12 documentation](https://www.desmos.com/api/v1.12/docs/index.html).

The API fills its container and uses different layouts above/below 450 pixels. Its `autosize` option supports container changes; the integration also responds to panel size changes with `resize()`. Closing the panel destroys the instance and releases observers/listeners. The surrounding player retains its draggable panel and width control. [Official sizing and lifecycle documentation](https://www.desmos.com/api/v1.12/docs/index.html).

A visible loading state precedes the calculator. Network/script failures and loading timeout show the functional local scientific/graph fallback and a Retry Desmos action. Retry requests the official API again rather than retaining a rejected load promise. Without a configured key, the original local fallback remains available. The fallback is clearly identified as a development calculator.

## Content Security Policy

The calculator iframe uses `sandbox="allow-scripts"` and receives a dedicated CSP for the official Desmos script and its required assets/workers. Desmos's runtime evaluation permission is confined to that calculator page; the main application's CSP remains separate. Parent and child verify message sources. The public `/desmos-calculator.js` bridge alone allows cross-origin resource loading so the opaque sandbox can load it; the bridge contains no configured key or account data. Actual production-bundle browser checks must report any blocked origin or worker; a successful script response alone is insufficient evidence that the calculator works.

## Live verification

Run `node scripts/smoke-desmos.mjs` after building with the configured key. The script starts the built backend on port 3002 with a unique SQLite database under `.runtime`, creates a real student session/Math attempt, and tests the actual external calculator. It does not alter the ordinary local deployment's accounts or attempts.

It checks HTTP 200 from the configured API version, the real calculator/editor/canvas, expression input, panel resizing and close/reopen. A second isolated browser context aborts the API script, verifies that the local calculator evaluates `sqrt(81)+2^3` to `17`, then removes the abort and tests retry against the real API. The script records a key-free JSON summary in `.runtime/desmos-smoke.json` and screenshots in `docs/screenshots`. No trace or raw request URLs containing the key are saved.

**Passed on 9 October 2026 against the current production bundle.** The configured v1.12 script redirected to v1.12.0 and returned HTTP 200. Typing `y=x^2` in the real Desmos editor changed the actual graph canvas and rendered the parabola. Resizing to 300 pixels switched Desmos to its compact stacked layout; close/reopen worked. The intentional network failure showed a working fallback with result `17`, and retry loaded real Desmos successfully. Main-app evaluation stayed disabled, the sandbox remained restricted to scripts, and no CSP/page errors occurred during the real calculator checks.

Screenshots were inspected: [real Desmos graph](screenshots/desmos-real.png), [resized calculator](screenshots/desmos-resized.png), [network fallback](screenshots/desmos-fallback.png). Further evidence is recorded in [verification.md](verification.md).

## Operator terms

The supplied key displays Desmos's **Trial Key** watermark in the live calculator. That branding is retained, and production entitlement is not claimed. The current API terms page specifies version 1.0, updated 11 July 2025. Its free Trial Tier covers personal noncommercial use or a 90-day internal commercial evaluation. End-user production use is within commercial scope under those terms and requires an appropriate plan/agreement. The operator should use the entitlement attached to their own key; successful technical loading does not establish entitlement. The current terms were verified from the JavaScript-rendered official page's delivered bundle. [Desmos API Terms](https://www.desmos.com/api-terms?lang=en).
