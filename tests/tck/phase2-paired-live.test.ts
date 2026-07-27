import assert from "node:assert/strict";
import test from "node:test";
import { createBoxRestClient } from "./box-rest-client.js";
import { createCmisClient, propertyValue } from "./client.js";
import { createSideBySideComparison, measureOperation } from "./comparison.js";
import { readTckConfig, requireDestructiveTckConfig } from "./config.js";
import { buildFixtureName, buildRunId } from "./fixtures.js";
import { recordTimedResult } from "./report.js";

const config = readTckConfig();
const liveWriteTest = config.allowDestructive ? test : test.skip;

liveWriteTest("phase2.createDeleteFolder compares CMIS with Box REST", { timeout: 60_000 }, async () => {
  requireDestructiveTckConfig(config);
  const parentFolderId = config.runRootId ?? config.parentRootId;
  assert.ok(parentFolderId, "Expected BOX_CMIS_TCK_RUN_ROOT_ID or BOX_CMIS_TCK_PARENT_ROOT_ID");
  const cmis = createCmisClient(config);
  const box = await createBoxRestClient(config);
  const comparison = createSideBySideComparison();
  const runId = buildRunId();
  let cmisFolderId: string | undefined;
  let boxFolderId: string | undefined;

  await recordTimedResult({
    runId: `${runId}-phase2-create-delete-folder-comparison`,
    reportDir: config.reportDir,
    phase: "phase2",
    testId: "phase2.createDeleteFolder",
    openCmisTests: ["CreateAndDeleteFolderTest"],
    coverageMode: "reduced-volume",
    fixtureRootId: parentFolderId,
    createdObjectCount: 2,
    deletedObjectCount: 2,
    cleanupStatus: "pass",
    details: { fixtureShape: "one CMIS folder and one direct Box REST folder", comparison }
  }, async () => {
    try {
      const cmisFolder = await measureOperation(comparison, "create-folder", "cmis", () =>
        cmis.createFolder(`folder:${parentFolderId}`, buildFixtureName(runId, "phase2", "folder-cmis")),
      (value) => ({ objectId: propertyValue(value, "cmis:objectId") }));
      cmisFolderId = propertyValue<string>(cmisFolder, "cmis:objectId");
      assert.ok(cmisFolderId);
      const boxFolder = await measureOperation(comparison, "create-folder", "box-rest", () =>
        box.createFolder(parentFolderId, buildFixtureName(runId, "phase2", "folder-box-rest")),
      (value) => ({ objectId: value.id }));
      boxFolderId = boxFolder.id;

      await measureOperation(comparison, "read-folder", "cmis", () => cmis.getProperties(cmisFolderId!),
        (value) => ({ name: value["cmis:name"]?.value }));
      await measureOperation(comparison, "read-folder", "box-rest", () => box.getFolder(boxFolderId!),
        (value) => ({ name: value.name }));

      await measureOperation(comparison, "delete-folder", "cmis", () => cmis.deleteObject(cmisFolderId!));
      cmisFolderId = undefined;
      await measureOperation(comparison, "delete-folder", "box-rest", () => box.deleteFolder(boxFolderId!));
      boxFolderId = undefined;
    } finally {
      if (cmisFolderId) await cmis.deleteObject(cmisFolderId);
      if (boxFolderId) await box.deleteFolder(boxFolderId, true);
    }
  });
});

