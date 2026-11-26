# SyncCanvas Golden Test Vectors

Cross-language golden vectors proving identical HLC and LWW-Map semantics in TypeScript (`packages/sync-engine`) and Java (`server/`).

## Files

- `hlc.json` — 14 Hybrid Logical Clock scenarios covering default initialization, local ticks, backward wall clocks, all 4 branches of the Kulkarni et al. receive rule, counter overflow carry at `99999`, `MAX_DRIFT_MS` boundary + rejection (`CLOCK_SKEW`), and 13-digit epoch formatting.
- `merge.json` — 15 LWW-Map merge scenarios covering concurrent multi-field merges, physical/counter/nodeId tie-breaking, idempotency, commutativity (forward & reversed order), stale discard, delete-wins tombstones, undelete, missing `type` visibility exclusion, `(zIndex, objectId)` tie-breaking, float/integer JCS normalization, and freehand `points` arrays.

## Schema Notes

### `hlc.json`

Each entry has:

- `name`: test case name
- `comment`: explanation of _why_ the expected output is right
- `nodeId`: local clock node ID
- `initial` _(optional)_: starting HLC string (defaults to `0000000000000:00000:{nodeId}`)
- `maxDriftMs` _(optional)_: override drift limit (defaults to `60000`)
- `steps`: ordered list of `{ op: "tick", now, expect }` or `{ op: "recv", now, remote, expect | expectError }`

### `merge.json`

Each entry has:

- `name`: test case name
- `comment`: explanation of _why_ the expected state is right
- `ops`: ordered list of `Op` objects to apply sequentially
- `expectState`: expected `SnapshotState` (`Record<objectId, Record<field, { value, hlc }>>`)
- `expectVisibleIds` _(optional)_: expected result of `visibleObjectIds()`
- `expectHash`: expected lowercase hex SHA-256 of the RFC 8785 JCS canonical sorted register array (currently `""`; populated once `T04` implements `stateHash()` and verified identically by `T07` in Java)
