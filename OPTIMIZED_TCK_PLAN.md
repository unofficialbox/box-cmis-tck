# Optimized Box CMIS TCK Plan

Last updated: 2026-07-02

## Goal

Build a faster, stricter CMIS compatibility suite for the Box-backed CMIS connector while keeping Apache Chemistry OpenCMIS as an external parity oracle.

The new TCK should answer three questions quickly:

1. Does the connector satisfy the CMIS Browser Binding behavior we claim?
2. Are Box-specific constraints, eventual consistency, unsupported services, and rate limits handled explicitly?
3. Which OpenCMIS TCK behaviors are exact matches, reduced-volume equivalents, expected unsupported paths, or deferred stress coverage?

## Evidence Reviewed

Primary files:

- `/Users/massnerder/Developer/Code/box-cmis/test-harness/opencmis-tck/TCK_ANALYSIS_HANDOFF.md`
- `/Users/massnerder/Developer/Code/box-cmis/box-cmis-tck/TCK_ANALYSIS_HANDOFF.md`
- `/Users/massnerder/Developer/Code/box-cmis/test-harness/opencmis-tck/profile-results-phase2-isolated.tsv`
- `/Users/massnerder/Developer/Code/box-cmis/test-harness/opencmis-tck/profile-results-phase3-isolated.tsv`
- `/Users/massnerder/Developer/Code/box-cmis/test-harness/opencmis-tck/profile-*.log`
- `/Users/massnerder/Developer/Code/box-cmis/test-harness/opencmis-tck/profile-opencmis-tests.sh`
- `/Users/massnerder/Developer/Code/box-cmis/box-cmis-connector/package.json`
- `/Users/massnerder/Developer/Code/box-cmis/box-cmis-conformance-tracker.md`

Current stack:

- Connector: TypeScript, Bun, Node 22, `box-node-sdk@10`.
- Existing tests: `bun test tests`.
- Existing OpenCMIS harness: Java 17+, Gradle, Apache Chemistry OpenCMIS TCK `1.1.0`.

## Key Findings

The current OpenCMIS profiler has a false-green risk. It marks tests as `pass` when the Java process exits with code `0`, but the raw OpenCMIS logs can still contain `FAILURE:` report lines.

Known raw-log failures:

| OpenCMIS test | Raw finding | Impact |
| --- | --- | --- |
| `CreateDocumentWithoutContent` | `Content MIME types don't match`; expected null MIME type, connector returned `application/octet-stream`. | Phase 2 should not be considered fully green until fixed or consciously waived. |
| `DeleteTreeTest` | 20 child documents remained visible to `getObject` immediately after `deleteTree`. | Needs delete/trash visibility investigation and bounded consistency polling. |

Known warnings:

| OpenCMIS test | Warning | Impact |
| --- | --- | --- |
| `ContentRangesTest` | Full stream was marked partial. | Needs content-stream metadata assertion in the optimized suite. |
| `SetAndDeleteContentTest` | `deleteContentStream` and `appendContentStream` unsupported. | Expected for Box, but should be modeled as explicit expected unsupported behavior. |
| `OperationContextTest` | Allowable actions and path segment returned when not requested. | Phase 5 compatibility issue; optimized suite should assert include-parameter behavior. |

Slow tests are dominated by live Box fixture volume rather than pure CMIS logic:

| Test | Isolated elapsed | Primary cost |
| --- | ---: | --- |
| `CreateAndDeleteDocumentTest` | 392,529 ms | 20 live document creates/deletes plus validation. |
| `CreateAndDeleteFolderTest` | 364,796 ms | 20 folders plus 21-level hierarchy and path deletion. |
| `QueryInFolderTest` | 308,252 ms | Live folder tree and repeated folder-predicate validation. |
| `QueryLikeTest` | 265,393 ms | Alphabetic live file/folder fixtures and repeated `LIKE` queries. |
| `NameCharsetTest` | 253,300 ms | 22 live object names. |
| `BulkUpdatePropertiesTest` | 214,159 ms | Many live updates and validations. |
| `QueryPagingTest` | 130,922 ms | Paging fixture document creation. |
| `DeleteTreeTest` | 126,535 ms | Live tree creation, recursive delete, immediate visibility assertions. |

The old controlled root `372098901031` made `QuerySmokeTest` return 100 existing documents and take 215,535 ms because OpenCMIS fetched objects and content streams for query hits. The isolated root `396098221315` returned zero documents and passed in 826 ms. Root selection materially changes runtime.

## Language Decision