liveWriteTest("phase2.createDeleteDocument compares CMIS with Box REST", { timeout: 60_000 }, async () => {
  requireDestructiveTckConfig(config);
  const parentFolderId = config.runRootId ?? config.parentRootId;
  assert.ok(parentFolderId, "Expected BOX_CMIS_TCK_RUN_ROOT_ID or BOX_CMIS_TCK_PARENT_ROOT_ID");
  const cmis = createCmisClient(config);
  const box = await createBoxRestClient(config);
  const comparison = createSideBySideComparison();
  const runId = buildRunId();
  let cmisDocumentId: string | undefined;
  let boxFileId: string | undefined;

  await recordTimedResult({
    runId: `${runId}-phase2-create-delete-document-comparison`,
    reportDir: config.reportDir,
    phase: "phase2",
    testId: "phase2.createDeleteDocument",
    openCmisTests: ["CreateAndDeleteDocumentTest"],
    coverageMode: "reduced-volume",
    fixtureRootId: parentFolderId,
    createdObjectCount: 2,
    deletedObjectCount: 2,
    cleanupStatus: "pass",
    details: { fixtureShape: "one CMIS document and one direct Box REST file with identical content", comparison }
  }, async () => {
    try {
      const content = "paired CMIS and Box REST fixture";
      const cmisDocument = await measureOperation(comparison, "create-document", "cmis", () =>
        cmis.createDocument(`folder:${parentFolderId}`, `${buildFixtureName(runId, "phase2", "document-cmis")}.txt`, content, "text/plain"),
      (value) => ({ objectId: propertyValue(value, "cmis:objectId") }));
      cmisDocumentId = propertyValue<string>(cmisDocument, "cmis:objectId");
      assert.ok(cmisDocumentId);
      const boxFile = await measureOperation(comparison, "create-document", "box-rest", () =>
        box.uploadFile(parentFolderId, `${buildFixtureName(runId, "phase2", "document-box-rest")}.txt`, content),
      (value) => ({ objectId: value.id, size: value.size }));
      boxFileId = boxFile.id;

      const cmisProperties = await measureOperation(comparison, "read-document", "cmis", () => cmis.getProperties(cmisDocumentId!),
        (value) => ({ size: value["cmis:contentStreamLength"]?.value }));
      const boxMetadata = await measureOperation(comparison, "read-document", "box-rest", () => box.getFile(boxFileId!),
        (value) => ({ size: value.size }));
      assert.equal(cmisProperties["cmis:contentStreamLength"]?.value, content.length);
      assert.equal(boxMetadata.size, content.length);

      await measureOperation(comparison, "delete-document", "cmis", () => cmis.deleteObject(cmisDocumentId!));
      cmisDocumentId = undefined;
      await measureOperation(comparison, "delete-document", "box-rest", () => box.deleteFile(boxFileId!));
      boxFileId = undefined;
    } finally {
      if (cmisDocumentId) await cmis.deleteObject(cmisDocumentId);
      if (boxFileId) await box.deleteFile(boxFileId);
    }
  });
});

liveWriteTest("phase2.createInvalidType compares CMIS type validation with Box REST resource routing", { timeout: 60_000 }, async () => {
  requireDestructiveTckConfig(config);
  const parentFolderId = config.runRootId ?? config.parentRootId;
  assert.ok(parentFolderId);
  const cmis = createCmisClient(config);
  const box = await createBoxRestClient(config);
  const comparison = createSideBySideComparison();
  const runId = buildRunId();
  let boxFolderId: string | undefined;

  await recordTimedResult({
    runId: `${runId}-phase2-invalid-type-comparison`, reportDir: config.reportDir, phase: "phase2",
    testId: "phase2.createInvalidType", openCmisTests: ["CreateInvalidTypeTest"], coverageMode: "equivalent",
    fixtureRootId: parentFolderId, createdObjectCount: 1, deletedObjectCount: 1, cleanupStatus: "pass",
    details: {
      fixtureShape: "invalid CMIS folder type plus standard Box REST folder endpoint control",
      semanticDifference: "CMIS validates objectTypeId; Box REST encodes the resource type in the endpoint",
      comparison
    }
  }, async () => {
    try {
      const invalid = await measureOperation(comparison, "create-folder-with-invalid-type", "cmis", () =>
        cmis.createFolderWithTypeStatus(`folder:${parentFolderId}`, buildFixtureName(runId, "phase2", "invalid-type"), "cmis:document"),
      (value) => ({ httpStatus: value.status, exception: value.payload.exception }));
      assert.equal(invalid.status, 400);
      assert.equal(invalid.payload.exception, "invalidArgument");

      const control = await measureOperation(comparison, "create-folder-with-invalid-type", "box-rest", () =>
        box.createFolder(parentFolderId, buildFixtureName(runId, "phase2", "typed-by-endpoint-box-rest")),
      (value) => ({ httpStatus: 201, objectId: value.id, interpretation: "resource type selected by /folders endpoint" }));
      boxFolderId = control.id;
    } finally {
      if (boxFolderId) await box.deleteFolder(boxFolderId);
    }
  });
});

