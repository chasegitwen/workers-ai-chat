# Web AI Assistant

Cloudflare Worker based AI assistant with chat history, file context, web tools, and provider runtime support.

## External provider runtime

Phase 9.1 adds an OpenAI-compatible provider runtime for GLM and Kimi coding models while keeping Workers AI as the default and fallback provider.

Configure secrets and variables outside Git. For local development, copy `.dev.vars.example` to `.dev.vars` and fill values locally:

```ini
EXTERNAL_PROVIDER_ENABLED=true

DEFAULT_PROVIDER=workers-ai
FALLBACK_PROVIDER=workers-ai
WORKERS_AI_MODEL=@cf/meta/llama-3.1-8b-instruct-fast

GLM_API_KEY=
GLM_BASE_URL=
GLM_MODEL=

KIMI_API_KEY=
KIMI_BASE_URL=
KIMI_MODEL=
```

Do not commit real API keys.

## Provider test endpoint

After logging in, test a provider with:

```bash
curl -X POST http://localhost:8787/api/provider/test \
  -H "Content-Type: application/json" \
  -d "{\"provider\":\"glm\"}"
```

Supported provider values:

- `workers-ai`
- `glm`
- `kimi`

The endpoint returns provider metadata and a short `provider-ok` response without exposing API keys.