Recommendation: build the optimized TCK in TypeScript on Bun, inside `/Users/massnerder/Developer/Code/box-cmis/box-cmis-tck`.

| Option | Fit | Decision |
| --- | --- | --- |
| TypeScript/Bun | Best fit with current connector, Box SDK, existing `bun test`, browser-binding HTTP shape, JSON assertions, SaaS/REST tooling, and AI-platform integration conventions. Fast enough for the bottleneck, which is Box API latency, not CPU. | Use for the TCK. |
| Go | Excellent concurrency, static binaries, and load/stress tooling. Weaker fit because it would duplicate connector types, auth wiring, and Box SDK assumptions. | Consider later for standalone stress/load runners only. |
| Rust | Strong correctness/performance, but high implementation overhead for a REST conformance suite whose bottleneck is network I/O. | Do not use for the main TCK. |
| Python | Good scripting and analysis ecosystem, but weaker type alignment with the connector and less consistent with the repo. | Do not use for the main TCK. |
| Java | Keeps proximity to OpenCMIS, but inherits the old harness complexity and slower iteration loop. | Keep only for external OpenCMIS parity. |

TypeScript is also the pragmatic choice for modern REST, SaaS, and newer AI platform workflows: OpenAPI clients, JSON Schema/Zod-style validation, SDK mocks, HTTP fixtures, CI reporting, and AI-assisted test generation all fit naturally without introducing a second implementation language.

## Target Architecture

```text
box-cmis-tck/
  package.json
  README.md
  TCK_STATUS.md
  open-cmis-parity.md
  tests/tck/
  README.md
  harness.ts
  client.ts
  config.ts
  fixtures.ts
  assertions.ts
  report.ts
  openCmisParity.ts
  phase1-read.test.ts
  phase2-write.test.ts
  phase3-query.test.ts
  phase4-control.test.ts
  phase5-compat.test.ts
  tests/tck/stress/
    crud-volume.test.ts
    large-content.test.ts
  tests/tck/reports/
    .gitkeep
```

Core design:

- Use one isolated run root per suite, not broad tenant roots.
- Create bounded fixture folders per phase.
- Reuse fixtures within a phase where possible.
- Keep object counts explicit and small in normal conformance.
- Move high-volume CRUD, async, and large-content coverage into `tests/tck/stress`.
- Emit strict machine-readable reports: JSON plus concise console summary.
- Treat expected unsupported services as first-class assertions, not warnings.
- Model Box eventual consistency with bounded polling and recorded retry counts.
- Maintain an OpenCMIS parity map for every upstream test name.

## Implementation Plan

### TCK 0: Correct Current Evidence

Exit criteria:

- `profile-opencmis-tests.sh` marks a test `fail:report` if its log contains `FAILURE:`.
- TSV output includes `failure_count` and `warning_count`.
- Existing Phase 2/3 TSVs are regenerated or annotated as exit-code-only historical results.
- `box-cmis-conformance-tracker.md` is reconciled so Phase 2 is not treated as fully green while raw report failures remain.

Implementation notes:

- Keep the OpenCMIS harness in Java/Gradle.
- Do not delete existing logs; add stricter parsing and new results.
- Parse `WARNING:` separately from `FAILURE:`.

### TCK 1: Harness Foundation

Exit criteria:

- `bun test tests/tck` can run against a configured connector URL.
- Harness validates tenant/root configuration before destructive tests.
- Each run has a unique run id and isolated root/folder namespace.
- Cleanup is idempotent and reports cleanup failures.
- Assertions understand CMIS Browser Binding objects, properties, errors, paging, content streams, and expected unsupported responses.

Minimum config:

```text
BOX_CMIS_TCK_BASE_URL=http://127.0.0.1:8080/cmis
BOX_CMIS_TCK_REPOSITORY_ID=box
BOX_CMIS_TCK_PARENT_ROOT_ID=372098901031
BOX_CMIS_TCK_RUN_ROOT_ID=396098221315
BOX_CMIS_TCK_ALLOW_DESTRUCTIVE=false
```

`BOX_CMIS_TCK_ALLOW_DESTRUCTIVE=true` should be required for tests that create, update, move, or delete Box content.

### TCK 2: Read and Query Parity

Exit criteria:

- Phase 1 read/browse coverage passes against the isolated root.
- Phase 3 query coverage passes with bounded fixture counts.
- Query tests avoid content-heavy roots.
- Query hit validation does not download every content stream unless the test specifically targets content streaming.

Coverage:

