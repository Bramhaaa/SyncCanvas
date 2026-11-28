# SyncCanvas — Known Issues

Record only confirmed issues, TODOs, broken tests, or visible blockers.

- **Local JDK 22 vs CI JDK 21:** Local machine has JDK 22.0.2; `server/build.gradle.kts` sets `options.release.set(21)` so local builds enforce Java 21 API compatibility and emit Java 21 bytecode while CI runs Temurin 21.
- **Benchmark placeholders:** `loadtest/RESULTS.md` and `docs/demo-script.md` contain `_TBD_` placeholders to be filled in once deployed and benchmarked against the live student VM + Neon environment.