liveWriteTest("phase2.nameCharset compares representative Unicode names", { timeout: 60_000 }, async () => {
  requireDestructiveTckConfig(config);
  const parentFolderId = config.runRootId ?? config.parentRootId;
  assert.ok(parentFolderId);
  const cmis = createCmisClient(config);
  const box = await createBoxRestClient(config);
  const comparison = createSideBySideComparison();
  const runId = buildRunId();
  const unicodeSuffix = "Résumé-日本語.txt";
  let cmisId: string | undefined;
  let boxId: string | undefined;

  await recordTimedResult({
    runId: `${runId}-phase2-name-charset-comparison`, reportDir: config.reportDir, phase: "phase2",
    testId: "phase2.nameCharset", openCmisTests: ["NameCharsetTest"], coverageMode: "reduced-volume",
    fixtureRootId: parentFolderId, createdObjectCount: 2, deletedObjectCount: 2, cleanupStatus: "pass",
    details: {
      fixtureShape: "one representative accented Latin and Japanese document per protocol",
      observedExcludedBoundary: "Emoji-inclusive filename was rejected by both CMIS and Box REST with HTTP 400",
      comparison
    }
  }, async () => {
    try {
      const cmisName = `${buildFixtureName(runId, "phase2", "unicode-cmis")}-${unicodeSuffix}`;
      const boxName = `${buildFixtureName(runId, "phase2", "unicode-box-rest")}-${unicodeSuffix}`;
      const cmisResult = await measureOperation(comparison, "create-unicode-document", "cmis", () =>
        cmis.createDocumentStatus(`folder:${parentFolderId}`, cmisName, "unicode", "text/plain"),
      (value) => ({ httpStatus: value.status, exception: value.payload.exception }));
      const boxResult = await measureOperation(comparison, "create-unicode-document", "box-rest", () =>
        box.uploadFileStatus(parentFolderId, boxName, "unicode"),
      (value) => ({ httpStatus: value.status, code: value.payload.code }));
      assert.equal(cmisResult.status, boxResult.status, "CMIS and Box REST Unicode-name capability diverged");
      if (cmisResult.status === 201) {
        cmisId = cmisObjectIdFromPayload(cmisResult.payload);
        boxId = boxEntryIdFromPayload(boxResult.payload);
        assert.ok(cmisId);
        assert.ok(boxId);
      } else {
        assert.equal(cmisResult.status, 400);
      }
    } finally {
      if (cmisId) await measureOperation(comparison, "delete-unicode-document", "cmis", () => cmis.deleteObject(cmisId!));
      if (boxId) await measureOperation(comparison, "delete-unicode-document", "box-rest", () => box.deleteFile(boxId!));
    }
  });
});

