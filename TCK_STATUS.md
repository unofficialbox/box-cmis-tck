# Box CMIS TCK Status

Last updated: 2026-07-02

## Current Scope

This folder owns the optimized CMIS TCK work. Keep it separate from `box-cmis-connector`.

## Current Findings

- The OpenCMIS profiler must treat raw `FAILURE:` report lines as failures even when the Java process exits `0`.
- Strict rerun result: `profile-results-strict-known-failures.tsv` marks `CreateDocumentWithoutContent` as `fail:report` with 2 failure lines and `DeleteTreeTest` as `fail:report` with 20 failure lines.
- The optimized no-content case is implemented as a destructive live opt-in. It checks null content metadata and rejects downloadable content for no-content documents.
- Latest optimized no-content live run against `BOX_CMIS_TCK_RUN_ROOT_ID=396098221315` failed because `cmisselector=content` returned HTTP `200` for a no-content document.
- The optimized delete-tree case is implemented as a destructive live opt-in. It creates a bounded tree, calls `deleteTree`, expects no failed ids, and polls deleted descendants until they are no longer visible.
- Latest optimized delete-tree live run against `BOX_CMIS_TCK_RUN_ROOT_ID=396098221315` passed in about 5.6 seconds. This bounded case does not reproduce OpenCMIS' 20-object `DeleteTreeTest` failure.
- A 20-document delete-tree stress variant is implemented behind `BOX_CMIS_TCK_ALLOW_STRESS=true` to mirror the OpenCMIS failure shape.
- Latest 20-document delete-tree stress run against `BOX_CMIS_TCK_RUN_ROOT_ID=396098221315` passed in about 29.4 seconds. Object count alone does not reproduce OpenCMIS' delete-tree visibility failure.
- Current raw-log failures are `CreateDocumentWithoutContent` and `DeleteTreeTest`.
- Current raw-log warnings are `ContentRangesTest`, `SetAndDeleteContentTest`, and `OperationContextTest`.
- Normal optimized TCK runs should use bounded isolated fixtures, not broad tenant roots.

## Next Slice

1. Send the no-content content-stream exposure failure to the connector chat as an implementation defect: no-content documents must not return HTTP `200` content.
2. Inspect OpenCMIS `DeleteTreeTest` fixture shape and add a closer structural variant if it differs from a flat 20-document tree.
3. Rerun the optimized no-content document case after connector fixes.
4. Expand the Phase 2/3 OpenCMIS parity map.
