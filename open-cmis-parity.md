# OpenCMIS Parity Map

Last updated: 2026-08-18

| OpenCMIS test | Optimized test id | Status | Fixture count | Notes |
| --- | --- | --- | ---: | --- |
| `CreateAndDeleteFolderTest` | `phase2.createDeleteFolder` | implemented-live-opt-in | 1 CMIS + 1 Box REST folder | Paired create/read/delete timings and outcomes are written side by side. |
| `CreateAndDeleteDocumentTest` | `phase2.createDeleteDocument` | implemented-live-opt-in | 1 CMIS + 1 Box REST document | Paired create/read/delete timings and size validation are written side by side. |
| `CreateDocumentWithoutContent` | `phase2.createDocumentWithoutContent` | implemented-live-opt-in | 1 CMIS + 1 Box REST zero-byte document | Compares CMIS null stream semantics with native Box size 0 and content redirect behavior. |
| `CreateInvalidTypeTest` | `phase2.createInvalidType` | implemented-live-opt-in | 1 Box REST control folder | CMIS rejects the mismatched type; Box REST selects type through the `/folders` endpoint. |
| `NameCharsetTest` | `phase2.nameCharset` | implemented-live-opt-in | 1 CMIS + 1 Box REST document | Accented Latin and Japanese names pass; emoji-inclusive names were rejected by both paths. |
| `WhitespaceInNameTest` | `phase2.whitespaceInName` | implemented-live-opt-in | 0 persistent objects | Both paths reject leading/trailing-space names with HTTP 400; native Box reports `item_name_invalid`. |
| `CreateAndDeleteRelationshipTest` | `phase2.relationshipMutationUnsupported` | implemented-live-opt-in | 2 source/target documents per protocol | Compares CMIS relationship create/delete with direct Box relationship-metadata create/delete. |
| `CreateAndDeletePolicyTest` | `phase2.policyMutationUnsupported` | implemented-live-opt-in | 0 persistent objects | Confirms CMIS generic policy creation is `notSupported` and probes the Box Classification template as the native read-only capability. |
| `CreateAndDeleteItemTest` | `phase2.createDeleteItem` | implemented-live-opt-in | 1 CMIS item + 1 Box REST web link | Paired create/read/delete timings and URL validation. |
| `PropertyFilterTest` | `phase2.propertyFilter` | implemented-live-opt-in | 1 CMIS + 1 Box REST document | CMIS returned exactly the requested id/name properties; Box REST also returned mandatory `type` and `etag`. |
| `UpdateSmokeTest` | `phase2.updateSmoke` | implemented-live-opt-in | 1 CMIS + 1 Box REST document | Paired rename timing and returned-name validation. |
| `BulkUpdatePropertiesTest` | `phase2.bulkUpdateProperties` | implemented-live-opt-in | 2 valid + 1 missing id per protocol | One success, one duplicate-name conflict, and one missing-id failure; Box 409 maps to CMIS `updateConflict`. |
| `SetAndDeleteContentTest` | `phase2.setAndUnsupportedContentMutations` | implemented-live-opt-in | 1 CMIS + 1 Box REST document | Paired content replacement/read; CMIS content-only deletion is explicitly unsupported and Box REST has no equivalent endpoint. |
| `ChangeTokenTest` | `phase2.changeToken` | implemented-live-opt-in | 1 CMIS + 1 Box REST document | Valid conditional rename plus stale-token failure: CMIS 409 `updateConflict`, Box REST 412 `precondition_failed`. |
| `ContentRangesTest` | `phase2.contentRanges` | implemented-live-opt-in | 1 CMIS + 1 Box REST document | Both returned bytes `2-5`, body `2345`, and `Content-Range: bytes 2-5/10`. |
| `CopyTest` | `phase2.copy` | implemented-live-opt-in | mirrored source + target fixtures | Paired file copy timing and returned-id validation. |
| `MoveTest` | `phase2.move` | implemented-live-opt-in | mirrored document + target folder fixtures | Paired parent move timing and returned-id validation. |
| `DeleteTreeTest` | `phase2.deleteTree` | implemented-live-opt-in | mirrored 4-object CMIS and Box REST trees | Compares timings and records that native Box recursive deletion leaves trashed files directly readable while CMIS immediately hides descendants. |
| `DeleteTreeTest` | `stress.deleteTree20` | implemented-stress-opt-in | 1 root folder, 20 documents | Passed in about 29.4 seconds; object count alone does not reproduce OpenCMIS' visibility failure. |
| `DeleteTreeTest` | `stress.deleteTree20OpenCmisImmediate` | implemented-stress-opt-in | 1 root folder, 20 `.txt` documents | Current trace passed in 24.7 seconds. Java is routed through `BoxDeleteTreeTest` so both suites use extension-bearing names and immediate GET verification. |
| `OperationContextTest` | `phase5.operationContextIncludes` | implemented-live-read-opt-in | sampled folder children | Asserts allowable actions/path segment are only emitted when requested; latest optimized run passes. |

## Phase 3 Query

| OpenCMIS test | Optimized test id | Status | Fixture count | Notes |
| --- | --- | --- | ---: | --- |
| `QuerySmokeTest` | `phase3.querySmokeObjectRoot` | implemented-live-opt-in | 1 document per protocol | Bounded query smoke coverage shares the deterministic object-id fixture. |
| `QueryForObject` | `phase3.querySmokeObjectRoot` | implemented-live-opt-in | 1 document per protocol | CMIS object-id predicate versus direct Box file read. |
| `QueryRootFolderTest` | `phase3.querySmokeObjectRoot` | implemented-live-opt-in | shared isolated root | CMIS root-folder query versus direct Box folder read. |
| `QueryInFolderTest` | `phase3.queryInFolder` | implemented-live-opt-in | 1 folder + 2 documents per protocol | CMIS `IN_FOLDER` versus Box folder-items listing. |
| `QueryInTreeTest` | `phase3.metadataInTree` | implemented-live-opt-in | 2 isolated 7-object trees | Metadata-backed CMIS `IN_TREE` post-filtering versus Box folder traversal with the exact metadata template field; included in repeated paired benchmarks. |
| `QueryLikeTest` | `phase3.queryLike` | implemented-live-opt-in | 3 documents per protocol | Two prefix matches and one negative control; Box uses bounded folder listing plus the equivalent local predicate to avoid search-index lag. |
| `QueryPagingTest` | `phase3.queryPagingInvalid` | implemented-live-opt-in | 1 folder + 3 documents per protocol | Ordered offset/limit page compared with Box folder-items paging. |
| `InvalidQueryTest` | `phase3.queryPagingInvalid` | implemented-live-opt-in | existing paging folder | CMIS rejects malformed syntax; Box REST control records that no CMIS statement parser exists. |
| `ContentChangesSmokeTest` | `phase3.contentChanges` | implemented-live-opt-in | 1 Box REST document event | Replays the same Box changes-stream token through CMIS content changes and raw Box Events, then compares the fixture event and next-token presence. |
