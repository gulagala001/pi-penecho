# pi-penecho

**[简体中文](README.zh-CN.md)**

A local bridge that connects the [PenEcho](https://github.com/penecho/penecho) handwritten whiteboard to a **persistent [pi](https://github.com/earendil-works/pi) agent** — so the AI on your whiteboard actually *remembers*.

Write by hand on the canvas → the agent sees your ink, remembers every previous turn of the session, answers with board-native ink (text / LaTeX formulas / plots / drawings), and can read & write files in a workspace you give it.

```
PenEcho (API mode) ──→ pi-penecho (:9191) ──→ Anthropic-compatible endpoint
                            │
                            └─ persistent pi agent (in-memory session)
                               ├─ persona system (markdown-defined roles)
                               ├─ workspace file tools (read/write/append/list)
                               └─ canvas contract → board JSON commands
```

## Why

PenEcho ships with single-turn executors: every request is independent, the AI only sees the current canvas crop. Great for Q&A, not for *collaboration*. pi-penecho swaps the backend for a stateful agent:

- **Session memory** — one long conversation for the whole working session; the agent remembers what it explained, what you got wrong, where you left off.
- **Personas** — the AI's role is a Markdown file (`personas/*.md`). A tutor for your exam prep, a generic whiteboard buddy, your own thing. Switch in one click.
- **Workspace tools** — a persona may declare a `workspace` directory; the agent gets `read_file` / `write_file` / `append_file` / `list_dir` scoped to it. Long-term memory lives in files, the session is just the workbench.
- **Multi-endpoint profiles** — any Anthropic-compatible endpoint (Kimi, relays, etc.), saved as switchable profiles. Model list pulled from the endpoint's `/v1/models`.
- **Console UI** — `http://localhost:9191`: status, endpoint/model config, persona picker, session controls (new conversation / undo turn), recent turns.

## Quick start

Requirements: Node.js 20+, [PenEcho](https://github.com/penecho/penecho) (`npm i -g penecho`), an API key for an Anthropic-compatible endpoint.

```bash
git clone https://github.com/gulagala001/pi-penecho.git
cd pi-penecho
npm install
npm start          # bridge listens on 127.0.0.1:9191
```

Point PenEcho at the bridge (`~/.penecho/config.env`):

```ini
AI_PROVIDER=api
AI_API_FORMAT=anthropic
AI_API_URL=http://localhost:9191
AI_API_KEY=<your key>          # forwarded on passthrough calls
AI_API_MODEL=k3                # any non-empty value; real model is set in the console
AI_TIMEOUT_SECONDS=300
PENECHO_AI_IMAGE_FORMAT=png
```

Run `penecho`, open **http://localhost:3888** (never `0.0.0.0` — see FAQ), and open **http://localhost:9191** for the console.

## Personas

A persona is a Markdown file with frontmatter:

```markdown
---
name: My Tutor
description: What it does, shown in the console
workspace: /absolute/path   # optional; enables file tools scoped here
---
You are ... (system prompt body; {{canvasContract}} and {{boardFontSize}} are substituted)
```

- Built-ins live in `personas/` (`general`, `kaoyan-tutor` as an example with a workspace).
- Drop your own into `~/.pi-penecho/personas/` — picked up without touching the repo.
- If the workspace contains a `CLAUDE.md`, its full text is appended to the system prompt and hot-reloaded on change.

## Configuration

`~/.pi-penecho/config.json` (chmod 600, hot-reloaded on external edits). Everything in it is also editable from the console:

| Field | Notes |
| --- | --- |
| profiles | named endpoint configs: `apiUrl`, `apiKey`, `model`, `contextWindow`/`maxTokens` (blank = auto) |
| persona | active persona id |
| thinkingLevel | `medium` recommended; `high` can take 10+ minutes per turn |
| keepImages | how many recent board snapshots stay in the session (older ones are pruned to text placeholders) |
| boardFontSize | preferred ink font size |

## Scripts

```bash
npm run check        # syntax check all sources
npm run smoke        # minimal pi + endpoint call (text/image/memory)
npm run test:bridge  # end-to-end: simulated PenEcho request → JSON contract → tools → memory
node scripts/payload-debug.mjs   # dump pi's raw payload & event stream (LLM debugging)
```

## FAQ / hard-won lessons

- **"The web page refuses to connect / 502"** — you opened `http://0.0.0.0:3888`. That's the *listen* address, not a browsable one; system proxies 502 it. Use `http://localhost:3888`.
- **Relay endpoints (non-official) + custom model ids**: unknown models are built from the built-in k3 template with `maxTokens` clamped to ≤32768 — otherwise relays reject `131072`. Also, at least one relay's `kimi-k2.7-code` streams everything into `thinking` (empty `text`) at `low` effort; use `medium`/`high`/`max` there.
- **Long-term memory belongs in files.** Sessions die with the bridge; a workspace persona should write what matters into the workspace (the bundled tutor persona is built around this).

## License

MIT. PenEcho is AGPL (separate project, used over HTTP); pi is MIT.