liveWriteTest("phase2.whitespaceInName compares leading repeated and trailing spaces", { timeout: 60_000 }, async () => {
  requireDestructiveTckConfig(config);
  const parentFolderId = config.runRootId ?? config.parentRootId;
  assert.ok(parentFolderId);
  const cmis = createCmisClient(config);
  const box = await createBoxRestClient(config);
  const comparison = createSideBySideComparison();
  const runId = buildRunId();
  let cmisId: string | undefined;
  let boxId: string | undefined;

  await recordTimedResult({
    runId: `${runId}-phase2-whitespace-name-comparison`, reportDir: config.reportDir, phase: "phase2",
    testId: "phase2.whitespaceInName", openCmisTests: ["WhitespaceInNameTest"], coverageMode: "equivalent",
    fixtureRootId: parentFolderId, createdObjectCount: 2, deletedObjectCount: 2, cleanupStatus: "pass",
    details: { fixtureShape: "folder names with leading, repeated internal, and trailing spaces", comparison }
  }, async () => {
    try {
      const cmisName = ` ${buildFixtureName(runId, "phase2", "space  cmis")} `;
      const boxName = ` ${buildFixtureName(runId, "phase2", "space  box-rest")} `;
      const cmisResult = await measureOperation(comparison, "create-whitespace-folder", "cmis", () =>
        cmis.createFolderStatus(`folder:${parentFolderId}`, cmisName),
      (value) => ({ httpStatus: value.status, requestedName: cmisName, exception: value.payload.exception }));
      const boxResult = await measureOperation(comparison, "create-whitespace-folder", "box-rest", () =>
        box.createFolderStatus(parentFolderId, boxName),
      (value) => ({ httpStatus: value.status, requestedName: boxName, code: value.payload.code }));
      assert.equal(cmisResult.status, boxResult.status, "CMIS and Box REST whitespace-name capability diverged");
      if (cmisResult.status === 201) {
        cmisId = cmisObjectIdFromPayload(cmisResult.payload);
        boxId = typeof boxResult.payload.id === "string" ? boxResult.payload.id : undefined;
        assert.ok(cmisId);
        assert.ok(boxId);
      } else {
        assert.equal(cmisResult.status, 400);
      }
    } finally {
      if (cmisId) await measureOperation(comparison, "delete-whitespace-folder", "cmis", () => cmis.deleteObject(cmisId!));
      if (boxId) await measureOperation(comparison, "delete-whitespace-folder", "box-rest", () => box.deleteFolder(boxId!));
    }
  });
});

function cmisObjectIdFromPayload(payload: Record<string, unknown>): string | undefined {
  const properties = payload.properties as Record<string, { value?: unknown }> | undefined;
  return typeof properties?.["cmis:objectId"]?.value === "string" ? properties["cmis:objectId"].value : undefined;
}

function boxEntryIdFromPayload(payload: Record<string, unknown>): string | undefined {
  const entries = payload.entries as Array<{ id?: unknown }> | undefined;
  return typeof entries?.[0]?.id === "string" ? entries[0].id : undefined;
}

liveWriteTest("phase2.createDeleteItem compares CMIS items with Box REST web links", { timeout: 60_000 }, async () => {
  requireDestructiveTckConfig(config);
  const parentFolderId = config.runRootId ?? config.parentRootId;
  assert.ok(parentFolderId);
  const cmis = createCmisClient(config);
  const box = await createBoxRestClient(config);
  const comparison = createSideBySideComparison();
  const runId = buildRunId();
  const url = "https://example.com/cmis-tck";
  let cmisId: string | undefined;
  let boxId: string | undefined;

  await recordTimedResult({
    runId: `${runId}-phase2-create-delete-item-comparison`, reportDir: config.reportDir, phase: "phase2",
    testId: "phase2.createDeleteItem", openCmisTests: ["CreateAndDeleteItemTest"], coverageMode: "equivalent",
    fixtureRootId: parentFolderId, createdObjectCount: 2, deletedObjectCount: 2, cleanupStatus: "pass",
    details: { fixtureShape: "one CMIS item and one Box REST web link", comparison }
  }, async () => {
    try {
      const cmisItem = await measureOperation(comparison, "create-web-link", "cmis", () =>
        cmis.createItem(`folder:${parentFolderId}`, buildFixtureName(runId, "phase2", "item-cmis"), url),
      (value) => ({ objectId: propertyValue(value, "cmis:objectId"), typeId: propertyValue(value, "cmis:objectTypeId") }));
      cmisId = propertyValue<string>(cmisItem, "cmis:objectId");
      assert.ok(cmisId);
      const boxLink = await measureOperation(comparison, "create-web-link", "box-rest", () =>
        box.createWebLink(parentFolderId, buildFixtureName(runId, "phase2", "item-box-rest"), url),
      (value) => ({ objectId: value.id, type: value.type }));
      boxId = boxLink.id;

      await measureOperation(comparison, "read-web-link", "cmis", () => cmis.getProperties(cmisId!),
        (value) => ({ typeId: value["cmis:objectTypeId"]?.value, name: value["cmis:name"]?.value }));
      const boxRead = await measureOperation(comparison, "read-web-link", "box-rest", () => box.getWebLink(boxId!),
        (value) => ({ type: value.type, name: value.name, url: value.url }));
      assert.equal(boxRead.url, url);
    } finally {
      if (cmisId) await measureOperation(comparison, "delete-web-link", "cmis", () => cmis.deleteObject(cmisId!));
      if (boxId) await measureOperation(comparison, "delete-web-link", "box-rest", () => box.deleteWebLink(boxId!));
    }
  });
});

