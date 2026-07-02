# OpenCMIS Parity Map

Last updated: 2026-07-02

| OpenCMIS test | Optimized test id | Status | Fixture count | Notes |
| --- | --- | --- | ---: | --- |
| `CreateDocumentWithoutContent` | `phase2.createDocumentWithoutContent` | implemented-live-opt-in | 1 document | Asserts no-content document has null content stream length/MIME type and no downloadable content stream, then deletes the fixture. |
| `DeleteTreeTest` | `phase2.deleteTree` | implemented-live-opt-in | 1 root folder, 1 child folder, 2 documents | Bounded live case passes. |
| `DeleteTreeTest` | `stress.deleteTree20` | implemented-stress-opt-in | 1 root folder, 20 documents | Passed in about 29.4 seconds; object count alone does not reproduce OpenCMIS' visibility failure. |
| `OperationContextTest` | `phase5.operationContextIncludes` | planned | sampled object/folder | Assert allowable actions and path segment are only emitted when requested. |
| `ContentRangesTest` | `phase2.contentRanges` | planned | 1 document | Assert full stream versus ranged stream metadata. |
| `SetAndDeleteContentTest` | `phase2.setAndUnsupportedContentMutations` | planned | 1 document | `setContentStream` equivalent plus expected unsupported append/delete content stream. |
