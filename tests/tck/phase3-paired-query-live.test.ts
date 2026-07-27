import assert from "node:assert/strict";
import test from "node:test";
import { createBoxRestClient, type BoxRestItem } from "./box-rest-client.js";
import { createCmisClient, propertyValue, type CmisObject } from "./client.js";
import { createSideBySideComparison, measureOperation } from "./comparison.js";
import { readTckConfig, requireDestructiveTckConfig } from "./config.js";
import { buildFixtureName, buildRunId } from "./fixtures.js";
import { recordTimedResult } from "./report.js";

const config = readTckConfig();
const liveQueryTest = config.allowDestructive ? test : test.skip;

liveQueryTest("phase3.querySmokeObjectRoot compares bounded exact queries", { timeout: 120_000 }, async () => {
  requireDestructiveTckConfig(config);
  const rootId = requiredRootId();
  const cmis = createCmisClient(config);
  const box = await createBoxRestClient(config);
  const comparison = createSideBySideComparison();
  const runId = buildRunId();
  const cmisName = `${buildFixtureName(runId, "phase3", "exact-cmis")}.txt`;
  const boxName = `${buildFixtureName(runId, "phase3", "exact-box-rest")}.txt`;
  let cmisId: string | undefined;
  let boxId: string | undefined;

  await recordTimedResult({
    runId: `${runId}-phase3-query-smoke-object-root-comparison`, reportDir: config.reportDir,
    phase: "phase3", testId: "phase3.querySmokeObjectRoot",
    openCmisTests: ["QuerySmokeTest", "QueryForObject", "QueryRootFolderTest"], coverageMode: "reduced-volume",
    fixtureRootId: rootId, createdObjectCount: 2, deletedObjectCount: 2, cleanupStatus: "pass",
    details: { fixtureShape: "one uniquely named document per protocol plus the shared isolated root", comparison }
  }, async () => {
    try {
      const cmisDocument = await cmis.createDocument(`folder:${rootId}`, cmisName, "phase3 exact query");
      cmisId = requiredCmisId(cmisDocument);
      const boxDocument = await box.uploadFile(rootId, boxName, "phase3 exact query");
      boxId = boxDocument.id;

      const cmisExact = await measureOperation(comparison, "object-id-query", "cmis", () =>
        cmis.query(`SELECT cmis:objectId, cmis:name FROM cmis:document WHERE cmis:objectId = '${sqlLiteral(cmisId)}'`), queryOutcome);
      const boxExact = await measureOperation(comparison, "object-id-query", "box-rest", () => box.getFile(boxId!),
        (file) => ({ count: 1, ids: [file.id], names: [file.name] }));
      assert.deepEqual(queryIds(cmisExact), [cmisId]);
      assert.equal(boxExact.id, boxId);

      const cmisRoot = await measureOperation(comparison, "root-folder-query", "cmis", () =>
        cmis.query(`SELECT cmis:objectId, cmis:name FROM cmis:folder WHERE cmis:objectId = 'folder:${rootId}'`), queryOutcome);
      const boxRoot = await measureOperation(comparison, "root-folder-query", "box-rest", () => box.getFolder(rootId),
        (folder) => ({ count: 1, ids: [folder.id], names: [folder.name] }));
      assert.equal(queryIds(cmisRoot).includes(`folder:${rootId}`), true);
      assert.equal(boxRoot.id, rootId);
    } finally {
      if (cmisId) await cmis.deleteObject(cmisId);
      if (boxId) await box.deleteFile(boxId);
    }
  });
});

liveQueryTest("phase3.queryInFolder compares direct-child predicates", { timeout: 120_000 }, async () => {
  requireDestructiveTckConfig(config);
  const rootId = requiredRootId();
  const cmis = createCmisClient(config);
  const box = await createBoxRestClient(config);
  const comparison = createSideBySideComparison();
  const runId = buildRunId();
  let cmisFolderId: string | undefined;
  let boxFolderId: string | undefined;

  await recordTimedResult({
    runId: `${runId}-phase3-in-folder-comparison`, reportDir: config.reportDir, phase: "phase3",
    testId: "phase3.queryInFolder", openCmisTests: ["QueryInFolderTest"], coverageMode: "reduced-volume",
    fixtureRootId: rootId, createdObjectCount: 6, deletedObjectCount: 6, cleanupStatus: "pass",
    details: { fixtureShape: "one folder and two direct child documents per protocol", comparison }
  }, async () => {
    try {
      const cmisFolder = await cmis.createFolder(`folder:${rootId}`, buildFixtureName(runId, "phase3", "in-folder-cmis"));
      cmisFolderId = requiredCmisId(cmisFolder);
      const boxFolder = await box.createFolder(rootId, buildFixtureName(runId, "phase3", "in-folder-box-rest"));
      boxFolderId = boxFolder.id;
      for (const suffix of ["alpha", "beta"]) {
        await cmis.createDocument(cmisFolderId, `${suffix}.txt`, suffix);
        await box.uploadFile(boxFolderId, `${suffix}.txt`, suffix);
      }

      const cmisResult = await measureOperation(comparison, "list-direct-query-children", "cmis", () =>
        cmis.query(`SELECT cmis:objectId, cmis:name FROM cmis:document WHERE IN_FOLDER('${sqlLiteral(cmisFolderId!)}') ORDER BY cmis:name ASC`), queryOutcome);
      const boxResult = await measureOperation(comparison, "list-direct-query-children", "box-rest", () =>
        box.listFolderItems(boxFolderId!, { fields: ["id", "type", "name"], sort: "name", direction: "ASC" }),
      (page) => listOutcome(page.entries));
      assert.deepEqual(queryNames(cmisResult), ["alpha.txt", "beta.txt"]);
      assert.deepEqual(boxResult.entries.map((entry) => entry.name), ["alpha.txt", "beta.txt"]);
    } finally {
      if (cmisFolderId) await cmis.deleteTree(cmisFolderId);
      if (boxFolderId) await box.deleteFolder(boxFolderId, true);
    }
  });
});