liveWriteTest("phase2.propertyFilter compares CMIS filters with Box REST fields", { timeout: 60_000 }, async () => {
  requireDestructiveTckConfig(config);
  const parentFolderId = config.runRootId ?? config.parentRootId;
  assert.ok(parentFolderId);
  const cmis = createCmisClient(config);
  const box = await createBoxRestClient(config);
  const comparison = createSideBySideComparison();
  const runId = buildRunId();
  let cmisId: string | undefined;
  let boxId: string | undefined;

  await recordTimedResult({
    runId: `${runId}-phase2-property-filter-comparison`, reportDir: config.reportDir, phase: "phase2",
    testId: "phase2.propertyFilter", openCmisTests: ["PropertyFilterTest"], coverageMode: "equivalent",
    fixtureRootId: parentFolderId, createdObjectCount: 2, deletedObjectCount: 2, cleanupStatus: "pass",
    details: { fixtureShape: "one document per protocol; request id and name fields only", comparison }
  }, async () => {
    try {
      const cmisDocument = await cmis.createDocument(`folder:${parentFolderId}`, `${buildFixtureName(runId, "phase2", "filter-cmis")}.txt`, "filter");
      cmisId = propertyValue<string>(cmisDocument, "cmis:objectId");
      assert.ok(cmisId);
      const boxFile = await box.uploadFile(parentFolderId, `${buildFixtureName(runId, "phase2", "filter-box-rest")}.txt`, "filter");
      boxId = boxFile.id;

      const cmisProperties = await measureOperation(comparison, "filtered-property-read", "cmis", () =>
        cmis.getProperties(cmisId!, "cmis:objectId,cmis:name"),
      (value) => ({ returnedFields: Object.keys(value).sort() }));
      const boxFields = await measureOperation(comparison, "filtered-property-read", "box-rest", () =>
        box.getFileFields(boxId!, ["id", "name"]),
      (value) => ({ returnedFields: Object.keys(value).sort() }));
      assert.deepEqual(Object.keys(cmisProperties).sort(), ["cmis:name", "cmis:objectId"]);
      assert.equal(typeof boxFields.id, "string");
      assert.equal(typeof boxFields.name, "string");
    } finally {
      if (cmisId) await cmis.deleteObject(cmisId);
      if (boxId) await box.deleteFile(boxId);
    }
  });
});

liveWriteTest("phase2.updateSmoke compares document rename behavior", { timeout: 60_000 }, async () => {
  requireDestructiveTckConfig(config);
  const parentFolderId = config.runRootId ?? config.parentRootId;
  assert.ok(parentFolderId);
  const cmis = createCmisClient(config);
  const box = await createBoxRestClient(config);
  const comparison = createSideBySideComparison();
  const runId = buildRunId();
  let cmisId: string | undefined;
  let boxId: string | undefined;

  await recordTimedResult({
    runId: `${runId}-phase2-update-smoke-comparison`, reportDir: config.reportDir, phase: "phase2",
    testId: "phase2.updateSmoke", openCmisTests: ["UpdateSmokeTest"], coverageMode: "equivalent",
    fixtureRootId: parentFolderId, createdObjectCount: 2, deletedObjectCount: 2, cleanupStatus: "pass",
    details: { fixtureShape: "one document rename per protocol", comparison }
  }, async () => {
    try {
      const cmisDocument = await cmis.createDocument(`folder:${parentFolderId}`, `${buildFixtureName(runId, "phase2", "update-cmis")}.txt`, "update");
      cmisId = propertyValue<string>(cmisDocument, "cmis:objectId");
      assert.ok(cmisId);
      const boxFile = await box.uploadFile(parentFolderId, `${buildFixtureName(runId, "phase2", "update-box-rest")}.txt`, "update");
      boxId = boxFile.id;
      const cmisName = `${buildFixtureName(runId, "phase2", "updated-cmis")}.txt`;
      const boxName = `${buildFixtureName(runId, "phase2", "updated-box-rest")}.txt`;

      const cmisUpdated = await measureOperation(comparison, "rename-document", "cmis", () => cmis.updateName(cmisId!, cmisName),
        (value) => ({ name: propertyValue(value, "cmis:name") }));
      const boxUpdated = await measureOperation(comparison, "rename-document", "box-rest", () => box.updateFileName(boxId!, boxName),
        (value) => ({ name: value.name }));
      assert.equal(propertyValue(cmisUpdated, "cmis:name"), cmisName);
      assert.equal(boxUpdated.name, boxName);
    } finally {
      if (cmisId) await cmis.deleteObject(cmisId);
      if (boxId) await box.deleteFile(boxId);
    }
  });
});

