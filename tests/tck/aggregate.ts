import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { OperationMeasurement, SideBySideComparison } from "./comparison.js";
import type { TckReport, TckResult } from "./report.js";

export interface ProtocolAggregate {
  sampleCount: number;
  passCount: number;
  failCount: number;
  medianMs?: number;
  p95Ms?: number;
  meanMs?: number;
  standardDeviationMs?: number;
  coefficientOfVariation?: number;
  totalRetries: number;
  maxRetries: number;
  totalServerRetries: number;
  maxServerRetries: number;
}

export interface ComparisonAggregateRow {
  phase: string;
  testId: string;
  operation: string;
  pairedSampleCount: number;
  testPassCount: number;
  testFailCount: number;
  cmis: ProtocolAggregate;
  boxRest: ProtocolAggregate;
  deltaMs: { medianMs?: number; p95Ms?: number };
  cmisToBoxRestRatio: { median?: number; p95?: number };
  serverTimings?: {
    cmis: Record<string, StageTimingAggregate>;
    boxRest: Record<string, StageTimingAggregate>;
  };
  flags: string[];
}

export interface StageTimingAggregate {
  sampleCount: number;
  medianMs: number;
  p95Ms: number;
  meanMs: number;
}

export interface ComparisonAggregateReport {
  generatedAt: string;
  sourceReportCount: number;
  fixtureRootIds: string[];
  rows: ComparisonAggregateRow[];
}

interface ResultComparison {
  phase: string;
  testId: string;
  status: TckResult["status"];
  comparison: SideBySideComparison;
}

export function aggregateComparisonReports(
  reports: TckReport[],
  generatedAt = new Date().toISOString()
): ComparisonAggregateReport {
  const comparisons = reports.flatMap((report) => report.results.flatMap(resultComparison));
  const keys = [...new Set(comparisons.flatMap(({ phase, testId, comparison }) =>
    comparison.measurements.map(({ operation }) => JSON.stringify([phase, testId, operation]))
  ))].sort();

  const rows = keys.map((key): ComparisonAggregateRow => {
    const [phase, testId, operation] = JSON.parse(key) as [string, string, string];
    const measurements = comparisons
      .filter((entry) => entry.phase === phase && entry.testId === testId)
      .flatMap(({ comparison }) => comparison.measurements.filter((entry) => entry.operation === operation));
    const matchingResults = comparisons.filter((entry) => entry.phase === phase && entry.testId === testId);
    const cmis = measurements.filter(({ protocol }) => protocol === "cmis");
    const boxRest = measurements.filter(({ protocol }) => protocol === "box-rest");
    const pairs = comparisons
      .filter((entry) => entry.phase === phase && entry.testId === testId)
      .flatMap(({ comparison }) => {
        const cmisEntry = comparison.measurements.find((entry) => entry.operation === operation && entry.protocol === "cmis" && entry.status === "pass");
        const boxEntry = comparison.measurements.find((entry) => entry.operation === operation && entry.protocol === "box-rest" && entry.status === "pass");
        return cmisEntry && boxEntry ? [{ cmis: cmisEntry.elapsedMs, boxRest: boxEntry.elapsedMs }] : [];
      });
    const cmisAggregate = protocolAggregate(cmis);
    const boxRestAggregate = protocolAggregate(boxRest);
    const serverTimings = { cmis: aggregateServerTimings(cmis), boxRest: aggregateServerTimings(boxRest) };
    const hasServerTimings = Object.keys(serverTimings.cmis).length > 0 || Object.keys(serverTimings.boxRest).length > 0;
    const ratio = distribution(pairs.filter((pair) => pair.boxRest > 0).map((pair) => pair.cmis / pair.boxRest));
    return {
      phase,
      testId,
      operation,
      pairedSampleCount: pairs.length,
      testPassCount: matchingResults.filter(({ status }) => status === "pass").length,
      testFailCount: matchingResults.filter(({ status }) => status === "fail").length,
      cmis: cmisAggregate,
      boxRest: boxRestAggregate,
      deltaMs: elapsedDistribution(pairs.map((pair) => pair.cmis - pair.boxRest)),
      cmisToBoxRestRatio: ratio,
      ...(hasServerTimings ? { serverTimings } : {}),
      flags: aggregateFlags(pairs.length, matchingResults.filter(({ status }) => status === "fail").length, cmisAggregate, boxRestAggregate, ratio.median)
    };
  });

  return {
    generatedAt,
    sourceReportCount: comparisons.length,
    fixtureRootIds: [...new Set(reports.flatMap((report) => report.results.map((result) => result.fixtureRootId).filter((id): id is string => Boolean(id))))].sort(),
    rows
  };
}

