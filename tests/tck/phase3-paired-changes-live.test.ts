import assert from "node:assert/strict";
import test from "node:test";
import { createBoxRestClient, type BoxRestEventsPage } from "./box-rest-client.js";
import { createCmisClient } from "./client.js";
import { createSideBySideComparison, measureOperation } from "./comparison.js";
import { readTckConfig, requireDestructiveTckConfig } from "./config.js";
import { buildFixtureName, buildRunId } from "./fixtures.js";
import { recordTimedResult } from "./report.js";

const config = readTckConfig();
const liveChangesTest = config.allowDestructive ? test : test.skip;

liveChangesTest("phase3.contentChanges compares CMIS changes with Box Events", { timeout: 120_000 }, async () => {
  requireDestructiveTckConfig(config);
  const rootId = config.runRootId ?? config.parentRootId;
  assert.ok(rootId, "Expected BOX_CMIS_TCK_RUN_ROOT_ID or BOX_CMIS_TCK_PARENT_ROOT_ID");
  const cmis = createCmisClient(config);
  const box = await createBoxRestClient(config);
  const comparison = createSideBySideComparison();
  const runId = buildRunId();
  let fileId: string | undefined;

  await recordTimedResult({
    runId: `${runId}-phase3-content-changes-comparison`, reportDir: config.reportDir, phase: "phase3",
    testId: "phase3.contentChanges", openCmisTests: ["ContentChangesSmokeTest"], coverageMode: "equivalent",
    fixtureRootId: rootId, createdObjectCount: 1, deletedObjectCount: 1, cleanupStatus: "pass",
    details: {
      fixtureShape: "one Box REST file event replayed from the same changes-stream token through both protocols",
      semanticDifference: "Raw Box Events may encode next_stream_position as a number; CMIS change-log tokens are strings",
      comparison
    }
  }, async () => {
    try {
      const baseline = await box.getEvents({ streamPosition: "now", limit: 1 });
      assert.notEqual(baseline.next_stream_position, undefined, "Expected Box Events baseline stream position");
      const baselineToken = String(baseline.next_stream_position);
      const fixture = await box.uploadFile(rootId, `${buildFixtureName(runId, "phase3", "changes")}.txt`, "phase3 content changes");
      fileId = fixture.id;

      await waitForEvent(box, baselineToken, fileId);

      const cmisChanges = await measureOperation(comparison, "read-content-changes", "cmis", () =>
        cmis.getContentChanges(baselineToken, { maxItems: "100", filter: "cmis:objectId,cmis:name" }),
      (payload) => cmisOutcome(payload, fileId!));
      const boxChanges = await measureOperation(comparison, "read-content-changes", "box-rest", () =>
        box.getEvents({ streamPosition: baselineToken, limit: 100 }),
      (payload) => boxOutcome(payload, fileId!));

      assert.equal(cmisObjectIds(cmisChanges).includes(`file:${fileId}`), true, "CMIS changes omitted the fixture file");
      assert.equal(boxChanges.entries.some((event) => event.source?.id === fileId), true, "Box Events omitted the fixture file");
      assert.equal(typeof cmisChanges.latestChangeLogToken, "string");
      assert.notEqual(boxChanges.next_stream_position, undefined);
    } finally {
      if (fileId) await box.deleteFile(fileId);
    }
  });
});

async function waitForEvent(box: Awaited<ReturnType<typeof createBoxRestClient>>, token: string, fileId: string): Promise<void> {
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const page = await box.getEvents({ streamPosition: token, limit: 100 });
    if (page.entries.some((event) => event.source?.id === fileId)) return;
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  assert.fail(`Box Events did not expose fixture file ${fileId} within the polling window`);
}

function cmisObjects(payload: Record<string, unknown>): Array<Record<string, unknown>> {
  return (payload.objects ?? []) as Array<Record<string, unknown>>;
}

function cmisObjectIds(payload: Record<string, unknown>): string[] {
  return cmisObjects(payload).map((entry) => {
    const properties = entry.properties as Record<string, { value?: unknown }> | undefined;
    return String(properties?.["cmis:objectId"]?.value ?? "");
  });
}

function cmisOutcome(payload: Record<string, unknown>, fileId: string): Record<string, unknown> {
  const target = cmisObjects(payload).find((entry) => {
    const properties = entry.properties as Record<string, { value?: unknown }> | undefined;
    return properties?.["cmis:objectId"]?.value === `file:${fileId}`;
  });
  return {
    count: cmisObjects(payload).length,
    targetFound: Boolean(target),
    targetChangeType: (target?.changeEventInfo as Record<string, unknown> | undefined)?.changeType,
    nextToken: payload.latestChangeLogToken ?? payload.changeLogToken
  };
}

function boxOutcome(payload: BoxRestEventsPage, fileId: string): Record<string, unknown> {
  const target = payload.entries.find((event) => event.source?.id === fileId);
  return {
    count: payload.entries.length,
    targetFound: Boolean(target),
    targetEventType: target?.event_type,
    nextToken: payload.next_stream_position
  };
}
