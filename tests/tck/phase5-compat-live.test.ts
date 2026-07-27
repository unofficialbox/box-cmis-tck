import assert from "node:assert/strict";
import test from "node:test";
import { createCmisClient } from "./client.js";
import { readTckConfig, requireLiveReadTckConfig } from "./config.js";
import { buildRunId } from "./fixtures.js";
import { recordTimedResult } from "./report.js";

const config = readTckConfig();
const liveReadTest = config.allowLiveRead ? test : test.skip;

liveReadTest("phase5.operationContextIncludes omits unrequested includes", { timeout: 30_000 }, async () => {
  requireLiveReadTckConfig(config);
  const rootFolderId = config.runRootId ?? config.parentRootId;
  assert.ok(rootFolderId, "Expected BOX_CMIS_TCK_RUN_ROOT_ID or BOX_CMIS_TCK_PARENT_ROOT_ID");

  const client = createCmisClient(config);
  const rootObjectId = `folder:${rootFolderId}`;
  const runId = buildRunId();

  await recordTimedResult({
    runId: `${runId}-phase5-operation-context-includes`,
    reportDir: config.reportDir,
    phase: "phase5",
    testId: "phase5.operationContextIncludes",
    openCmisTests: ["OperationContextTest"],
    coverageMode: "equivalent",
    fixtureRootId: rootFolderId,
    createdObjectCount: 0,
    deletedObjectCount: 0,
    cleanupStatus: "skipped",
    warnings: [],
    details: {
      checks: [
        "getObject without includeAllowableActions must omit allowableActions",
        "getChildren without includeAllowableActions must omit child allowableActions",
        "getChildren without includePathSegment must omit pathSegment"
      ]
    }
  }, async () => {
    const object = await client.getObject(rootObjectId, { filter: "cmis:objectId,cmis:name" });
    assert.equal("allowableActions" in object, false, "getObject returned allowableActions although not requested");

    const children = await client.getChildren(rootObjectId, { maxItems: "1", filter: "cmis:objectId,cmis:name" });
    const entries = children.objects as Array<Record<string, unknown>> | undefined;
    assert.ok(Array.isArray(entries), "Expected children objects array");

    for (const entry of entries) {
      assert.equal("pathSegment" in entry, false, "getChildren returned pathSegment although not requested");
      const childObject = entry.object as Record<string, unknown> | undefined;
      assert.ok(childObject, "Expected child object wrapper");
      assert.equal("allowableActions" in childObject, false, "getChildren returned child allowableActions although not requested");
    }
  });
});