liveWriteTest("phase2.setAndUnsupportedContentMutations compares content replacement", { timeout: 90_000 }, async () => {
  requireDestructiveTckConfig(config);
  const parentFolderId = config.runRootId ?? config.parentRootId;
  assert.ok(parentFolderId);
  const cmis = createCmisClient(config);
  const box = await createBoxRestClient(config);
  const comparison = createSideBySideComparison();
  const runId = buildRunId();
  let cmisId: string | undefined;
  let boxId: string | undefined;

  await recordTimedResult({
    runId: `${runId}-phase2-content-mutation-comparison`, reportDir: config.reportDir, phase: "phase2",
    testId: "phase2.setAndUnsupportedContentMutations", openCmisTests: ["SetAndDeleteContentTest"], coverageMode: "equivalent",
    fixtureRootId: parentFolderId, createdObjectCount: 2, deletedObjectCount: 2, cleanupStatus: "pass",
    details: {
      fixtureShape: "one document per protocol with a replacement version",
      semanticDifference: "CMIS exposes deleteContentStream and returns notSupported; Box REST has no content-only delete endpoint",
      comparison
    }
  }, async () => {
    try {
      const cmisName = `${buildFixtureName(runId, "phase2", "content-cmis")}.txt`;
      const boxName = `${buildFixtureName(runId, "phase2", "content-box-rest")}.txt`;
      const cmisDocument = await cmis.createDocument(`folder:${parentFolderId}`, cmisName, "original", "text/plain");
      cmisId = propertyValue<string>(cmisDocument, "cmis:objectId");
      assert.ok(cmisId);
      const boxFile = await box.uploadFile(parentFolderId, boxName, "original");
      boxId = boxFile.id;

      await measureOperation(comparison, "replace-content", "cmis", () => cmis.setContent(cmisId!, "replacement", "text/plain"),
        (value) => ({ size: propertyValue(value, "cmis:contentStreamLength") }));
      await measureOperation(comparison, "replace-content", "box-rest", () => box.replaceFileContent(boxId!, boxName, "replacement"),
        (value) => ({ size: value.size }));
      const cmisText = await measureOperation(comparison, "read-replaced-content", "cmis", () => cmis.getContentText(cmisId!),
        (value) => ({ contentLength: value.length }));
      const boxText = await measureOperation(comparison, "read-replaced-content", "box-rest", () => box.getFileContentText(boxId!),
        (value) => ({ contentLength: value.length }));
      assert.equal(cmisText, "replacement");
      assert.equal(boxText, "replacement");

      const deleteContent = await measureOperation(comparison, "delete-content-only", "cmis", () => cmis.deleteContentStatus(cmisId!),
        (value) => ({ httpStatus: value.status, exception: value.payload.exception }));
      assert.equal(deleteContent.payload.exception, "notSupported");
      await measureOperation(comparison, "delete-content-only", "box-rest", () => box.getFile(boxId!),
        (value) => ({
          objectId: value.id,
          supported: false,
          interpretation: "Box REST has no content-only delete operation; deleting content requires deleting the file"
        }));
    } finally {
      if (cmisId) await cmis.deleteObject(cmisId);
      if (boxId) await box.deleteFile(boxId);
    }
  });
});

