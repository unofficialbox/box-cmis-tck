import assert from "node:assert/strict";
import test from "node:test";
import { createCmisClient, propertyValue } from "./client.js";
import { readTckConfig, requireDestructiveTckConfig } from "./config.js";
import { buildFixtureName, buildRunId } from "./fixtures.js";

const config = readTckConfig();
const liveWriteTest = config.allowDestructive ? test : test.skip;

liveWriteTest("phase2.createDocumentWithoutContent asserts null content metadata", { timeout: 30_000 }, async () => {
  requireDestructiveTckConfig(config);
  const parentFolderId = config.runRootId ?? config.parentRootId;
  assert.ok(parentFolderId, "Expected BOX_CMIS_TCK_RUN_ROOT_ID or BOX_CMIS_TCK_PARENT_ROOT_ID");

  const client = createCmisClient(config);
  const parentObjectId = `folder:${parentFolderId}`;
  const name = `${buildFixtureName(buildRunId(), "phase2", "no-content")}.txt`;
  let objectId: string | undefined;

  try {
    const created = await client.createDocumentWithoutContent(parentObjectId, name);
    objectId = propertyValue<string>(created, "cmis:objectId");
    assert.ok(objectId, "Expected created document object id");
    assert.equal(propertyValue(created, "cmis:contentStreamLength"), null);
    assert.equal(propertyValue(created, "cmis:contentStreamMimeType"), null);

    const properties = await client.getProperties(
      objectId,
      "cmis:objectId,cmis:name,cmis:contentStreamLength,cmis:contentStreamMimeType"
    );

    assert.equal(properties["cmis:objectId"]?.value, objectId);
    assert.equal(properties["cmis:name"]?.value, name);
    assert.equal(properties["cmis:contentStreamLength"]?.value, null);
    assert.equal(properties["cmis:contentStreamMimeType"]?.value, null);
    assert.notEqual(await client.getContentStreamStatus(objectId), 200, "No-content documents must not expose a downloadable content stream");
  } finally {
    if (objectId) {
      await client.deleteObject(objectId);
    }
  }
});

liveWriteTest("phase2.deleteTree hides deleted descendants", { timeout: 45_000 }, async () => {
  requireDestructiveTckConfig(config);
  const parentFolderId = config.runRootId ?? config.parentRootId;
  assert.ok(parentFolderId, "Expected BOX_CMIS_TCK_RUN_ROOT_ID or BOX_CMIS_TCK_PARENT_ROOT_ID");

  const client = createCmisClient(config);
  const parentObjectId = `folder:${parentFolderId}`;
  const runId = buildRunId();
  let treeRootId: string | undefined;

  try {
    const treeRoot = await client.createFolder(parentObjectId, buildFixtureName(runId, "phase2", "delete-tree-root"));
    treeRootId = propertyValue<string>(treeRoot, "cmis:objectId");
    assert.ok(treeRootId, "Expected delete-tree root object id");

    const childFolder = await client.createFolder(treeRootId, buildFixtureName(runId, "phase2", "delete-tree-child"));
    const childFolderId = propertyValue<string>(childFolder, "cmis:objectId");
    assert.ok(childFolderId, "Expected delete-tree child folder object id");

    const rootDocument = await client.createDocument(treeRootId, `${buildFixtureName(runId, "phase2", "delete-tree-root-doc")}.txt`, "root", "text/plain");
    const rootDocumentId = propertyValue<string>(rootDocument, "cmis:objectId");
    assert.ok(rootDocumentId, "Expected delete-tree root document object id");

    const nestedDocument = await client.createDocument(childFolderId, `${buildFixtureName(runId, "phase2", "delete-tree-nested-doc")}.txt`, "nested", "text/plain");
    const nestedDocumentId = propertyValue<string>(nestedDocument, "cmis:objectId");
    assert.ok(nestedDocumentId, "Expected delete-tree nested document object id");

    const deleted = await client.deleteTree(treeRootId);
    treeRootId = undefined;
    assert.deepEqual(deleted.ids ?? [], []);

    await assertEventuallyNotVisible(client, [rootDocumentId, nestedDocumentId, childFolderId], 10_000);
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
    await new Promise((resolve) => setTimeout(resolve, 1_000));
    visibleIds = await visibleObjectIds(client, objectIds);
  }

  assert.deepEqual(visibleIds, [], `Deleted descendants remained visible: ${visibleIds.join(", ")}`);
}

async function visibleObjectIds(client: ReturnType<typeof createCmisClient>, objectIds: string[]): Promise<string[]> {
  const statuses = await Promise.all(objectIds.map(async (objectId) => ({
    objectId,
    status: await client.getObjectStatus(objectId)
  })));
  return statuses.filter(({ status }) => status === 200).map(({ objectId }) => objectId);
}
