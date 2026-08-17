import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { assertExpectedUnsupported, assertNoReportFailures, countReportLines } from "./assertions.js";
import { aggregateComparisonDirectory, aggregateComparisonReports, renderComparisonAggregateCsv, renderComparisonAggregateMarkdown } from "./aggregate.js";
import type { ComparisonAggregateReport, ProtocolAggregate } from "./aggregate.js";
import { createCmisClient } from "./client.js";
import { createBoxRestClient } from "./box-rest-client.js";
import { createSideBySideComparison, measureOperation, type SideBySideComparison } from "./comparison.js";
import { parseBoolean, readTckConfig, requireDestructiveTckConfig, requireLiveReadTckConfig, requireStressTckConfig } from "./config.js";
import { buildFixtureName, buildRunId } from "./fixtures.js";
import { renderFinalHtmlReport } from "./final-html-report.js";
import { buildTckReport, reportContentType, writeTckReport } from "./report.js";
import { evaluatePerformanceWindows, parseBaselineAggregatePaths, performanceThresholdsFromEnvironment, renderPerformanceEvaluationMarkdown } from "./performance-evaluator.js";

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
  assert.equal(config.allowLiveRead, false);
  assert.equal(config.allowDestructive, false);
  assert.equal(config.allowStress, false);
  assert.equal(config.uploadReports, true);
});

