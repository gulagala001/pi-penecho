# pi-penecho

**[简体中文](README.zh-CN.md)**

A whiteboard companion that actually *remembers*. Handwrite on a [PenEcho](https://github.com/penecho/penecho) canvas → a persistent agent sees your ink, remembers every turn, answers with board-native ink (text / LaTeX / plots), and reads & writes files in a workspace you give it — long-term memory lives in files, the session is just the workbench.

**Desktop + Android, two ends of one system**: a double-click desktop app, a single self-contained APK (whiteboard, agent engine, and sync all bundled), paired over WiFi with a QR scan and a 6-digit code. Multiple project folders sync independently; multiple sessions per project switch in one click.

## Three steps

### ① Desktop: download, double-click

Grab from [Releases](https://github.com/gulagala001/pi-penecho/releases/latest):
- **macOS**: `pi-penecho-x.y.z-mac-arm64.dmg` → drag to Applications. "Unidentified developer"? Right-click → Open → Open.
- **Windows**: `pi-penecho-x.y.z-win-x64.zip` (portable, unzip & run `pi-penecho.exe`). SmartScreen may warn → "More info" → "Run anyway".

> Packages are unsigned; source is fully public.

The window is the console. Pick the **API format** and paste your API key in the Profile card → Save.
Three endpoint families are supported: **Anthropic-compatible** (Kimi etc.), **OpenAI-compatible** (DeepSeek / OpenRouter / relays, chat/completions), and **OpenAI Responses** (official GPT-5 family).

### ② Phone/tablet: scan, install

Scan the QR code in the console's **「平板配对」** card → download & install `PenEcho-board.apk` (43MB, engine bundled) → open it and wait for the engine (~30s first launch).

> Without the computer nearby, the APK is also at https://gulagala001.github.io/pi-penecho/.

### ③ Pair & sync

1. Console → **生成配对码** (generate pair code)
2. In the app: **≡** (bottom-right) → **配对电脑** (auto-discovers the computer) → enter the 6-digit code
3. On the computer: confirm, pick folders (memory / lecture notes / config) and direction (two-way / computer→tablet / tablet→computer)

Done. Ask by handwriting; the agent answers on the board and remembers what you've learned. The phone works standalone afterwards — the memory is synced on-device.

## More

- **Multi-project**: the console's folder card manages per-project folders, each with its own persona & workspace
- **Multi-session**: named sessions per project, switchable anytime, persisted across restarts
- **Custom personas**: a persona is a Markdown file in `~/.pi-penecho/personas/`
- **On-device console**: app ≡ → 控制台 — the same UI as the desktop

## Troubleshooting

- **App can't find the computer**: desktop app running? Same WiFi? Use "手动输入 IP" (manual IP) in the app.
- **Pair code rejected**: codes last 10 minutes and are single-use — regenerate.
- **Folders not syncing**: check they're enabled in the console; sync runs via [Syncthing](https://syncthing.net) (open-source, P2P, no cloud) whenever both ends are online.
- **Mac app won't open**: System Settings → Privacy & Security → "Open Anyway".

## Developers

```bash
git clone https://github.com/gulagala001/pi-penecho.git
cd pi-penecho && npm install
npm start              # bridge at 127.0.0.1:9191 (console same address)
npm run check          # syntax gates
npm run test:bridge    # full-chain smoke (simulated board request)
npm run build:desktop  # desktop materials (bridge bundle + penecho + syncthing)
npm run dist:desktop   # electron-builder → dmg
bash scripts/build-apk.sh  # Android APK (needs Android SDK; emulator helpers in scripts/emu/)
```

Architecture & hard-won lessons: [CLAUDE.md](CLAUDE.md), [plan.md](plan.md). Transitional CLI-autostart scripts are archived in `scripts/legacy/` (superseded by the desktop app). Project-spec docs: INTENT.md, alignment.md, blueprint.md, AI_README.md.

## License & credits

- Whiteboard: [PenEcho](https://github.com/penecho/penecho) (AGPL-3.0)
- Agent runtime: [pi](https://github.com/earendil-works/pi)
- Sync: [Syncthing](https://syncthing.net) (MPL-2.0)
- This project: AGPL-3.0 (following PenEcho)
