# RARE Stage 3 — end-to-end delivery evidence

Run: 2026-11-25T16:18:19.343Z → 2026-11-25T16:18:50.734Z

## Toolchains

| id | status | version |
|---|---|---|
| node_ts | ready | Node 20.20.2 |
| npm | ready | npm 11.19.0 |
| vite_bundler | ready | Vite 8.3.4 |
| python_runtime | ready | Python 3.11.15 |
| git | ready | Git 2.39.5 |
| rust_cargo | ready | Cargo 1.65.0 |
| go_toolchain | ready | Go 1.19.8 |
| java_toolchain | ready | Java 17.0.21.1 |
| android_gradle | missing | — |
| gcc | ready | gcc 12.2.0 |
| gpp | ready | g++ 12.2.0 |
| make | ready | make 4.3 |
| php | ready | PHP 8.2.35 |
| maven | missing | — |
| dotnet | missing | — |
| ruby | missing | — |
| ffmpeg | missing | — |
| psql | ready | psql 15.20 |
| kotlinc | missing | — |
| swift | missing | — |
| dart | missing | — |
| sqlite3 | ready | SQLite 3.40.1 |
| docker | missing | — |

## Provisioning

| toolchain | outcome | command | exit |
|---|---|---|---|
| node_ts | already_ready | — | — |
| npm | already_ready | — | — |
| vite_bundler | already_ready | — | — |
| python_runtime | already_ready | — | — |
| git | already_ready | — | — |
| rust_cargo | already_ready | — | — |
| go_toolchain | already_ready | — | — |
| java_toolchain | already_ready | — | — |
| android_gradle | unavailable_from_archive | — | — |
| gcc | already_ready | — | — |
| gpp | already_ready | — | — |
| make | already_ready | — | — |
| php | already_ready | — | — |
| maven | installed | apt-get install -y maven | 0 |
| dotnet | unavailable_from_archive | — | — |
| ruby | installed | apt-get install -y ruby-full | 0 |
| ffmpeg | installed | apt-get install -y ffmpeg | 0 |
| psql | already_ready | — | — |
| kotlinc | unavailable_from_archive | — | — |
| swift | unavailable_from_archive | — | — |
| dart | unavailable_from_archive | — | — |
| sqlite3 | already_ready | — | — |
| docker | unavailable_from_archive | — | — |

## Intent routing

| message | intent | actions |
|---|---|---|
| build a small website called aurora and deploy it | build | {"build":true,"repository":false,"deploy":true} |
| create a repository for this project and push it to github | build | {"build":false,"repository":true,"deploy":false} |
| research whether solid state batteries are shipping in 2026 | research | {} |
| improve RARE's research department | self_build | {"build":false,"repository":false,"deploy":false} |
| read this document and summarise it | documents | {} |
| what is a monad | conversation | {} |

## Workflows

### small-static-website (static-web) — ok=true

| stage | status | summary |
|---|---|---|
| provision | passed | Every requested toolchain was already ready. |
| scaffold | passed | Wrote 5 files for a static-web project at projects/small-static-website. |
| build | passed | Build and tests passed for small-static-website (static-web).
- build: skipped — `n/a` exit n/a
- test: skipped — `n/a` exit n/a |
| repository | skipped | GITHUB_TOKEN is not configured. |
| deploy | skipped | VERCEL_TOKEN is not configured. |

Limitations:
- Repository creation was skipped: GITHUB_TOKEN is not set.
- Deployment was skipped: VERCEL_TOKEN is not set.

### python-command-line (python-cli) — ok=true

| stage | status | summary |
|---|---|---|
| provision | passed | Every requested toolchain was already ready. |
| scaffold | passed | Wrote 5 files for a python-cli project at projects/python-command-line. |
| build | passed | Build and tests passed for python-command-line (python-cli).
- build: passed — `python3 -m py_compile main.py` exit 0
- test: passed — `python3 -m unittest` exit 0
- run: passed — `python3 main.py` ex |

## Failure injection

Injected: Truncated the module.exports assignment in src/index.js to force a syntax error.

Broken build passed: false (exit 1)

Repaired build passed: true

## Accounts

```json
{
  "github": {
    "ok": false,
    "login": null,
    "error": "GITHUB_TOKEN is not set, so no repository operation can be authenticated."
  },
  "vercel": {
    "ok": false,
    "username": null,
    "limited": false,
    "error": "VERCEL_TOKEN is not set."
  }
}
```