test("createCmisClient builds repository-scoped Browser Binding requests", async () => {
  const requests: Array<{ url: string; body: string }> = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input, init) => {
    requests.push({ url: String(input), body: String(init?.body) });
    return new Response(JSON.stringify({ properties: { "cmis:objectId": { value: "file:1" } } }), {
      status: 201,
      headers: {
        "x-box-cmis-box-sdk-retry-count": "2",
        "x-box-cmis-relationship-timings": JSON.stringify({ "source-read": 12.5, "source-write": 24.75 })
      }
    });
  }) as typeof fetch;

  try {
    const client = createCmisClient({
      baseUrl: "http://127.0.0.1:8080/cmis/",
      repositoryId: "box",
      allowLiveRead: true,
      allowDestructive: true,
      allowStress: false,
      reportDir: "reports",
      uploadReports: false,
      boxTokenUrl: "https://api.box.com/oauth2/token",
      boxApiBaseUrl: "https://api.box.com",
      boxUploadBaseUrl: "https://upload.box.com"
    });

    const comparison = createSideBySideComparison();
    await measureOperation(comparison, "create-document", "cmis", () => client.createDocumentWithoutContent("folder:123", "Empty.txt"));
    assert.equal(requests[0]?.url, "http://127.0.0.1:8080/cmis/box/object/folder%3A123");
    assert.match(requests[0]?.body ?? "", /cmisaction=createDocument/);
    assert.match(requests[0]?.body ?? "", /propertyValue%5B1%5D=Empty\.txt/);
    assert.equal(comparison.measurements[0]?.serverRetryCount, 2);
    assert.deepEqual(comparison.measurements[0]?.serverTimings, { "source-read": 12.5, "source-write": 24.75 });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("measureOperation builds side-by-side timing summaries", async () => {
  const comparison = createSideBySideComparison();
  await measureOperation(comparison, "create-folder", "cmis", async () => "cmis-id", (id) => ({ id }));
  await measureOperation(comparison, "create-folder", "box-rest", async () => "box-id", (id) => ({ id }));

  assert.equal(comparison.measurements.length, 2);
  assert.equal(comparison.summary[0]?.operation, "create-folder");
  assert.equal(typeof comparison.summary[0]?.deltaMs, "number");
});

test("createBoxRestClient uses CCG and raw Box REST endpoints", async () => {
  const requests: Array<{ url: string; method: string }> = [];
  let folderAttempts = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input, init = {}) => {
    const url = String(input);
    requests.push({ url, method: init.method ?? "GET" });
    if (url.endsWith("/oauth2/token")) return new Response(JSON.stringify({ access_token: "secret-token" }), { status: 200 });
    if (url.endsWith("/2.0/folders")) {
      folderAttempts += 1;
      if (folderAttempts === 1) return new Response(JSON.stringify({ code: "temporarily_unavailable" }), { status: 503 });
      return new Response(JSON.stringify({ id: "folder-1", type: "folder", name: "Fixture" }), { status: 201 });
    }
    return new Response(null, { status: 204 });
  }) as typeof fetch;

  try {
    const client = await createBoxRestClient(readTckConfig({
      BOX_CMIS_AUTH_MODE: "ccg",
      BOX_CMIS_CCG_CLIENT_ID: "client-id",
      BOX_CMIS_CCG_CLIENT_SECRET: "client-secret",
      BOX_CMIS_CCG_USER_ID: "user-id"
    }));
    const comparison = createSideBySideComparison();
    await measureOperation(comparison, "create-folder", "box-rest", () => client.createFolder("parent", "Fixture"));
    await client.deleteFolder("folder-1");
    assert.equal(comparison.measurements[0]?.retryCount, 1);
    assert.equal(comparison.measurements[0]?.serverRetryCount, 0);
    assert.deepEqual(requests.map(({ url, method }) => ({ url, method })), [
      { url: "https://api.box.com/oauth2/token", method: "POST" },
      { url: "https://api.box.com/2.0/folders", method: "POST" },
      { url: "https://api.box.com/2.0/folders", method: "POST" },
      { url: "https://api.box.com/2.0/folders/folder-1", method: "DELETE" }
    ]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("requireDestructiveTckConfig blocks destructive tests by default", () => {
  const config = readTckConfig({});
  assert.throws(() => requireDestructiveTckConfig(config), /BOX_CMIS_TCK_ALLOW_DESTRUCTIVE/);
});

test("requireLiveReadTckConfig blocks live read tests by default", () => {
  const config = readTckConfig({});
  assert.throws(() => requireLiveReadTckConfig(config), /BOX_CMIS_TCK_ALLOW_LIVE_READ/);
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

test("aggregateComparisonReports calculates medians p95 deltas and retries", () => {
  const reports = [
    comparisonReport("run-1", 100, 80, 0),
    comparisonReport("run-2", 120, 70, 1),
    comparisonReport("run-3", 90, 90, 2)
  ];

  const aggregate = aggregateComparisonReports(reports, "2026-07-13T00:00:00.000Z");
  assert.equal(aggregate.sourceReportCount, 3);
  assert.deepEqual(aggregate.fixtureRootIds, ["fixture-root"]);
  assert.equal(aggregate.rows.length, 1);
  assert.deepEqual(aggregate.rows[0], {
    phase: "phase2",
    testId: "phase2.example",
    operation: "read-document",
    pairedSampleCount: 3,
    testPassCount: 3,
    testFailCount: 0,
    cmis: { sampleCount: 3, passCount: 3, failCount: 0, medianMs: 100, p95Ms: 120, meanMs: 103.33, standardDeviationMs: 12.47, coefficientOfVariation: 0.12, totalRetries: 0, maxRetries: 0, totalServerRetries: 0, maxServerRetries: 0 },
    boxRest: { sampleCount: 3, passCount: 3, failCount: 0, medianMs: 80, p95Ms: 90, meanMs: 80, standardDeviationMs: 8.16, coefficientOfVariation: 0.1, totalRetries: 3, maxRetries: 2, totalServerRetries: 0, maxServerRetries: 0 },
    deltaMs: { medianMs: 20, p95Ms: 50 },
    cmisToBoxRestRatio: { median: 1.25, p95: 1.71 },
    flags: ["insufficient-samples", "box-rest-retries"]
  });

  const markdown = renderComparisonAggregateMarkdown(aggregate);
  const csv = renderComparisonAggregateCsv(aggregate);
  assert.match(markdown, /CMIS vs Box REST Comparison Aggregate/);
  assert.match(markdown, /100\.00 ms \/ 120\.00 ms \/ 0\.12/);
  assert.match(markdown, /insufficient-samples, box-rest-retries/);
  assert.match(csv, /cmis_stddev_ms/);
  assert.match(csv, /phase2,phase2\.example,read-document,3/);
});

test("aggregates connector relationship stage timings into every report format", () => {
  const reports = [
    comparisonReport("timed-1", 100, 80, 0),
    comparisonReport("timed-2", 110, 85, 0),
    comparisonReport("timed-3", 120, 90, 0)
  ];
  const sourceReads = [20, 30, 40];
  reports.forEach((report, index) => {
    const comparison = report.results[0]?.details?.comparison as SideBySideComparison;
    comparison.measurements[0]!.serverTimings = {
      "source-read": sourceReads[index]!,
      "source-write": sourceReads[index]! * 2
    };
  });

  const aggregate = aggregateComparisonReports(reports, "2026-08-10T00:00:00.000Z");
  assert.deepEqual(aggregate.rows[0]?.serverTimings?.cmis, {
    "source-read": { sampleCount: 3, medianMs: 30, p95Ms: 40, meanMs: 30 },
    "source-write": { sampleCount: 3, medianMs: 60, p95Ms: 80, meanMs: 60 }
  });
  assert.match(renderComparisonAggregateMarkdown(aggregate), /Connector Stage Timings/);
  assert.match(renderComparisonAggregateCsv(aggregate), /source-read/);
  assert.match(renderFinalHtmlReport(aggregate), /Connector stage timings/);
});

test("final HTML report renders side-by-side metrics and advisory findings", () => {
  const baseline = performanceAggregate("2026-07-13T00:00:00.000Z", 100, []);
  const current = performanceAggregate("2026-07-14T00:00:00.000Z", 250, ["cmis-tail-spike"]);
  const evaluation = evaluatePerformanceWindows([
    { source: "baseline.json", report: baseline },
    { source: "current.json", report: current }
  ], {}, "2026-07-14T01:00:00.000Z");
  current.rows[0]!.operation = "read-<document>";
  const html = renderFinalHtmlReport(current, evaluation);

  assert.match(html, /<!doctype html>/);
  assert.match(html, /CMIS vs Box REST/);
  assert.match(html, /read-&lt;document&gt;/);
  assert.match(html, /median-regression/);
  assert.match(html, /No credentials or request bodies are included/);
});

test("report uploads select content types by artifact extension", () => {
  assert.equal(reportContentType("report.json"), "application/json");
  assert.equal(reportContentType("report.md"), "text/markdown");
  assert.equal(reportContentType("report.csv"), "text/csv");
  assert.equal(reportContentType("report.html"), "text/html");
});

test("aggregateComparisonDirectory ignores generated aggregate and evaluation JSON", async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), "cmis-tck-aggregate-"));
  try {
    await Promise.all([
      writeFile(path.join(tmp, "source.json"), JSON.stringify(comparisonReport("run-source", 100, 80, 0))),
      writeFile(path.join(tmp, "comparison-aggregate-generated.json"), "{}"),
      writeFile(path.join(tmp, "performance-evaluation-generated.json"), "{}")
    ]);
    const aggregate = await aggregateComparisonDirectory(tmp);
    assert.equal(aggregate.sourceReportCount, 1);
    assert.equal(aggregate.rows.length, 1);
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
});

test("performance evaluator reports median regressions recurring tails retries and failures without blocking", () => {
  const baseline = performanceAggregate("2026-07-13T00:00:00.000Z", 100, ["cmis-tail-spike"]);
  const current = performanceAggregate("2026-07-14T00:00:00.000Z", 250, ["cmis-tail-spike", "box-rest-tail-spike"], {
    failCount: 1,
    totalRetries: 2,
    totalServerRetries: 3
  }, 1);
  const evaluation = evaluatePerformanceWindows([
    { source: "baseline.json", report: baseline },
    { source: "current.json", report: current }
  ], {}, "2026-07-14T01:00:00.000Z");

  assert.deepEqual(evaluation.summary, {
    findingCount: 7,
    recurringTailCount: 1,
    isolatedTailCount: 1,
    medianRegressionCount: 1,
    blockingCount: 0
  });
  assert.deepEqual(evaluation.findings.map(({ kind, protocol }) => `${protocol}:${kind}`), [
    "box-rest:client-retries",
    "box-rest:failures",
    "box-rest:isolated-tail",
    "box-rest:server-retries",
    "cmis:median-regression",
    "cmis:recurring-tail",
    "comparison:test-failures"
  ]);
  assert.equal(evaluation.findings.every(({ blocking }) => blocking === false), true);
  assert.match(renderPerformanceEvaluationMarkdown(evaluation), /This evaluator is report-only/);
  assert.throws(() => evaluatePerformanceWindows([{ source: "only.json", report: current }]), /at least one baseline/);
});

test("performance evaluator parses optional benchmark baselines and threshold overrides", () => {
  assert.deepEqual(parseBaselineAggregatePaths(undefined), []);
  assert.deepEqual(parseBaselineAggregatePaths(" first.json, second.json "), ["first.json", "second.json"]);
  assert.deepEqual(performanceThresholdsFromEnvironment({
    BOX_CMIS_TCK_MEDIAN_REGRESSION_RATIO: "1.75",
    BOX_CMIS_TCK_MEDIAN_REGRESSION_ABSOLUTE_MS: "150",
    BOX_CMIS_TCK_RECURRING_TAIL_WINDOWS: "3"
  }), {
    medianRegressionRatio: 1.75,
    medianRegressionAbsoluteMs: 150,
    recurringTailWindows: 3
  });
  assert.throws(() => performanceThresholdsFromEnvironment({ BOX_CMIS_TCK_MEDIAN_REGRESSION_RATIO: "fast" }), /must be numeric/);
});

function comparisonReport(runId: string, cmisElapsedMs: number, boxElapsedMs: number, boxRetries: number) {
  return buildTckReport(runId, [{
    status: "pass",
    phase: "phase2",
    testId: "phase2.example",
    openCmisTests: ["ExampleTest"],
    coverageMode: "equivalent",
    fixtureRootId: "fixture-root",
    createdObjectCount: 0,
    deletedObjectCount: 0,
    cleanupStatus: "pass",
    retryCount: boxRetries,
    elapsedMs: cmisElapsedMs + boxElapsedMs,
    warnings: [],
    details: {
      comparison: {
        measurements: [
          { operation: "read-document", protocol: "cmis", elapsedMs: cmisElapsedMs, retryCount: 0, serverRetryCount: 0, status: "pass", outcome: {} },
          { operation: "read-document", protocol: "box-rest", elapsedMs: boxElapsedMs, retryCount: boxRetries, serverRetryCount: 0, status: "pass", outcome: {} }
        ],
        summary: []
      }
    }
  }]);
}

function performanceAggregate(
  generatedAt: string,
  cmisMedianMs: number,
  flags: string[],
  boxOverrides: Partial<ProtocolAggregate> = {},
  testFailCount = 0
): ComparisonAggregateReport {
  const protocol = (medianMs: number): ProtocolAggregate => ({
    sampleCount: 10,
    passCount: 10,
    failCount: 0,
    medianMs,
    p95Ms: medianMs * 2.5,
    meanMs: medianMs,
    standardDeviationMs: 10,
    coefficientOfVariation: 0.1,
    totalRetries: 0,
    maxRetries: 0,
    totalServerRetries: 0,
    maxServerRetries: 0
  });
  return {
    generatedAt,
    sourceReportCount: 10,
    fixtureRootIds: ["fixture-root"],
    rows: [{
      phase: "phase2",
      testId: "phase2.example",
      operation: "read-document",
      pairedSampleCount: 10,
      testPassCount: 10 - testFailCount,
      testFailCount,
      cmis: protocol(cmisMedianMs),
      boxRest: { ...protocol(100), ...boxOverrides },
      deltaMs: {},
      cmisToBoxRestRatio: {},
      flags
    }]
  };
}
