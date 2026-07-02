import assert from "node:assert/strict";
import test from "node:test";
import { createCmisClient, propertyValue } from "../client.js";
import { readTckConfig, requireStressTckConfig } from "../config.js";
import { buildFixtureName, buildRunId } from "../fixtures.js";

const config = readTckConfig();
const stressTest = config.allowStress ? test : test.skip;

stressTest("stress.deleteTree hides 20 deleted child documents", { timeout: 180_000 }, async () => {
  requireStressTckConfig(config);
  const parentFolderId = config.runRootId ?? config.parentRootId;
  assert.ok(parentFolderId, "Expected BOX_CMIS_TCK_RUN_ROOT_ID or BOX_CMIS_TCK_PARENT_ROOT_ID");

  const client = createCmisClient(config);
  const parentObjectId = `folder:${parentFolderId}`;
  const runId = buildRunId();
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
