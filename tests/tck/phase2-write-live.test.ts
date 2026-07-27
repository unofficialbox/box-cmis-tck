import assert from "node:assert/strict";
import test from "node:test";
import { createCmisClient, propertyValue } from "./client.js";
import { createBoxRestClient } from "./box-rest-client.js";
import { createSideBySideComparison, measureOperation } from "./comparison.js";
import { readTckConfig, requireDestructiveTckConfig } from "./config.js";
import { buildFixtureName, buildRunId } from "./fixtures.js";
import { recordTimedResult } from "./report.js";

const config = readTckConfig();
const liveWriteTest = config.allowDestructive ? test : test.skip;

liveWriteTest("phase2.createDocumentWithoutContent asserts null content metadata", { timeout: 30_000 }, async () => {
  requireDestructiveTckConfig(config);
  const parentFolderId = config.runRootId ?? config.parentRootId;
  assert.ok(parentFolderId, "Expected BOX_CMIS_TCK_RUN_ROOT_ID or BOX_CMIS_TCK_PARENT_ROOT_ID");

  const client = createCmisClient(config);
  const box = await createBoxRestClient(config);
  const comparison = createSideBySideComparison();
  const parentObjectId = `folder:${parentFolderId}`;
  const runId = buildRunId();
  const name = `${buildFixtureName(runId, "phase2", "no-content")}.txt`;

  await recordTimedResult({
    runId: `${runId}-phase2-create-document-without-content`,
    reportDir: config.reportDir,
    phase: "phase2",
    testId: "phase2.createDocumentWithoutContent",
    openCmisTests: ["CreateDocumentWithoutContent"],
    coverageMode: "equivalent",
    fixtureRootId: parentFolderId,
    createdObjectCount: 1,
    deletedObjectCount: 1,
    cleanupStatus: "pass",
    details: {
      fixtureShape: "single no-content document",
      expectedContentStatus: "not 200",
      comparison
    }
  }, async () => {
    let objectId: string | undefined;
    let boxFileId: string | undefined;
    try {
      const created = await measureOperation(comparison, "create-zero-byte-document", "cmis", () =>
        client.createDocumentWithoutContent(parentObjectId, name),
      (value) => ({ objectId: propertyValue(value, "cmis:objectId") }));
      objectId = propertyValue<string>(created, "cmis:objectId");
      assert.ok(objectId, "Expected created document object id");
      const boxFile = await measureOperation(comparison, "create-zero-byte-document", "box-rest", () =>
        box.uploadFile(parentFolderId, `${name}-box-rest`, ""),
      (value) => ({ objectId: value.id, size: value.size }));
      boxFileId = boxFile.id;
      assert.equal(propertyValue(created, "cmis:contentStreamLength"), null);
      assert.equal(propertyValue(created, "cmis:contentStreamMimeType"), null);

      const properties = await measureOperation(comparison, "read-zero-byte-metadata", "cmis", () =>
        client.getProperties(objectId!, "cmis:objectId,cmis:name,cmis:contentStreamLength,cmis:contentStreamMimeType"),
      (value) => ({ size: value["cmis:contentStreamLength"]?.value, mimeType: value["cmis:contentStreamMimeType"]?.value }));
      const boxMetadata = await measureOperation(comparison, "read-zero-byte-metadata", "box-rest", () => box.getFile(boxFileId!),
        (value) => ({ size: value.size }));

      assert.equal(properties["cmis:objectId"]?.value, objectId);
      assert.equal(properties["cmis:name"]?.value, name);
      assert.equal(properties["cmis:contentStreamLength"]?.value, null);
      assert.equal(properties["cmis:contentStreamMimeType"]?.value, null);
      assert.equal(boxMetadata.size, 0);
      const cmisContentStatus = await measureOperation(comparison, "get-zero-byte-content-status", "cmis", () => client.getContentStreamStatus(objectId!),
        (status) => ({ httpStatus: status }));
      await measureOperation(comparison, "get-zero-byte-content-status", "box-rest", () => box.getFileContentStatus(boxFileId!),
        (status) => ({ httpStatus: status }));
      assert.notEqual(cmisContentStatus, 200, "No-content documents must not expose a downloadable content stream");
    } finally {
      if (objectId) {
        await measureOperation(comparison, "delete-zero-byte-document", "cmis", () => client.deleteObject(objectId!));
      }
      if (boxFileId) {
        await measureOperation(comparison, "delete-zero-byte-document", "box-rest", () => box.deleteFile(boxFileId!));
      }
    }
  });
});

