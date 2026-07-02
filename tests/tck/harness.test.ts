import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { assertExpectedUnsupported, assertNoReportFailures, countReportLines } from "./assertions.js";
import { createCmisClient } from "./client.js";
import { parseBoolean, readTckConfig, requireDestructiveTckConfig, requireStressTckConfig } from "./config.js";
import { buildFixtureName, buildRunId } from "./fixtures.js";
import { buildTckReport, writeTckReport } from "./report.js";

test("parseBoolean accepts common environment forms", () => {
  assert.equal(parseBoolean(undefined), false);
  assert.equal(parseBoolean("true"), true);
  assert.equal(parseBoolean("1"), true);
  assert.equal(parseBoolean("off", true), false);
  assert.throws(() => parseBoolean("maybe"), /Invalid boolean value/);
});

test("readTckConfig applies safe defaults", () => {
  const config = readTckConfig({});
  assert.equal(config.baseUrl, "http://127.0.0.1:8080/cmis");
  assert.equal(config.repositoryId, "box");
  assert.equal(config.allowDestructive, false);
  assert.equal(config.allowStress, false);
});

test("createCmisClient builds repository-scoped Browser Binding requests", async () => {
  const requests: Array<{ url: string; body: string }> = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input, init) => {
    requests.push({ url: String(input), body: String(init?.body) });
    return new Response(JSON.stringify({ properties: { "cmis:objectId": { value: "file:1" } } }), { status: 201 });
  }) as typeof fetch;

  try {
    const client = createCmisClient({
      baseUrl: "http://127.0.0.1:8080/cmis/",
      repositoryId: "box",
      allowDestructive: true,
      allowStress: false,
      reportDir: "reports"
    });

    await client.createDocumentWithoutContent("folder:123", "Empty.txt");
    assert.equal(requests[0]?.url, "http://127.0.0.1:8080/cmis/box/object/folder%3A123");
    assert.match(requests[0]?.body ?? "", /cmisaction=createDocument/);
    assert.match(requests[0]?.body ?? "", /propertyValue%5B1%5D=Empty\.txt/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("requireDestructiveTckConfig blocks destructive tests by default", () => {
  const config = readTckConfig({});
  assert.throws(() => requireDestructiveTckConfig(config), /BOX_CMIS_TCK_ALLOW_DESTRUCTIVE/);
});

test("requireStressTckConfig requires stress opt-in", () => {
  const config = readTckConfig({
    BOX_CMIS_TCK_ALLOW_DESTRUCTIVE: "true",
    BOX_CMIS_TCK_RUN_ROOT_ID: "123"
  });
  assert.throws(() => requireStressTckConfig(config), /BOX_CMIS_TCK_ALLOW_STRESS/);
});

test("assertExpectedUnsupported validates explicit unsupported paths", () => {
  assertExpectedUnsupported({ exception: "notSupported", message: "appendContentStream is not supported" }, { messageIncludes: "appendContentStream" });
  assert.throws(() => assertExpectedUnsupported({ exception: "runtime" }), /notSupported/);
});

test("OpenCMIS report helpers count and reject FAILURE lines", () => {
  const log = "INFO: ok\n  WARNING: expected skip\n  FAILURE: compatibility issue\n";
  assert.deepEqual(countReportLines(log), { failures: 1, warnings: 1 });
  assert.throws(() => assertNoReportFailures(log), /FAILURE lines/);
});

test("fixture names are deterministic and bounded", () => {
  const runId = buildRunId(new Date("2026-07-02T12:34:56Z"));
  assert.equal(runId, "cmis-tck-20260702123456");
  assert.equal(buildFixtureName(runId, "Phase 2", "Create Document Without Content"), "cmis-tck-20260702123456-phase-2-create-document-without-content");
});

test("buildTckReport summarizes results and writes JSON", async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), "cmis-tck-report-"));
  try {
    const report = buildTckReport(
      "run-1",
      [
        {
          status: "pass",
          phase: "phase2",
          testId: "phase2.createDocumentWithoutContent",
          openCmisTests: ["CreateDocumentWithoutContent"],
          coverageMode: "equivalent",
          createdObjectCount: 1,
          deletedObjectCount: 1,
          cleanupStatus: "pass",
          retryCount: 0,
          elapsedMs: 10,
          warnings: []
        },
        {
          status: "blocked",
          phase: "phase2",
          testId: "phase2.deleteTree",
          openCmisTests: ["DeleteTreeTest"],
          coverageMode: "reduced-volume",
          createdObjectCount: 0,
          deletedObjectCount: 0,
          cleanupStatus: "skipped",
          retryCount: 0,
          elapsedMs: 0,
          warnings: ["destructive tests disabled"]
        }
      ],
      "2026-07-02T00:00:00.000Z"
    );

    assert.deepEqual(report.summary, { total: 2, pass: 1, fail: 0, blocked: 1 });
    const reportPath = await writeTckReport(tmp, report);
    const parsed = JSON.parse(await readFile(reportPath, "utf8"));
    assert.equal(parsed.runId, "run-1");
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
});
