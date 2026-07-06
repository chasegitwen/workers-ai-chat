# Frontend Inline JavaScript Login Failure Runbook

## Incident

After Milestone 4.5/4.6, production login appeared to reject the configured username/password. The actual failure was not authentication or secret related. Browser DevTools showed:

```text
Uncaught SyntaxError: missing ) after argument list (at (index):8604:15)
```

Because the inline frontend script failed to parse, the login event handler never loaded, so valid credentials could not be submitted normally.

## Root Cause

`src/frontend/page.js` exports an HTML template containing inline JavaScript. `node --check src/frontend/page.js` can pass even when the generated inline script is invalid.

The broken source was in the Project archive confirmation string:

```js
if(!confirm("Archive project \"" + projectName(project) + "\"?")){
```

Inside the generated HTML inline script this became invalid JavaScript:

```js
if(!confirm("Archive project "" + projectName(project) + ""?")){
```

The fix was to avoid embedded escaped quotes inside the inline template:

```js
if(!confirm("Archive project " + projectName(project) + "?")){
```

## Prevention

When editing inline frontend JavaScript in `src/frontend/page.js`, especially around Project Settings, OpenClaw runtime UI, event handlers, or generated HTML strings, run both checks:

```powershell
node --check src\frontend\page.js
```

```powershell
node --input-type=module -e "import { htmlPage } from './src/frontend/page.js'; const scripts=[...htmlPage().matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)].map(m=>m[1]); for (let i=0;i<scripts.length;i++){ new Function(scripts[i]); } console.log('generated inline scripts parse ok:', scripts.length);"
```

Then run the full test suite:

```powershell
npx vitest run --pool threads --reporter verbose
```

## Debug Steps

If production login fails but credentials are known-good:

1. Open browser DevTools Console.
2. Look for `Uncaught SyntaxError` on `(index):line:column`.
3. Ignore unrelated browser extension or analytics warnings first.
4. Generate the page locally and inspect the reported line:

```powershell
node --input-type=module -e "import { htmlPage } from './src/frontend/page.js'; const lines=htmlPage().split(/\r?\n/); for(let n=8596;n<=8612;n++){ console.log(String(n).padStart(5)+': '+(lines[n-1]||'')); }"
```

Adjust the line range to match the production error.

## Common Causes

- Escaped quotes inside inline JavaScript strings that are emitted unescaped in generated HTML.
- Template literal interpolation nested inside generated HTML/JS strings.
- Missing comma or closing parenthesis in generated event handler code.
- Unescaped user-facing text embedded in attributes or JavaScript string literals.
- Malformed `fetch(...)`, `addEventListener(...)`, or Project Runtime action handlers.

## Rule of Thumb

Passing `node --check src/frontend/page.js` is necessary but not sufficient. For this app, generated inline scripts must also be parsed from `htmlPage()` before deployment.