liveWriteTest("phase2.deleteTree hides deleted descendants", { timeout: 45_000 }, async () => {
  requireDestructiveTckConfig(config);
  const parentFolderId = config.runRootId ?? config.parentRootId;
  assert.ok(parentFolderId, "Expected BOX_CMIS_TCK_RUN_ROOT_ID or BOX_CMIS_TCK_PARENT_ROOT_ID");

  const client = createCmisClient(config);
  const box = await createBoxRestClient(config);
  const comparison = createSideBySideComparison();
  const parentObjectId = `folder:${parentFolderId}`;
  const runId = buildRunId();

  await recordTimedResult({
    runId: `${runId}-phase2-delete-tree-bounded`,
    reportDir: config.reportDir,
    phase: "phase2",
    testId: "phase2.deleteTree",
    openCmisTests: ["DeleteTreeTest"],
    coverageMode: "reduced-volume",
    fixtureRootId: parentFolderId,
    createdObjectCount: 4,
    deletedObjectCount: 4,
    cleanupStatus: "pass",
    details: {
      fixtureShape: "root folder with one child folder and two documents",
      visibilityPollTimeoutMs: 10_000,
      comparison
    }
  }, async () => {
    let treeRootId: string | undefined;
    let boxTreeRootId: string | undefined;
    try {
      const treeRoot = await measureOperation(comparison, "create-tree-root", "cmis", () =>
        client.createFolder(parentObjectId, buildFixtureName(runId, "phase2", "delete-tree-root")),
      (value) => ({ objectId: propertyValue(value, "cmis:objectId") }));
      treeRootId = propertyValue<string>(treeRoot, "cmis:objectId");
      assert.ok(treeRootId, "Expected delete-tree root object id");
      const boxTreeRoot = await measureOperation(comparison, "create-tree-root", "box-rest", () =>
        box.createFolder(parentFolderId, buildFixtureName(runId, "phase2", "delete-tree-root-box-rest")),
      (value) => ({ objectId: value.id }));
      boxTreeRootId = boxTreeRoot.id;

      const childFolder = await measureOperation(comparison, "create-tree-child", "cmis", () =>
        client.createFolder(treeRootId!, buildFixtureName(runId, "phase2", "delete-tree-child")),
      (value) => ({ objectId: propertyValue(value, "cmis:objectId") }));
      const childFolderId = propertyValue<string>(childFolder, "cmis:objectId");
      assert.ok(childFolderId, "Expected delete-tree child folder object id");
      const boxChildFolder = await measureOperation(comparison, "create-tree-child", "box-rest", () =>
        box.createFolder(boxTreeRootId!, buildFixtureName(runId, "phase2", "delete-tree-child-box-rest")),
      (value) => ({ objectId: value.id }));

      const rootDocument = await measureOperation(comparison, "create-tree-root-document", "cmis", () =>
        client.createDocument(treeRootId!, `${buildFixtureName(runId, "phase2", "delete-tree-root-doc")}.txt`, "root", "text/plain"),
      (value) => ({ objectId: propertyValue(value, "cmis:objectId") }));
      const rootDocumentId = propertyValue<string>(rootDocument, "cmis:objectId");
      assert.ok(rootDocumentId, "Expected delete-tree root document object id");
      const boxRootDocument = await measureOperation(comparison, "create-tree-root-document", "box-rest", () =>
        box.uploadFile(boxTreeRootId!, `${buildFixtureName(runId, "phase2", "delete-tree-root-doc-box-rest")}.txt`, "root"),
      (value) => ({ objectId: value.id }));

      const nestedDocument = await measureOperation(comparison, "create-tree-nested-document", "cmis", () =>
        client.createDocument(childFolderId, `${buildFixtureName(runId, "phase2", "delete-tree-nested-doc")}.txt`, "nested", "text/plain"),
      (value) => ({ objectId: propertyValue(value, "cmis:objectId") }));
      const nestedDocumentId = propertyValue<string>(nestedDocument, "cmis:objectId");
      assert.ok(nestedDocumentId, "Expected delete-tree nested document object id");
      const boxNestedDocument = await measureOperation(comparison, "create-tree-nested-document", "box-rest", () =>
        box.uploadFile(boxChildFolder.id, `${buildFixtureName(runId, "phase2", "delete-tree-nested-doc-box-rest")}.txt`, "nested"),
      (value) => ({ objectId: value.id }));

      const deleted = await measureOperation(comparison, "delete-tree", "cmis", () => client.deleteTree(treeRootId!),
        (value) => ({ failedIds: value.ids ?? [] }));
      treeRootId = undefined;
      assert.deepEqual(deleted.ids ?? [], []);
      await measureOperation(comparison, "delete-tree", "box-rest", () => box.deleteFolder(boxTreeRootId!, true));
      boxTreeRootId = undefined;

      await measureOperation(comparison, "verify-tree-deleted", "cmis", () =>
        assertEventuallyNotVisible(client, [rootDocumentId, nestedDocumentId, childFolderId], 10_000));
      await measureOperation(comparison, "verify-tree-deleted", "box-rest", async () => {
        const statuses = await Promise.all([
          box.getFileStatus(boxRootDocument.id),
          box.getFileStatus(boxNestedDocument.id),
          box.getFolderStatus(boxChildFolder.id)
        ]);
        assert.equal(statuses[2], 404, `Box REST deleted folder remained visible: ${statuses[2]}`);
        return statuses;
      }, (statuses) => ({
        httpStatuses: statuses,
        interpretation: statuses.slice(0, 2).includes(200) ?
          "Box REST recursive deletion trashes descendants; direct file GET can remain visible" :
          "Box REST descendants are not directly visible"
      }));
    } finally {
      if (treeRootId) {
        await client.deleteTree(treeRootId);
      }
      if (boxTreeRootId) {
        await box.deleteFolder(boxTreeRootId, true);
      }
    }
  });
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