- Service document and repository info.
- Type children, type descendants, type definitions.
- Root object, object by id, object by path.
- Children, descendants, folder tree, parents.
- Filters, succinct mode, paging, ordering.
- Query smoke, object-id query, root folder query.
- Reduced `LIKE` fixture.
- Reduced `IN_FOLDER` and `IN_TREE` fixture.
- Reduced paging fixture.
- Invalid query shapes and explicit `notSupported`.
- Content changes smoke.

### TCK 3: Write Parity

Exit criteria:

- Phase 2 write coverage passes with bounded live object counts.
- `CreateDocumentWithoutContent` equivalent proves the null/no-content MIME behavior.
- `DeleteTreeTest` equivalent proves recursive delete semantics with bounded visibility polling.
- Append/delete content stream and policy/relationship mutation are asserted as expected unsupported.

Coverage:

- Create/delete document with content.
- Create document without content.
- Create/delete folder.
- Reduced name matrix and whitespace names.
- Create item/web link.
- Invalid type create.
- Update properties.
- Bulk update with reduced object count and partial failure rows.
- Set content stream.
- Change-token conflict and happy path.
- Range and full-content stream assertions.
- Copy and move.
- Delete tree with cleanup polling and failed-id checks.
- Operation context include-parameter behavior.

### TCK 4: Versions, Changes, ACL, Relationships

Exit criteria:

- Phase 4 behavior passes without relying on broad tenant content.
- Unsupported write-version, ACL mutation, policy mutation, and relationship mutation paths are explicit.
- Read-only version, changes, ACL, and relationship selectors are covered with bounded fixtures or sampled read-only objects.

Coverage:

- Latest version object/properties.
- All versions for a temporary two-version fixture.
- Historical version object and ranged content stream.
- Checked-out docs empty behavior.
- Content changes token shape.
- ACL selector and ACL management `notSupported`.
- Policies selector empty behavior and mutation `notSupported`.
- Metadata-backed relationships selector and mutation `notSupported`.

### TCK 5: OpenCMIS Parity Map

Exit criteria:

- `open-cmis-parity.md` maps every relevant OpenCMIS test to optimized coverage.
- Each row is marked `exact`, `equivalent`, `reduced-volume`, `expected-unsupported`, `deferred-stress`, or `not-applicable`.
- Report output includes parity status by phase.

Initial parity table columns:

```text
OpenCMIS test | Optimized test id | Status | Fixture count | Notes
```

### TCK 6: Deferred Stress

Exit criteria:

- Stress tests are opt-in and never part of the default fast conformance gate.
- CRUD volume, async-like concurrency, large content, and rate-limit behavior are measured separately.
- Reports include request counts, retry counts, 429/503 handling, elapsed time, and cleanup status.

Recommended command split:

```bash
bun test tests/tck
bun test tests/tck/stress
```

## Reporting Contract

Every TCK run should produce:

- `status`: `pass`, `fail`, or `blocked`.
- `phase`: phase id.
- `testId`: stable optimized test id.
- `openCmisTests`: upstream test names covered.
- `coverageMode`: `exact`, `equivalent`, `reduced-volume`, `expected-unsupported`, `deferred-stress`, or `not-applicable`.
- `fixtureRootId`.
- `createdObjectCount`.
- `deletedObjectCount`.
- `cleanupStatus`.
- `retryCount`.
- `elapsedMs`.
- `warnings`: structured expected/unexpected warnings.

The default console output should stay short. JSON reports can hold the detail.

## First Backlog

1. Fix `profile-opencmis-tests.sh` strict report parsing.
2. Reconcile `box-cmis-conformance-tracker.md` with raw-log failures.
3. Scaffold standalone TypeScript/Bun TCK coverage in `box-cmis-tck`.
4. Implement harness config, CMIS HTTP client, isolated fixture manager, and strict assertions.
5. Implement the two current failure equivalents first:
   - no-content document MIME/null content-stream metadata
   - recursive delete tree with bounded visibility polling
6. Add operation-context include assertions for allowable actions and path segments.
7. Add reduced Phase 3 query fixtures for `LIKE`, folder predicates, and paging.
8. Add `open-cmis-parity.md` and fill Phase 2/3 mappings from the current handoff.

## Success Criteria

The optimized TCK is successful when:

- Normal conformance runs complete in minutes, not tens of minutes.
- The suite fails on compatibility defects that OpenCMIS currently hides behind exit code `0`.
- Live Box fixture volume is bounded and visible.
- Unsupported CMIS services are intentionally asserted.
- OpenCMIS can still be run periodically as an external oracle, but daily iteration uses the optimized TypeScript suite.
