import assert from "node:assert/strict";
import test from "node:test";
import { createBoxRestClient, type BoxRestItem } from "./box-rest-client.js";
import { createCmisClient } from "./client.js";
import { createSideBySideComparison, measureOperation } from "./comparison.js";
import { readTckConfig, requireDestructiveTckConfig } from "./config.js";
import { buildFixtureName, buildRunId } from "./fixtures.js";
import { recordTimedResult } from "./report.js";

const config = readTckConfig();
const live = config.allowDestructive ? test : test.skip;

live("phase3.metadataInTree compares metadata post-filter traversal", { timeout: 180_000 }, async () => {
  requireDestructiveTckConfig(config);
  const fixtureRootId = config.runRootId ?? config.parentRootId;
  assert.ok(fixtureRootId);
  const metadata = metadataFixtureFromEnvironment();
  const cmis = createCmisClient(config);
  const box = await createBoxRestClient(config);
  const comparison = createSideBySideComparison();
  const runId = buildRunId();
  const matchValue = `${runId}-metadata-match`;
  let cmisTreeRootId: string | undefined;
  let boxTreeRootId: string | undefined;

  await recordTimedResult({
    runId: `${runId}-phase3-metadata-in-tree-comparison`,
    reportDir: config.reportDir,
    phase: "phase3",
    testId: "phase3.metadataInTree",
    openCmisTests: ["QueryInTreeTest"],
    coverageMode: "equivalent",
    fixtureRootId,
    createdObjectCount: 14,
    deletedObjectCount: 14,
    cleanupStatus: "pass",
    details: {
      fixtureShape: "two isolated two-level trees with five documents each and one matching metadata instance per tree",
      semanticDifference: "CMIS evaluates a metadata OR predicate over IN_TREE; Box REST lists the equivalent tree with the exact metadata template field and applies the predicate locally",
      comparison
    }
  }, async () => {
    try {
      const cmisTree = await createMetadataTree(box, fixtureRootId, buildFixtureName(runId, "phase3", "metadata-tree-cmis"), metadata, matchValue);
      cmisTreeRootId = cmisTree.rootId;
      const boxTree = await createMetadataTree(box, fixtureRootId, buildFixtureName(runId, "phase3", "metadata-tree-box"), metadata, matchValue);
      boxTreeRootId = boxTree.rootId;

      const statement = `SELECT cmis:objectId, cmis:name, ${metadata.propertyId} FROM cmis:document ` +
        `WHERE IN_TREE('folder:${sqlLiteral(cmisTree.rootId)}') AND ${metadata.propertyId} = '${sqlLiteral(matchValue)}' ` +
        `OR cmis:name = '${sqlLiteral(`${runId}-never-match.txt`)}'`;
      const cmisResult = await measureOperation(comparison, "metadata-in-tree-post-filter", "cmis", () =>
        cmis.query(statement), queryOutcome);
      const boxResult = await measureOperation(comparison, "metadata-in-tree-post-filter", "box-rest", () =>
        listMetadataTree(box, boxTree.rootId, metadata, matchValue), (entries) => ({
          count: entries.length,
          ids: entries.map((entry) => entry.id),
          names: entries.map((entry) => entry.name)
        }));

      assert.equal(queryObjects(cmisResult).length, 1);
      assert.equal(boxResult.length, 1);
    } finally {
      if (cmisTreeRootId) await box.deleteFolder(cmisTreeRootId, true);
      if (boxTreeRootId) await box.deleteFolder(boxTreeRootId, true);
    }
  });
});

interface MetadataFixture {
  scope: string;
  responseScope: string;
  templateKey: string;
  fieldKey: string;
  propertyId: string;
  listField: string;
}

function metadataFixtureFromEnvironment(): MetadataFixture {
  const configured = process.env.BOX_CMIS_METADATA_TEMPLATES?.split(",").map((entry) => entry.trim()).find(Boolean);
  assert.ok(configured, "BOX_CMIS_METADATA_TEMPLATES must configure at least one metadata template");
  const [scope, templateKey, ...fieldParts] = configured.split(":").map((part) => part.trim());
  const fieldKey = fieldParts.join(":").split(";")[0]?.split("=")[0]?.trim();
  assert.ok(scope && templateKey && fieldKey, "The first BOX_CMIS_METADATA_TEMPLATES entry must configure at least one field");
  const enterpriseId = process.env.BOX_CMIS_ENTERPRISE_ID ?? process.env.BOX_CMIS_CCG_ENTERPRISE_ID;
  const responseScope = scope === "enterprise" ? `enterprise_${enterpriseId ?? ""}` : scope;
  assert.ok(scope !== "enterprise" || enterpriseId, "BOX_CMIS_ENTERPRISE_ID is required for enterprise metadata traversal proof");
  const propertyPrefix = `box:${scope}:${templateKey.replace(/[^A-Za-z0-9_]/g, "_")}`;
  return {
    scope,
    responseScope,
    templateKey,
    fieldKey,
    propertyId: `${propertyPrefix}_${fieldKey.replace(/[^A-Za-z0-9_]/g, "_")}`,
    listField: `metadata.${responseScope}.${templateKey}`
  };
}

async function createMetadataTree(
  box: Awaited<ReturnType<typeof createBoxRestClient>>,
  parentId: string,
  name: string,
  metadata: MetadataFixture,
  matchValue: string
): Promise<{ rootId: string }> {
  const root = await box.createFolder(parentId, name);
  const child = await box.createFolder(root.id, "nested");
  const documents = await Promise.all(Array.from({ length: 5 }, (_, index) =>
    box.uploadFile(child.id, `doc-${index + 1}.txt`, `metadata traversal ${index + 1}`)
  ));
  const metadataResponse = await box.createFileMetadata(documents[2]!.id, metadata.scope, metadata.templateKey, {
    [metadata.fieldKey]: matchValue
  });
  assert.equal(metadataResponse.status, 201, JSON.stringify(metadataResponse.payload));
  return { rootId: root.id };
}

async function listMetadataTree(
  box: Awaited<ReturnType<typeof createBoxRestClient>>,
  rootId: string,
  metadata: MetadataFixture,
  matchValue: string
): Promise<BoxRestItem[]> {
  const rootPage = await box.listFolderItems(rootId, { fields: ["id", "type", "name", metadata.listField], limit: 1000 });
  const childPages = await Promise.all(rootPage.entries.filter((entry) => entry.type === "folder").map((folder) =>
    box.listFolderItems(folder.id, { fields: ["id", "type", "name", metadata.listField], limit: 1000 })
  ));
  return [...rootPage.entries, ...childPages.flatMap((page) => page.entries)].filter((entry) =>
    metadataValue(entry, metadata) === matchValue
  );
}

function metadataValue(item: BoxRestItem, metadata: MetadataFixture): unknown {
  const raw = item as BoxRestItem & { metadata?: Record<string, Record<string, Record<string, unknown>>> };
  return raw.metadata?.[metadata.responseScope]?.[metadata.templateKey]?.[metadata.fieldKey];
}

function queryObjects(payload: Record<string, unknown>): Array<Record<string, unknown>> {
  return (payload.results ?? payload.objects ?? []) as Array<Record<string, unknown>>;
}

function queryOutcome(payload: Record<string, unknown>): Record<string, unknown> {
  return { count: queryObjects(payload).length, hasMoreItems: payload.hasMoreItems, numItems: payload.numItems };
}

function sqlLiteral(value: string): string {
  return value.replaceAll("'", "''");
}
