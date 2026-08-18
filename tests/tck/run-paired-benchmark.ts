import { readFile } from "node:fs/promises";
import path from "node:path";
import { aggregateComparisonDirectory, writeComparisonAggregateArtifacts, type ComparisonAggregateReport } from "./aggregate.js";
import { readTckConfig, requireDestructiveTckConfig } from "./config.js";
import { buildRunId } from "./fixtures.js";
import { writeFinalHtmlReport } from "./final-html-report.js";
import { evaluatePerformanceWindows, parseBaselineAggregatePaths, performanceThresholdsFromEnvironment, writePerformanceEvaluationArtifacts, type PerformanceEvaluation } from "./performance-evaluator.js";
import { uploadReportToFixtureFolder } from "./report.js";

const pairedTestFiles = [
  "tests/tck/phase2-paired-live.test.ts",
  "tests/tck/phase2-paired-advanced-live.test.ts",
  "tests/tck/phase2-paired-model-live.test.ts",
  "tests/tck/phase2-write-live.test.ts",
  "tests/tck/phase3-paired-query-live.test.ts",
  "tests/tck/phase3-paired-metadata-query-live.test.ts",
  "tests/tck/phase3-paired-changes-live.test.ts"
];

const config = readTckConfig();
requireDestructiveTckConfig(config);
const repetitions = parseRepetitions(process.env.BOX_CMIS_TCK_BENCHMARK_RUNS);
const batchId = `${buildRunId()}-paired-benchmark`;
const reportDir = path.join(config.reportDir, batchId);

const failures: Array<{ repetition: number; testFile: string; exitCode: number }> = [];
for (let repetition = 1; repetition <= repetitions; repetition += 1) {
  console.log(`Paired benchmark repetition ${repetition}/${repetitions}`);
  for (const testFile of pairedTestFiles) {
    const child = Bun.spawn([process.execPath, "test", testFile], {
      cwd: process.cwd(),
      env: { ...process.env, BOX_CMIS_TCK_REPORT_DIR: reportDir },
      stdout: "inherit",
      stderr: "inherit"
    });
    const exitCode = await child.exited;
    if (exitCode !== 0) failures.push({ repetition, testFile, exitCode });
  }
}

const aggregate = await aggregateComparisonDirectory(reportDir);
const aggregatePaths = await writeComparisonAggregateArtifacts(reportDir, aggregate);
for (const fixtureRootId of aggregate.fixtureRootIds) {
  for (const aggregatePath of Object.values(aggregatePaths)) {
    await uploadReportToFixtureFolder(aggregatePath, fixtureRootId);
  }
}
const baselinePaths = parseBaselineAggregatePaths(process.env.BOX_CMIS_TCK_BASELINE_AGGREGATES);
let evaluationResult: { reportPaths: { jsonPath: string; markdownPath: string }; summary: ReturnType<typeof evaluatePerformanceWindows>["summary"] } | undefined;
let finalEvaluation: PerformanceEvaluation | undefined;
if (baselinePaths.length > 0) {
  const baselineWindows = await Promise.all(baselinePaths.map(async (source) => ({
    source,
    report: JSON.parse(await readFile(source, "utf8")) as ComparisonAggregateReport
  })));
  const evaluation = evaluatePerformanceWindows([
    ...baselineWindows,
    { source: aggregatePaths.jsonPath, report: aggregate }
  ], performanceThresholdsFromEnvironment(process.env));
  const reportPaths = await writePerformanceEvaluationArtifacts(reportDir, evaluation);
  for (const fixtureRootId of aggregate.fixtureRootIds) {
    for (const reportPath of Object.values(reportPaths)) await uploadReportToFixtureFolder(reportPath, fixtureRootId);
  }
  evaluationResult = { reportPaths, summary: evaluation.summary };
  finalEvaluation = evaluation;
}
const htmlPath = await writeFinalHtmlReport(reportDir, aggregate, finalEvaluation);
for (const fixtureRootId of aggregate.fixtureRootIds) await uploadReportToFixtureFolder(htmlPath, fixtureRootId);
console.log(JSON.stringify({ batchId, repetitions, aggregatePaths, evaluation: evaluationResult, htmlPath, sourceReportCount: aggregate.sourceReportCount, rowCount: aggregate.rows.length, fixtureRootIds: aggregate.fixtureRootIds, failures }));
if (failures.length > 0) {
  throw new Error(`Paired benchmark completed with ${failures.length} failed test-file runs; aggregate report was still uploaded`);
}

function parseRepetitions(value: string | undefined): number {
  const repetitions = Number(value ?? "3");
  if (!Number.isInteger(repetitions) || repetitions < 2 || repetitions > 20) {
    throw new Error("BOX_CMIS_TCK_BENCHMARK_RUNS must be an integer from 2 through 20");
  }
  return repetitions;
}
