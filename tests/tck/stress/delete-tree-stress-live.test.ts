import assert from "node:assert/strict";
import test from "node:test";
import { createCmisClient, propertyValue } from "../client.js";
import { readTckConfig, requireStressTckConfig } from "../config.js";
import { buildFixtureName, buildRunId } from "../fixtures.js";
import { recordTimedResult } from "../report.js";

const config = readTckConfig();
const stressTest = config.allowStress ? test : test.skip;

stressTest("stress.deleteTree hides 20 deleted child documents", { timeout: 180_000 }, async () => {
  requireStressTckConfig(config);
  const parentFolderId = config.runRootId ?? config.parentRootId;
  assert.ok(parentFolderId, "Expected BOX_CMIS_TCK_RUN_ROOT_ID or BOX_CMIS_TCK_PARENT_ROOT_ID");

  const client = createCmisClient(config);
  const parentObjectId = `folder:${parentFolderId}`;
  const runId = buildRunId();

  await recordTimedResult({
    runId: `${runId}-stress-delete-tree-20`,
    reportDir: config.reportDir,
    phase: "stress",
    testId: "stress.deleteTree20",
    openCmisTests: ["DeleteTreeTest"],
    coverageMode: "deferred-stress",
    fixtureRootId: parentFolderId,
    createdObjectCount: 21,
    deletedObjectCount: 21,
    cleanupStatus: "pass",
    details: {
      fixtureShape: "flat tree with one root folder and 20 child documents",
      visibilityPollTimeoutMs: 60_000
    }
  }, async () => {
    let treeRootId: string | undefined;
    try {
      const treeRoot = await client.createFolder(parentObjectId, buildFixtureName(runId, "stress", "delete-tree-20-root"));
      treeRootId = propertyValue<string>(treeRoot, "cmis:objectId");
      assert.ok(treeRootId, "Expected delete-tree stress root object id");

      const documentIds: string[] = [];
      for (let index = 0; index < 20; index += 1) {
        const name = `${buildFixtureName(runId, "stress", `delete-tree-doc-${String(index + 1).padStart(2, "0")}`)}.txt`;
        const document = await client.createDocument(treeRootId, name, `delete-tree-stress-${index + 1}`, "text/plain");
        const documentId = propertyValue<string>(document, "cmis:objectId");
        assert.ok(documentId, `Expected document id for stress document ${index + 1}`);
        documentIds.push(documentId);
      }

      const deleted = await client.deleteTree(treeRootId);
      treeRootId = undefined;
      assert.deepEqual(deleted.ids ?? [], []);

      await assertEventuallyNotVisible(client, documentIds, 60_000);
    } finally {
      if (treeRootId) {
        await client.deleteTree(treeRootId);
      }
    }
  });
});

stressTest("stress.deleteTree20OpenCmisImmediate hides documents and folder without polling", { timeout: 180_000 }, async () => {
  requireStressTckConfig(config);
  const parentFolderId = config.runRootId ?? config.parentRootId;
  assert.ok(parentFolderId, "Expected BOX_CMIS_TCK_RUN_ROOT_ID or BOX_CMIS_TCK_PARENT_ROOT_ID");

  const client = createCmisClient(config);
  const parentObjectId = `folder:${parentFolderId}`;
  const runId = buildRunId();

  await recordTimedResult({
    runId: `${runId}-stress-delete-tree-20-opencmis-immediate`,
    reportDir: config.reportDir,
    phase: "stress",
    testId: "stress.deleteTree20OpenCmisImmediate",
    openCmisTests: ["DeleteTreeTest"],
    coverageMode: "exact",
    fixtureRootId: parentFolderId,
    createdObjectCount: 21,
    deletedObjectCount: 21,
    cleanupStatus: "pass",
    details: {
      fixtureShape: "OpenCMIS DeleteTreeTest shape: one root folder with 20 flat child documents",
      visibilityCheck: "immediate getObject status for 20 documents plus deleted folder",
      openCmisSemantics: "deleteTree(true, DELETE, true) then exists() without polling"
    }
  }, async () => {
    let treeRootId: string | undefined;
    try {
      const treeRoot = await client.createFolder(parentObjectId, buildFixtureName(runId, "stress", "delete-tree-opencmis-root"));
      treeRootId = propertyValue<string>(treeRoot, "cmis:objectId");
      assert.ok(treeRootId, "Expected delete-tree OpenCMIS root object id");

      const objectIds: string[] = [];
      for (let index = 0; index < 20; index += 1) {
        const name = `${buildFixtureName(runId, "stress", `opencmis-doc-${String(index).padStart(2, "0")}`)}.txt`;
        const document = await client.createDocument(treeRootId, name, "TCK test content.", "text/plain");
        const documentId = propertyValue<string>(document, "cmis:objectId");
        assert.ok(documentId, `Expected document id for OpenCMIS-shaped document ${index}`);
        objectIds.push(documentId);
      }

      const deleted = await client.deleteTree(treeRootId);
      const deletedRootId = treeRootId;
      treeRootId = undefined;
      assert.deepEqual(deleted.ids ?? [], []);

      const visibleIds = await visibleObjectIds(client, [...objectIds, deletedRootId]);
      assert.deepEqual(visibleIds, [], `Deleted OpenCMIS-shaped objects remained immediately visible: ${visibleIds.join(", ")}`);
    } finally {
      if (treeRootId) {
        await client.deleteTree(treeRootId);
      }
    }
  });
});

async function assertEventuallyNotVisible(client: ReturnType<typeof createCmisClient>, objectIds: string[], timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let visibleIds = await visibleObjectIds(client, objectIds);

  while (visibleIds.length > 0 && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 2_000));
    visibleIds = await visibleObjectIds(client, objectIds);
  }

  assert.deepEqual(visibleIds, [], `Deleted stress documents remained visible: ${visibleIds.join(", ")}`);
}

async function visibleObjectIds(client: ReturnType<typeof createCmisClient>, objectIds: string[]): Promise<string[]> {
  const statuses = await Promise.all(objectIds.map(async (objectId) => ({
    objectId,
    status: await client.getObjectStatus(objectId)
  })));
  return statuses.filter(({ status }) => status === 200).map(({ objectId }) => objectId);
}
