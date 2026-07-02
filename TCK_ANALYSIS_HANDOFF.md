# OpenCMIS TCK Analysis Handoff

Last updated: 2026-07-02

## Current State

The Gradle OpenCMIS TCK harness is available under `test-harness/opencmis-tck`. It can run full group files or individual tests through `SingleTestGroup`.

Recent isolated profiling used:

```bash
BOX_CMIS_ROOT_FOLDER_ID=396098221315 \
  ./test-harness/opencmis-tck/profile-opencmis-tests.sh phase2

BOX_CMIS_ROOT_FOLDER_ID=396098221315 \
  ./test-harness/opencmis-tck/profile-opencmis-tests.sh phase3
```

The isolated root was created in the correct Box environment:

| Field | Value |
| --- | --- |
| Box user | `385982796` |
| Controlled parent root | `372098901031` |
| Isolated TCK root | `396098221315` |
| Isolated TCK root name | `cmis-tck-isolated-1782991885346` |

Available local artifacts:

| Artifact | Purpose |
| --- | --- |
| `profile-results-phase2-isolated.tsv` | Phase 2 elapsed-time summary |
| `profile-results-phase3-isolated.tsv` | Phase 3 elapsed-time summary |
| `profile-*.log` | Raw OpenCMIS console reports per test |

There is no single HTML/XML TCK export bundle yet. The captured evidence is the console report logs plus TSV timing summaries.

## Important Finding

The profiler currently labels a test as `pass` when the OpenCMIS process exits with code `0`. That is not strict enough.

OpenCMIS can emit `FAILURE:` lines in the report while still returning exit code `0`. Treat any raw log containing `FAILURE:` as a failed compatibility test until investigated.

Current raw-log failures found:

| Test | Failure count | Notes |
| --- | ---: | --- |
| `CreateDocumentWithoutContent` | 1 | New document object spec compliance: expected null content MIME type, actual `application/octet-stream`. |
| `DeleteTreeTest` | 20 | Deleted child documents remained visible to `getObject` immediately after delete tree. Likely Box eventual consistency or trash/delete visibility handling gap. |

Warnings found:

| Test | Warning count | Notes |
| --- | ---: | --- |
| `ContentRangesTest` | 1 | Retrieved stream marked partial although a full stream was expected. |
| `SetAndDeleteContentTest` | 2 | `deleteContentStream` and `appendContentStream` unsupported, expected for Box. |
| `OperationContextTest` | 3 | Allowable actions/path segment returned when not requested. |

## Slow Test Findings

Using the old controlled root `372098901031`, `QuerySmokeTest` returned 100 existing documents. OpenCMIS then fetched each hit with `getObject` and `getContentStream`, making the test measure live Box content download volume more than query behavior. It passed in 215,535 ms there.

Using isolated root `396098221315`, `QuerySmokeTest` returned zero documents and passed in 826 ms. This confirms that root content volume can dominate timing.

Slow Phase 3 tests on the isolated root:

| Test | Elapsed | Cause |
| --- | ---: | --- |
| `QueryInFolderTest` | 308,252 ms | Creates a live folder tree, documents, and nested folders, then validates `IN_FOLDER` and `IN_TREE`. |
| `QueryLikeTest` | 265,393 ms | Creates alphabetic live file/folder fixtures and runs repeated `LIKE` queries. |
| `QueryPagingTest` | 130,922 ms | Creates enough live documents to validate paging. |

Slow Phase 2 tests on the isolated root:

| Test | Elapsed | Cause |
| --- | ---: | --- |
| `CreateAndDeleteDocumentTest` | 392,529 ms | Creates and deletes 20 live documents with repeated validation. |
| `CreateAndDeleteFolderTest` | 364,796 ms | Creates/deletes 20 folders plus a 21-level deep hierarchy; uses path-based deletion. |
| `NameCharsetTest` | 253,300 ms | Tests 22 different live object names. |
| `BulkUpdatePropertiesTest` | 214,159 ms | Performs many live updates and validations. |
| `DeleteTreeTest` | 126,535 ms | Creates a live tree, deletes it, then checks immediate invisibility. Current raw report has failures. |

