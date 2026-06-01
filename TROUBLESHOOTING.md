# Troubleshooting Notes

## 2026-06-01 - Phase 11.1 login page did not submit

### Symptom

- Production login page rendered, but clicking login did not send `/api/auth/login`.
- Browser DevTools Network did not show an auth/login request.
- Console showed:

```text
Uncaught SyntaxError: Unexpected token 'return' (at (index):3281:5)
```

### Root Cause

Phase 11.1 added Browser Tool frontend code inside the HTML template string in `src/frontend/page.js`.

This regex:

```js
/^https?:\/\//i
```

was emitted into the inline browser script as invalid JavaScript:

```js
/^https?:///i
```

The inline script failed to parse before login event listeners were registered, so the login form never submitted.

### Fix

Avoided the fragile regex escape inside the HTML template string and used string prefix checks instead:

```js
const lowerValue = value.toLowerCase();

if (
  value.startsWith("data:image/") ||
  lowerValue.startsWith("http://") ||
  lowerValue.startsWith("https://")
) {
  return value;
}
```

### Validation

- `node --check src/frontend/page.js` passed.
- Parsed the generated inline script from `htmlPage()` with `new Function(script)`.
- `CI=1 npx wrangler deploy --dry-run` passed.
- Production login test passed after deploy.