export async function aggregateComparisonDirectory(reportDir: string): Promise<ComparisonAggregateReport> {
  const names = (await readdir(reportDir)).filter((name) =>
    name.endsWith(".json") && !name.startsWith("comparison-aggregate-") && !name.startsWith("performance-evaluation-")
  );
  const reports = await Promise.all(names.map(async (name) => JSON.parse(await readFile(path.join(reportDir, name), "utf8")) as TckReport));
  return aggregateComparisonReports(reports);
}

export async function writeComparisonAggregate(reportDir: string, report: ComparisonAggregateReport): Promise<string> {
  return (await writeComparisonAggregateArtifacts(reportDir, report)).jsonPath;
}

export async function writeComparisonAggregateArtifacts(
  reportDir: string,
  report: ComparisonAggregateReport
): Promise<{ jsonPath: string; markdownPath: string; csvPath: string }> {
  await mkdir(reportDir, { recursive: true });
  const timestamp = report.generatedAt.replace(/[-:.TZ]/g, "").slice(0, 14);
  const basePath = path.join(reportDir, `comparison-aggregate-${timestamp}`);
  const jsonPath = `${basePath}.json`;
  const markdownPath = `${basePath}.md`;
  const csvPath = `${basePath}.csv`;
  await Promise.all([
    writeFile(jsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf8"),
    writeFile(markdownPath, renderComparisonAggregateMarkdown(report), "utf8"),
    writeFile(csvPath, renderComparisonAggregateCsv(report), "utf8")
  ]);
  return { jsonPath, markdownPath, csvPath };
}

export function renderComparisonAggregateMarkdown(report: ComparisonAggregateReport): string {
  const lines = [
    "# CMIS vs Box REST Comparison Aggregate",
    "",
    `Generated: ${report.generatedAt}`,
    `Source reports: ${report.sourceReportCount}`,
    `Fixture roots: ${report.fixtureRootIds.join(", ") || "none"}`,
    "",
    "| Phase | Test | Operation | Samples | Tests pass / fail | CMIS median / p95 / CV | Box REST median / p95 / CV | Delta median | Ratio median | Client retries CMIS / Box | Server retries CMIS / Box | Flags |",
    "| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |"
  ];
  for (const row of report.rows) {
    lines.push(`| ${markdownCell(row.phase)} | ${markdownCell(row.testId)} | ${markdownCell(row.operation)} | ${row.pairedSampleCount} | ${row.testPassCount} / ${row.testFailCount} | ${protocolSummary(row.cmis)} | ${protocolSummary(row.boxRest)} | ${formatMs(row.deltaMs.medianMs)} | ${formatRatio(row.cmisToBoxRestRatio.median)} | ${row.cmis.totalRetries} / ${row.boxRest.totalRetries} | ${row.cmis.totalServerRetries} / ${row.boxRest.totalServerRetries} | ${row.flags.map(markdownCell).join(", ") || "none"} |`);
  }
  const timingRows = report.rows.flatMap((row) => [
    ...Object.entries(row.serverTimings?.cmis ?? {}).map(([stage, timing]) => ({ row, protocol: "CMIS", stage, timing })),
    ...Object.entries(row.serverTimings?.boxRest ?? {}).map(([stage, timing]) => ({ row, protocol: "Box REST", stage, timing }))
  ]);
  if (timingRows.length > 0) {
    lines.push(
      "",
      "## Connector Stage Timings",
      "",
      "| Test | Operation | Protocol | Stage | Samples | Median | p95 | Mean |",
      "| --- | --- | --- | --- | ---: | ---: | ---: | ---: |"
    );
    for (const { row, protocol, stage, timing } of timingRows) {
      lines.push(`| ${markdownCell(row.testId)} | ${markdownCell(row.operation)} | ${protocol} | ${markdownCell(stage)} | ${timing.sampleCount} | ${formatMs(timing.medianMs)} | ${formatMs(timing.p95Ms)} | ${formatMs(timing.meanMs)} |`);
    }
  }
  lines.push("", "Flags use fixed review thresholds: TCK result failures, unpaired operations, fewer than 10 paired samples, protocol failures or retries, coefficient of variation at least 0.50 on operations averaging at least 50 ms, p95 over twice the median with at least 50 ms absolute separation, or a median protocol ratio at least 2x apart.", "");
  return lines.join("\n");
}

export function renderComparisonAggregateCsv(report: ComparisonAggregateReport): string {
  const header = [
    "phase", "test_id", "operation", "paired_samples", "test_pass", "test_fail",
    "cmis_pass", "cmis_fail", "cmis_median_ms", "cmis_p95_ms", "cmis_mean_ms", "cmis_stddev_ms", "cmis_cv", "cmis_total_retries", "cmis_max_retries", "cmis_total_server_retries", "cmis_max_server_retries",
    "box_rest_pass", "box_rest_fail", "box_rest_median_ms", "box_rest_p95_ms", "box_rest_mean_ms", "box_rest_stddev_ms", "box_rest_cv", "box_rest_total_retries", "box_rest_max_retries", "box_rest_total_server_retries", "box_rest_max_server_retries",
    "delta_median_ms", "delta_p95_ms", "ratio_median", "ratio_p95", "cmis_server_timings_json", "box_rest_server_timings_json", "flags"
  ];
  const rows = report.rows.map((row) => [
    row.phase, row.testId, row.operation, row.pairedSampleCount, row.testPassCount, row.testFailCount,
    row.cmis.passCount, row.cmis.failCount, row.cmis.medianMs, row.cmis.p95Ms, row.cmis.meanMs, row.cmis.standardDeviationMs, row.cmis.coefficientOfVariation, row.cmis.totalRetries, row.cmis.maxRetries, row.cmis.totalServerRetries, row.cmis.maxServerRetries,
    row.boxRest.passCount, row.boxRest.failCount, row.boxRest.medianMs, row.boxRest.p95Ms, row.boxRest.meanMs, row.boxRest.standardDeviationMs, row.boxRest.coefficientOfVariation, row.boxRest.totalRetries, row.boxRest.maxRetries, row.boxRest.totalServerRetries, row.boxRest.maxServerRetries,
    row.deltaMs.medianMs, row.deltaMs.p95Ms, row.cmisToBoxRestRatio.median, row.cmisToBoxRestRatio.p95,
    JSON.stringify(row.serverTimings?.cmis ?? {}), JSON.stringify(row.serverTimings?.boxRest ?? {}), row.flags.join(";")
  ]);
  return `${[header, ...rows].map((row) => row.map(csvCell).join(",")).join("\n")}\n`;
}

function resultComparison(result: TckResult): ResultComparison[] {
  const comparison = result.details?.comparison as SideBySideComparison | undefined;
  if (!comparison || !Array.isArray(comparison.measurements)) return [];
  return [{ phase: result.phase, testId: result.testId, status: result.status, comparison }];
}

function protocolAggregate(measurements: OperationMeasurement[]): ProtocolAggregate {
  const passed = measurements.filter(({ status }) => status === "pass");
  const retryCounts = measurements.map(({ retryCount }) => retryCount ?? 0);
  const serverRetryCounts = measurements.map(({ serverRetryCount }) => serverRetryCount ?? 0);
  const elapsed = passed.map(({ elapsedMs }) => elapsedMs);
  const mean = elapsed.length > 0 ? elapsed.reduce((sum, value) => sum + value, 0) / elapsed.length : undefined;
  const standardDeviation = mean === undefined ? undefined : Math.sqrt(elapsed.reduce((sum, value) => sum + ((value - mean) ** 2), 0) / elapsed.length);
  return {
    sampleCount: measurements.length,
    passCount: passed.length,
    failCount: measurements.length - passed.length,
    ...elapsedDistribution(elapsed),
    ...(mean === undefined ? {} : { meanMs: round(mean) }),
    ...(standardDeviation === undefined ? {} : { standardDeviationMs: round(standardDeviation) }),
    ...(mean === undefined || mean === 0 || standardDeviation === undefined ? {} : { coefficientOfVariation: round(standardDeviation / mean) }),
    totalRetries: retryCounts.reduce((sum, count) => sum + count, 0),
    maxRetries: Math.max(0, ...retryCounts),
    totalServerRetries: serverRetryCounts.reduce((sum, count) => sum + count, 0),
    maxServerRetries: Math.max(0, ...serverRetryCounts)
  };
}

function aggregateServerTimings(measurements: OperationMeasurement[]): Record<string, StageTimingAggregate> {
  const stages = [...new Set(measurements.flatMap((measurement) => Object.keys(measurement.serverTimings ?? {})))].sort();
  return Object.fromEntries(stages.flatMap((stage) => {
    const values = measurements.flatMap((measurement) => {
      const value = measurement.serverTimings?.[stage];
      return measurement.status === "pass" && value !== undefined ? [value] : [];
    });
    const timingDistribution = distribution(values);
    if (values.length === 0 || timingDistribution.median === undefined || timingDistribution.p95 === undefined) return [];
    return [[stage, {
      sampleCount: values.length,
      medianMs: timingDistribution.median,
      p95Ms: timingDistribution.p95,
      meanMs: round(values.reduce((sum, value) => sum + value, 0) / values.length)
    } satisfies StageTimingAggregate]];
  }));
}

function aggregateFlags(
  pairedSampleCount: number,
  testFailCount: number,
  cmis: ProtocolAggregate,
  boxRest: ProtocolAggregate,
  medianRatio: number | undefined
): string[] {
  const flags: string[] = [];
  if (testFailCount > 0) flags.push("test-failures");
  if (pairedSampleCount === 0 && (cmis.sampleCount > 0 || boxRest.sampleCount > 0)) {
    flags.push("unpaired-operation");
  } else if (pairedSampleCount < 10) {
    flags.push("insufficient-samples");
  }
  for (const [label, aggregate] of [["cmis", cmis], ["box-rest", boxRest]] as const) {
    if (aggregate.failCount > 0) flags.push(`${label}-failures`);
    if (aggregate.totalRetries > 0) flags.push(`${label}-retries`);
    if (aggregate.totalServerRetries > 0) flags.push(`${label}-server-retries`);
    if ((aggregate.meanMs ?? 0) >= 50 && (aggregate.coefficientOfVariation ?? 0) >= 0.5) flags.push(`${label}-high-variance`);
    if (aggregate.medianMs !== undefined && aggregate.p95Ms !== undefined &&
        aggregate.p95Ms > aggregate.medianMs * 2 && aggregate.p95Ms - aggregate.medianMs >= 50) {
      flags.push(`${label}-tail-spike`);
    }
  }
  if (medianRatio !== undefined && medianRatio >= 2) flags.push("cmis-median-at-least-2x");
  if (medianRatio !== undefined && medianRatio <= 0.5) flags.push("box-rest-median-at-least-2x");
  return flags;
}

function protocolSummary(aggregate: ProtocolAggregate): string {
  return `${formatMs(aggregate.medianMs)} / ${formatMs(aggregate.p95Ms)} / ${aggregate.coefficientOfVariation?.toFixed(2) ?? "n/a"}`;
}

function formatMs(value: number | undefined): string {
  return value === undefined ? "n/a" : `${value.toFixed(2)} ms`;
}

function formatRatio(value: number | undefined): string {
  return value === undefined ? "n/a" : `${value.toFixed(2)}x`;
}

function markdownCell(value: string): string {
  return value.replaceAll("|", "\\|").replaceAll("\n", " ");
}

function csvCell(value: unknown): string {
  if (value === undefined || value === null) return "";
  const text = String(value);
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function elapsedDistribution(values: number[]): { medianMs?: number; p95Ms?: number } {
  const valuesDistribution = distribution(values);
  return {
    ...(valuesDistribution.median === undefined ? {} : { medianMs: valuesDistribution.median }),
    ...(valuesDistribution.p95 === undefined ? {} : { p95Ms: valuesDistribution.p95 })
  };
}

function distribution(values: number[]): { median?: number; p95?: number } {
  if (values.length === 0) return {};
  const sorted = [...values].sort((left, right) => left - right);
  return {
    median: round(percentile(sorted, 0.5)),
    p95: round(percentile(sorted, 0.95))
  };
}

function percentile(sorted: number[], quantile: number): number {
  const index = Math.max(0, Math.ceil(quantile * sorted.length) - 1);
  return sorted[index]!;
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}