## Why Build Our Own TCK

We want the same behavioral coverage as OpenCMIS, but optimized for Box-backed repositories.

OpenCMIS is valuable as an external compatibility oracle, but it is inefficient for this connector because it:

- Recreates live Box fixtures test by test.
- Uses repository-level roots in ways that can accidentally include large existing corpora.
- Validates query hits by fetching content streams, which can dominate query tests.
- Treats some unsupported optional services as warnings, not structured expected skips.
- Emits `FAILURE:` report lines without necessarily producing a non-zero process exit.
- Does not understand Box eventual consistency, trash purge latency, or rate-limit behavior.

The optimized TCK should preserve the same coverage but control fixture volume, assertion semantics, and cleanup explicitly.

## Proposed Optimized TCK Design

Create a TypeScript/Bun test suite under the connector repo, for example:

```text
box-cmis-connector/tests/tck/
  harness.ts
  fixtures.ts
  assertions.ts
  phase1-read.test.ts
  phase2-write.test.ts
  phase3-query.test.ts
  phase4-control.test.ts
  open-cmis-parity.md
```

Core principles:

1. Reuse fixture roots.
   - Create one isolated run root per suite.
   - Create named child fixture folders per test group.
   - Clean up once per group instead of after every assertion.

2. Keep tests deterministic.
   - Do not query content-heavy user/demo roots.
   - Keep object counts bounded and documented.
   - Use generated names with run ids.

3. Split behavior from volume.
   - Run one representative create/delete path in normal conformance.
   - Move high-volume loops into a deferred stress suite.
   - Preserve coverage by checking all edge cases with smaller fixture sets.

4. Make pass/fail strict.
   - Any failed assertion fails the process.
   - Expected unsupported operations must be explicit expected skips or expected `notSupported` responses.
   - Warnings should be structured as `expectedWarning`, `unexpectedWarning`, or `followUp`.

5. Model Box-specific consistency.
   - For delete visibility tests, poll with a bounded retry window before failing.
   - Separate immediate CMIS semantics from Box eventual-consistency accommodation.
   - Record elapsed cleanup and retry counts.

6. Keep OpenCMIS parity visible.
   - Map every OpenCMIS test name to one or more optimized tests.
   - Record whether coverage is exact, equivalent, reduced-volume, expected unsupported, or deferred stress.

## Same-Test Coverage Map

Phase 2 write tests to reproduce:

| OpenCMIS test | Optimized TCK equivalent |
| --- | --- |
| `CreateAndDeleteFolderTest` | Create/delete folder, deep hierarchy create, path resolution, path delete with bounded cleanup polling. |
| `CreateAndDeleteDocumentTest` | Create/delete document with content, content properties, content stream retrieval. |
| `CreateDocumentWithoutContent` | Create zero-byte/no-content document and assert content MIME behavior. Current connector likely needs correction here. |
| `CreateInvalidTypeTest` | Invalid `cmis:objectTypeId` and unsupported type creation errors. |
| `NameCharsetTest` | Reduced but representative name matrix, plus Box-specific unsupported-name expectations. |
| `WhitespaceInNameTest` | Leading, internal, repeated, and trailing-space behavior. |
| `CreateAndDeleteRelationshipTest` | Explicit read-only relationship mutation `notSupported`. |
| `CreateAndDeletePolicyTest` | Explicit policy creation/mutation unsupported behavior. |
| `CreateAndDeleteItemTest` | Web link item create/delete, generic CMIS item fallback URL. |
| `PropertyFilterTest` | Object and children filter behavior. |
| `UpdateSmokeTest` | Rename/update property smoke. |
| `BulkUpdatePropertiesTest` | Reduced object count bulk update plus partial failure rows. |
| `SetAndDeleteContentTest` | Set content stream, unsupported append/delete content stream. |
| `ChangeTokenTest` | Matching/mismatched change token and Box `if-match` behavior. |
| `ContentRangesTest` | Full stream, ranged stream, invalid ranges, expected partial flags. |
| `CopyTest` | File/folder copy. |
| `MoveTest` | File/folder/web link move with optional source validation. |
| `DeleteTreeTest` | Recursive delete plus bounded invisibility polling. Current raw OpenCMIS log shows failures here. |
| `OperationContextTest` | Respect requested includes for allowable actions, path segment, ACL, policies, relationships. Current raw OpenCMIS log shows warnings. |