liveWriteTest("phase2.bulkUpdateProperties compares per-object result rows", { timeout: 90_000 }, async () => {
  requireDestructiveTckConfig(config);
  const parentFolderId = config.runRootId ?? config.parentRootId;
  assert.ok(parentFolderId);
  const cmis = createCmisClient(config);
  const box = await createBoxRestClient(config);
  const comparison = createSideBySideComparison();
  const runId = buildRunId();
  const cmisIds: string[] = [];
  const boxIds: string[] = [];

  await recordTimedResult({
    runId: `${runId}-phase2-bulk-update-comparison`, reportDir: config.reportDir, phase: "phase2",
    testId: "phase2.bulkUpdateProperties", openCmisTests: ["BulkUpdatePropertiesTest"], coverageMode: "reduced-volume",
    fixtureRootId: parentFolderId, createdObjectCount: 4, deletedObjectCount: 4, cleanupStatus: "pass",
    details: {
      fixtureShape: "two valid documents plus one missing id per protocol; shared target name exercises partial conflict rows",
      semanticDifference: "CMIS returns one row array from a bulk request; Box REST requires individual update requests and normalized rows",
      comparison
    }
  }, async () => {
    try {
      for (let index = 0; index < 2; index += 1) {
        const cmisDocument = await cmis.createDocument(
          `folder:${parentFolderId}`,
          `${buildFixtureName(runId, "phase2", `bulk-cmis-${index + 1}`)}.txt`,
          `bulk-${index + 1}`
        );
        const cmisId = propertyValue<string>(cmisDocument, "cmis:objectId");
        assert.ok(cmisId);
        cmisIds.push(cmisId);
        const boxFile = await box.uploadFile(
          parentFolderId,
          `${buildFixtureName(runId, "phase2", `bulk-box-rest-${index + 1}`)}.txt`,
          `bulk-${index + 1}`
        );
        boxIds.push(boxFile.id);
      }

      const cmisTargetName = `${buildFixtureName(runId, "phase2", "bulk-target-cmis")}.txt`;
      const boxTargetName = `${buildFixtureName(runId, "phase2", "bulk-target-box-rest")}.txt`;
      const cmisRows = await measureOperation(comparison, "bulk-rename", "cmis", () =>
        cmis.bulkUpdateNames([...cmisIds, "file:missing-bulk-fixture"], cmisTargetName),
      (rows) => ({ rows: normalizeCmisBulkRows(rows) }));
      const boxRows = await measureOperation(comparison, "bulk-rename", "box-rest", async () =>
        Promise.all([...boxIds, "missing-bulk-fixture"].map(async (id) => {
          const result = await box.updateFileNameStatus(id, boxTargetName);
          return {
            id,
            status: result.status >= 200 && result.status < 300 ? "success" : "failure",
            httpStatus: result.status,
            code: result.payload.code
          };
        })),
      (rows) => ({ rows }));

      const normalizedCmis = normalizeCmisBulkRows(cmisRows);
      assert.equal(normalizedCmis.length, 3);
      assert.equal(boxRows.length, 3);
      assert.equal(normalizedCmis.filter(({ status }) => status === "failure").length >= 1, true);
      assert.equal(boxRows.filter(({ status }) => status === "failure").length >= 1, true);
      assert.equal(normalizedCmis.some(({ id }) => id === "file:missing-bulk-fixture"), true);
      assert.equal(boxRows.some(({ id }) => id === "missing-bulk-fixture"), true);
    } finally {
      await Promise.all(cmisIds.map((id) => cmis.deleteObject(id)));
      await Promise.all(boxIds.map((id) => box.deleteFile(id)));
    }
  });
});

function normalizeCmisBulkRows(rows: Array<Record<string, unknown>>): Array<{ id: unknown; status: "success" | "failure"; exception?: unknown }> {
  return rows.map((row) => ({
    id: row.id,
    status: typeof row.newId === "string" ? "success" : "failure",
    exception: row.exception
  }));
}
