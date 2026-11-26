# SyncCanvas — Known Issues

Record only confirmed issues, TODOs, broken tests, or visible blockers.

- **Docker Desktop stopped locally:** `docker info` reports the Docker daemon is not running on this machine. Start Docker Desktop before running `docker compose up -d postgres redis` or `T10`+ Testcontainers integration tests.
- **Local JDK 22 vs CI JDK 21:** Local machine has JDK 22.0.2; `server/build.gradle.kts` sets `options.release.set(21)` so local builds enforce Java 21 API compatibility and emit Java 21 bytecode while CI runs Temurin 21.