Phase 3 query tests to reproduce:

| OpenCMIS test | Optimized TCK equivalent |
| --- | --- |
| `QuerySmokeTest` | Query empty root and seeded root; avoid content-heavy roots. |
| `QueryRootFolderTest` | Root folder query by object id, aliases, timestamp/date predicates. |
| `QueryForObject` | Direct `cmis:objectId = ...` and `IN (...)` for folder/document. |
| `QueryLikeTest` | Reduced alphabet fixture with representative `%` and `_` patterns. |
| `QueryInFolderTest` | Reduced tree fixture validating direct and recursive folder predicates for docs/folders. |
| `QueryPagingTest` | Smaller paging fixture with deterministic `maxItems` and `skipCount`. |
| `InvalidQueryTest` | Unsupported joins, OR, unsupported functions/properties, malformed SQL. |
| `ContentChangesSmokeTest` | Change token shape and empty/non-empty event response semantics. |

## Immediate Fixes Before Trusting Percentages

1. Tighten `profile-opencmis-tests.sh`.
   - Parse raw logs for `FAILURE:`.
   - Emit `fail:report` when failures appear even if process exit is `0`.
   - Count warnings separately.

2. Reconcile tracker status.
   - Phase 2 should not be treated as fully green while `CreateDocumentWithoutContent` and `DeleteTreeTest` contain raw `FAILURE:` entries.
   - `OperationContextTest` warnings should become tracked Phase 5 compatibility issues.

3. Investigate `CreateDocumentWithoutContent`.
   - OpenCMIS expected null content MIME type for no-content document.
   - Connector returned `application/octet-stream`.

4. Investigate `DeleteTreeTest`.
   - OpenCMIS found 20 deleted documents still visible.
   - Determine whether this is stale Box lookup, trash purge latency, query cache/delete marker gap, or a missing recursive mark-deleted behavior.

5. Decide optimized TCK storage.
   - Recommended: TypeScript tests in `box-cmis-connector/tests/tck`.
   - Keep OpenCMIS harness for periodic external parity checks.

## Suggested Implementation Phases

| Phase | Scope | Exit criteria |
| --- | --- | --- |
| TCK 0 | Harness foundation | Isolated root creation, run id naming, cleanup, strict assertion helpers, report output. |
| TCK 1 | Read/query parity | Phase 1 and Phase 3 optimized tests pass against isolated root. |
| TCK 2 | Write parity | Phase 2 optimized tests pass with bounded fixture counts and strict cleanup. |
| TCK 3 | Versions/changes/ACL parity | Phase 4 optimized tests pass, expected unsupported behaviors explicit. |
| TCK 4 | OpenCMIS bridge | OpenCMIS profile parser fixed; parity report maps OpenCMIS tests to optimized tests. |
| TCK 5 | Deferred stress | High-volume async CRUD and big-document tests run separately from conformance gates. |

## Recommended Next Step

Start by fixing the OpenCMIS profile parser and correcting the current conformance tracker based on raw `FAILURE:` lines. Then scaffold the TypeScript optimized TCK with fixture management and implement the two currently failing parity areas first:

1. `CreateDocumentWithoutContent`
2. `DeleteTreeTest`