liveQueryTest("phase3.queryLike compares bounded prefix matching", { timeout: 120_000 }, async () => {
  requireDestructiveTckConfig(config);
  const rootId = requiredRootId();
  const cmis = createCmisClient(config);
  const box = await createBoxRestClient(config);
  const comparison = createSideBySideComparison();
  const runId = buildRunId();
  const cmisPrefix = `${buildFixtureName(runId, "phase3", "like-cmis")}-match`;
  const boxPrefix = `${buildFixtureName(runId, "phase3", "like-box-rest")}-match`;
  const cmisIds: string[] = [];
  const boxIds: string[] = [];
  let cmisFolderId: string | undefined;
  let boxFolderId: string | undefined;

  await recordTimedResult({
    runId: `${runId}-phase3-like-comparison`, reportDir: config.reportDir, phase: "phase3",
    testId: "phase3.queryLike", openCmisTests: ["QueryLikeTest"], coverageMode: "reduced-volume",
    fixtureRootId: rootId, createdObjectCount: 8, deletedObjectCount: 8, cleanupStatus: "pass",
    details: { fixtureShape: "one isolated folder with two matching and one non-matching document per protocol", semanticDifference: "Box REST lists its isolated folder and applies the same prefix predicate locally", comparison }
  }, async () => {
    try {
      cmisFolderId = requiredCmisId(await cmis.createFolder(`folder:${rootId}`, buildFixtureName(runId, "phase3", "like-cmis-folder")));
      boxFolderId = (await box.createFolder(rootId, buildFixtureName(runId, "phase3", "like-box-rest-folder"))).id;
      for (const suffix of ["a.txt", "b.txt"]) {
        cmisIds.push(requiredCmisId(await cmis.createDocument(cmisFolderId, `${cmisPrefix}-${suffix}`, suffix)));
        boxIds.push((await box.uploadFile(boxFolderId, `${boxPrefix}-${suffix}`, suffix)).id);
      }
      cmisIds.push(requiredCmisId(await cmis.createDocument(cmisFolderId, `${buildFixtureName(runId, "phase3", "other-cmis")}.txt`, "other")));
      boxIds.push((await box.uploadFile(boxFolderId, `${buildFixtureName(runId, "phase3", "other-box-rest")}.txt`, "other")).id);

      await waitForFolderItems(box, boxIdFromCmis(cmisFolderId), cmisIds.map(boxIdFromCmis));
      await waitForFolderItems(box, boxFolderId, boxIds);

      const cmisResult = await measureOperation(comparison, "prefix-name-query", "cmis", () =>
        cmis.query(`SELECT cmis:objectId, cmis:name FROM cmis:document WHERE IN_FOLDER('${sqlLiteral(cmisFolderId!)}') AND cmis:name LIKE '${sqlLiteral(cmisPrefix)}%' ORDER BY cmis:name ASC`), queryOutcome);
      const boxResult = await measureOperation(comparison, "prefix-name-query", "box-rest", () =>
        box.listFolderItems(boxFolderId!, { fields: ["id", "type", "name"], limit: 1000 }),
      (page) => listOutcome(page.entries.filter((entry) => entry.name?.startsWith(boxPrefix))));
      assert.equal(queryNames(cmisResult).length, 2);
      assert.equal(boxResult.entries.filter((entry) => entry.name?.startsWith(boxPrefix)).length, 2);
    } finally {
      if (cmisFolderId) await cmis.deleteTree(cmisFolderId);
      else for (const id of cmisIds) await cmis.deleteObject(id);
      if (boxFolderId) await box.deleteFolder(boxFolderId, true);
      else for (const id of boxIds) await box.deleteFile(id);
    }
  });
});

