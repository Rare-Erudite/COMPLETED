# Test evidence

## Commands and outcomes

| Check | Outcome | Scope and limit |
|---|---|---|
| `gh auth status` | BLOCKED | Configured GitHub account token was reported invalid. |
| `npm ci --no-audit --no-fund` | FAIL | Registry read reset with `ECONNRESET`; npm removed the incomplete dependency tree. |
| `npm ci --offline --no-audit --no-fund` | FAIL | Cache miss for `onnxruntime-node@1.30.0`. |
| `npm run lint` | PASS (earlier snapshot only) | TypeScript check passed after restoring the original sources and before the final UI/API changes. Not rerun after dependencies were removed. |
| `npm run build` | PASS (earlier snapshot only) | Vite built 1,672 modules; client and server bundles completed. This was before the final edits and does not verify the final source. |
| Full `npm test` attempt 1 | FAIL | Test runner could not spawn `npx` on Windows (`ENOENT`). The runner was changed to launch the local TSX CLI using `process.execPath`. |
| Full `npm test` attempt 2 | FAIL | Toolchain route compared independent processes and observed differing Python probe states. The check was changed to validate the API response contract and honesty invariants. |
| Full `npm test` attempt 3 | FAIL | Project & Build found npm shim launch failure and then Windows `python3.exe` Store alias failure. Both code paths were corrected, but dependencies were concurrently removed by the failed install before a final rerun. |

## Test groups observed passing before the suite stopped

- Backend URL and health checks.
- Standalone conversation/research routing.
- Authentication and verification-code security.
- Durable state, document safety, and sourced research.
- Google/Microsoft OAuth validation.
- Model provider and offline intelligence.
- RARE intelligence bridge.
- Tool primitive/security boundaries.
- Memory lifecycle.
- Self-development/checkpointing.
- Toolchain discovery and authenticated toolchain route after the test assertion was corrected.
- Assistant command interpretation.
- Initial Project & Build scaffolding and Node CLI stages after npm invocation was corrected.

These are partial-suite observations, not a full green run. Test-generated checkpoint snapshots and the generated Python fixture project were cleaned up; the pre-existing checkpoint registry was restored.

## Not run or not completed

The complete test suite, final post-edit typecheck/build, browser E2E, emulator, physical-device, production, and signed APK verification remain incomplete. No test count or coverage percentage is claimed.
