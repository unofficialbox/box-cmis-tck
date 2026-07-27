import { readFile } from "node:fs/promises";
import path from "node:path";
import type { ComparisonAggregateReport } from "./aggregate.js";
import { readTckConfig } from "./config.js";
import { writeFinalHtmlReport } from "./final-html-report.js";
import { evaluatePerformanceWindows, performanceThresholdsFromEnvironment, writePerformanceEvaluationArtifacts } from "./performance-evaluator.js";
import { uploadReportToFixtureFolder } from "./report.js";

const sources = process.argv.slice(2);
if (sources.length < 2) {
  throw new Error("Usage: bun run report:evaluate -- <baseline-aggregate.json> [additional-baseline.json ...] <current-aggregate.json>");
}

const windows = await Promise.all(sources.map(async (source) => ({
  source,
  report: JSON.parse(await readFile(source, "utf8")) as ComparisonAggregateReport
})));
const evaluation = evaluatePerformanceWindows(windows, performanceThresholdsFromEnvironment(process.env));
const outputDir = path.dirname(sources.at(-1)!);
const reportPaths = await writePerformanceEvaluationArtifacts(outputDir, evaluation);
const htmlPath = await writeFinalHtmlReport(outputDir, windows.at(-1)!.report, evaluation);
const config = readTckConfig();
if (config.uploadReports) {
  for (const fixtureRootId of windows.at(-1)!.report.fixtureRootIds) {
    for (const reportPath of [...Object.values(reportPaths), htmlPath]) await uploadReportToFixtureFolder(reportPath, fixtureRootId);
  }
}
console.log(JSON.stringify({ reportPaths, htmlPath, mode: evaluation.mode, summary: evaluation.summary, fixtureRootIds: windows.at(-1)!.report.fixtureRootIds }));