liveQueryTest("phase3.queryPaging compares ordered offsets and invalid syntax", { timeout: 120_000 }, async () => {
  requireDestructiveTckConfig(config);
  const rootId = requiredRootId();
  const cmis = createCmisClient(config);
  const box = await createBoxRestClient(config);
  const comparison = createSideBySideComparison();
  const runId = buildRunId();
  let cmisFolderId: string | undefined;
  let boxFolderId: string | undefined;

  await recordTimedResult({
    runId: `${runId}-phase3-paging-invalid-comparison`, reportDir: config.reportDir, phase: "phase3",
    testId: "phase3.queryPagingInvalid", openCmisTests: ["QueryPagingTest", "InvalidQueryTest"], coverageMode: "reduced-volume",
    fixtureRootId: rootId, createdObjectCount: 8, deletedObjectCount: 8, cleanupStatus: "pass",
    details: { fixtureShape: "one folder and three ordered documents per protocol", comparison }
  }, async () => {
    try {
      cmisFolderId = requiredCmisId(await cmis.createFolder(`folder:${rootId}`, buildFixtureName(runId, "phase3", "paging-cmis")));
      boxFolderId = (await box.createFolder(rootId, buildFixtureName(runId, "phase3", "paging-box-rest"))).id;
      for (const name of ["a.txt", "b.txt", "c.txt"]) {
        await cmis.createDocument(cmisFolderId, name, name);
        await box.uploadFile(boxFolderId, name, name);
      }

      const cmisPage = await measureOperation(comparison, "ordered-query-page", "cmis", () =>
        cmis.query(`SELECT cmis:objectId, cmis:name FROM cmis:document WHERE IN_FOLDER('${sqlLiteral(cmisFolderId!)}') ORDER BY cmis:name ASC`, { maxItems: "2", skipCount: "1" }), queryOutcome);
      const boxPage = await measureOperation(comparison, "ordered-query-page", "box-rest", () =>
        box.listFolderItems(boxFolderId!, { fields: ["id", "type", "name"], limit: 2, offset: 1, sort: "name", direction: "ASC" }),
      (page) => ({ ...listOutcome(page.entries), total: page.total_count }));
      assert.deepEqual(queryNames(cmisPage), ["b.txt", "c.txt"]);
      assert.deepEqual(boxPage.entries.map((entry) => entry.name), ["b.txt", "c.txt"]);

      const invalid = await measureOperation(comparison, "invalid-query-control", "cmis", () => cmis.queryStatus("SELECT FROM"),
        (value) => ({ httpStatus: value.status, exception: value.payload.exception }));
      await measureOperation(comparison, "invalid-query-control", "box-rest", () => box.listFolderItems(boxFolderId!, { limit: 1 }),
        (page) => ({ httpStatus: 200, interpretation: "Box REST has no CMIS statement parser", count: page.entries.length }));
      assert.equal(invalid.status, 400);
      assert.equal(invalid.payload.exception, "invalidArgument");
    } finally {
      if (cmisFolderId) await cmis.deleteTree(cmisFolderId);
      if (boxFolderId) await box.deleteFolder(boxFolderId, true);
    }
  });
});

function requiredRootId(): string {
  const value = config.runRootId ?? config.parentRootId;
  assert.ok(value, "Expected BOX_CMIS_TCK_RUN_ROOT_ID or BOX_CMIS_TCK_PARENT_ROOT_ID");
  return value;
}

async function waitForFolderItems(
  box: Awaited<ReturnType<typeof createBoxRestClient>>,
  folderId: string,
  expectedIds: string[],
  timeoutMs = 10_000
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (true) {
    const page = await box.listFolderItems(folderId, { fields: ["id"], limit: 1000 });
    const visibleIds = new Set(page.entries.map(({ id }) => id));
    if (expectedIds.every((id) => visibleIds.has(id))) return;
    if (Date.now() >= deadline) {
      assert.fail(`Timed out waiting for ${expectedIds.filter((id) => !visibleIds.has(id)).length} query fixture item(s) to become visible`);
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}

function boxIdFromCmis(objectId: string): string {
  return objectId.replace(/^(file|folder):/, "");
}

function requiredCmisId(object: CmisObject): string {
  const id = propertyValue<string>(object, "cmis:objectId");
  assert.ok(id, "Expected CMIS object id");
  return id;
}

function sqlLiteral(value: string): string {
  return value.replaceAll("'", "''");
}

function queryObjects(payload: Record<string, unknown>): Array<Record<string, unknown>> {
  return (payload.results ?? payload.objects ?? []) as Array<Record<string, unknown>>;
}

function queryProperties(entry: Record<string, unknown>): Record<string, { value?: unknown }> {
  const object = (entry.object ?? entry) as Record<string, unknown>;
  return (object.properties ?? {}) as Record<string, { value?: unknown }>;
}

function queryNames(payload: Record<string, unknown>): string[] {
  return queryObjects(payload).map((entry) => String(queryProperties(entry)["cmis:name"]?.value ?? ""));
}

function queryIds(payload: Record<string, unknown>): string[] {
  return queryObjects(payload).map((entry) => String(queryProperties(entry)["cmis:objectId"]?.value ?? ""));
}

function queryOutcome(payload: Record<string, unknown>): Record<string, unknown> {
  return { count: queryObjects(payload).length, ids: queryIds(payload), names: queryNames(payload), hasMoreItems: payload.hasMoreItems, numItems: payload.numItems };
}

function listOutcome(entries: BoxRestItem[]): Record<string, unknown> {
  return { count: entries.length, ids: entries.map((entry) => entry.id), names: entries.map((entry) => entry.name) };
}
