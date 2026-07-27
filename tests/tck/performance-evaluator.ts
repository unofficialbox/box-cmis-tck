import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { ComparisonAggregateReport, ComparisonAggregateRow, ProtocolAggregate } from "./aggregate.js";

export interface PerformanceWindow {
  source: string;
  report: ComparisonAggregateReport;
}

export interface PerformanceThresholds {
  medianRegressionRatio: number;
  medianRegressionAbsoluteMs: number;
  recurringTailWindows: number;
}

export function parseBaselineAggregatePaths(value: string | undefined): string[] {
  if (value === undefined || value.trim() === "") return [];
  const paths = value.split(",").map((entry) => entry.trim()).filter(Boolean);
  if (paths.length === 0) throw new Error("BOX_CMIS_TCK_BASELINE_AGGREGATES must contain at least one aggregate path");
  return paths;
}

export function performanceThresholdsFromEnvironment(env: NodeJS.ProcessEnv): Partial<PerformanceThresholds> {
  return {
    medianRegressionRatio: optionalNumber(env, "BOX_CMIS_TCK_MEDIAN_REGRESSION_RATIO"),
    medianRegressionAbsoluteMs: optionalNumber(env, "BOX_CMIS_TCK_MEDIAN_REGRESSION_ABSOLUTE_MS"),
    recurringTailWindows: optionalNumber(env, "BOX_CMIS_TCK_RECURRING_TAIL_WINDOWS")
  };
}

export type PerformanceFindingKind = "median-regression" | "isolated-tail" | "recurring-tail" | "test-failures" | "failures" | "client-retries" | "server-retries";

export interface PerformanceFinding {
  kind: PerformanceFindingKind;
  phase: string;
  testId: string;
  operation: string;
  protocol: "cmis" | "box-rest" | "comparison";
  message: string;
  blocking: false;
  baselineMedianMs?: number;
  currentMedianMs?: number;
  medianChangeRatio?: number;
  occurrenceCount?: number;
}

export interface PerformanceEvaluation {
  mode: "report-only";
  generatedAt: string;
  currentSource: string;
  baselineSources: string[];
  thresholds: PerformanceThresholds;
  summary: {
    findingCount: number;
    recurringTailCount: number;
    isolatedTailCount: number;
    medianRegressionCount: number;
    blockingCount: 0;
  };
  findings: PerformanceFinding[];
}

const defaultThresholds: PerformanceThresholds = {
  medianRegressionRatio: 1.5,
  medianRegressionAbsoluteMs: 100,
  recurringTailWindows: 2
};

export function evaluatePerformanceWindows(
  windows: PerformanceWindow[],
  thresholds: Partial<PerformanceThresholds> = {},
  generatedAt = new Date().toISOString()
): PerformanceEvaluation {
  if (windows.length < 2) throw new Error("Performance evaluation requires at least one baseline window and one current window");
  const resolved = validateThresholds({
    medianRegressionRatio: thresholds.medianRegressionRatio ?? defaultThresholds.medianRegressionRatio,
    medianRegressionAbsoluteMs: thresholds.medianRegressionAbsoluteMs ?? defaultThresholds.medianRegressionAbsoluteMs,
    recurringTailWindows: thresholds.recurringTailWindows ?? defaultThresholds.recurringTailWindows
  });
  const current = windows.at(-1)!;
  const baselines = windows.slice(0, -1);
  const findings: PerformanceFinding[] = [];

  for (const row of current.report.rows) {
    if ((row.testFailCount ?? 0) > 0) {
      findings.push(finding(row, "comparison", "test-failures", `${row.testFailCount} failed TCK result(s) in the current window.`));
    }
    for (const [protocol, field, flagLabel] of [
      ["cmis", "cmis", "cmis"] as const,
      ["box-rest", "boxRest", "box-rest"] as const
    ]) {
      const aggregate = row[field];
      const baselineMedians = baselines
        .map(({ report }) => findRow(report, row)?.[field].medianMs)
        .filter((value): value is number => value !== undefined);
      const baselineMedianMs = median(baselineMedians);
      if (baselineMedianMs !== undefined && aggregate.medianMs !== undefined && baselineMedianMs > 0) {
        const ratio = aggregate.medianMs / baselineMedianMs;
        if (ratio >= resolved.medianRegressionRatio && aggregate.medianMs - baselineMedianMs >= resolved.medianRegressionAbsoluteMs) {
          findings.push(finding(row, protocol, "median-regression", `Median increased from ${formatMs(baselineMedianMs)} to ${formatMs(aggregate.medianMs)} (${ratio.toFixed(2)}x).`, {
            baselineMedianMs,
            currentMedianMs: aggregate.medianMs,
            medianChangeRatio: round(ratio)
          }));
        }
      }

      const tailFlag = `${flagLabel}-tail-spike`;
      if (row.flags.includes(tailFlag)) {
        const occurrenceCount = windows.filter(({ report }) => findRow(report, row)?.flags.includes(tailFlag)).length;
        const recurring = occurrenceCount >= resolved.recurringTailWindows;
        findings.push(finding(row, protocol, recurring ? "recurring-tail" : "isolated-tail", recurring
          ? `Tail spike recurred in ${occurrenceCount} independent windows.`
          : "Tail spike appears only in the current window and remains advisory.", { occurrenceCount }));
      }

      appendOperationalFindings(findings, row, protocol, aggregate);
    }
  }

  findings.sort((left, right) => findingKey(left).localeCompare(findingKey(right)));
  return {
    mode: "report-only",
    generatedAt,
    currentSource: current.source,
    baselineSources: baselines.map(({ source }) => source),
    thresholds: resolved,
    summary: {
      findingCount: findings.length,
      recurringTailCount: findings.filter(({ kind }) => kind === "recurring-tail").length,
      isolatedTailCount: findings.filter(({ kind }) => kind === "isolated-tail").length,
      medianRegressionCount: findings.filter(({ kind }) => kind === "median-regression").length,
      blockingCount: 0
    },
    findings
  };
}

export async function writePerformanceEvaluationArtifacts(
  outputDir: string,
  evaluation: PerformanceEvaluation
): Promise<{ jsonPath: string; markdownPath: string }> {
  await mkdir(outputDir, { recursive: true });
  const timestamp = evaluation.generatedAt.replace(/[-:.TZ]/g, "").slice(0, 14);
  const basePath = path.join(outputDir, `performance-evaluation-${timestamp}`);
  const jsonPath = `${basePath}.json`;
  const markdownPath = `${basePath}.md`;
  await Promise.all([
    writeFile(jsonPath, `${JSON.stringify(evaluation, null, 2)}\n`, "utf8"),
    writeFile(markdownPath, renderPerformanceEvaluationMarkdown(evaluation), "utf8")
  ]);
  return { jsonPath, markdownPath };
}

export function renderPerformanceEvaluationMarkdown(evaluation: PerformanceEvaluation): string {
  const lines = [
    "# CMIS Performance Evaluation",
    "",
    `Mode: ${evaluation.mode}`,
    `Generated: ${evaluation.generatedAt}`,
    `Current: ${evaluation.currentSource}`,
    `Baselines: ${evaluation.baselineSources.join(", ")}`,
    `Thresholds: median >= ${evaluation.thresholds.medianRegressionRatio.toFixed(2)}x and >= ${evaluation.thresholds.medianRegressionAbsoluteMs.toFixed(2)} ms absolute increase; tail recurrence in >= ${evaluation.thresholds.recurringTailWindows} windows.`,
    "",
    `Findings: ${evaluation.summary.findingCount}; recurring tails: ${evaluation.summary.recurringTailCount}; isolated tails: ${evaluation.summary.isolatedTailCount}; median regressions: ${evaluation.summary.medianRegressionCount}; blocking: 0.`,
    "",
    "| Kind | Protocol | Test | Operation | Detail | Blocking |",
    "| --- | --- | --- | --- | --- | --- |"
  ];
  for (const item of evaluation.findings) {
    lines.push(`| ${item.kind} | ${item.protocol} | ${markdownCell(item.testId)} | ${markdownCell(item.operation)} | ${markdownCell(item.message)} | no |`);
  }
  if (evaluation.findings.length === 0) lines.push("| none | - | - | - | No advisory findings. | no |");
  lines.push("", "This evaluator is report-only. Findings never change the process exit status or block the TCK.", "");
  return lines.join("\n");
}

function appendOperationalFindings(
  findings: PerformanceFinding[],
  row: ComparisonAggregateRow,
  protocol: "cmis" | "box-rest" | "comparison",
  aggregate: ProtocolAggregate
): void {
  if (aggregate.failCount > 0) findings.push(finding(row, protocol, "failures", `${aggregate.failCount} failed measurement(s) in the current window.`));
  if (aggregate.totalRetries > 0) findings.push(finding(row, protocol, "client-retries", `${aggregate.totalRetries} client retry/retries in the current window.`));
  if (aggregate.totalServerRetries > 0) findings.push(finding(row, protocol, "server-retries", `${aggregate.totalServerRetries} connector server retry/retries in the current window.`));
}

function finding(
  row: ComparisonAggregateRow,
  protocol: "cmis" | "box-rest",
  kind: PerformanceFindingKind,
  message: string,
  extra: Partial<PerformanceFinding> = {}
): PerformanceFinding {
  return { kind, phase: row.phase, testId: row.testId, operation: row.operation, protocol, message, blocking: false, ...extra };
}

function findRow(report: ComparisonAggregateReport, target: ComparisonAggregateRow): ComparisonAggregateRow | undefined {
  return report.rows.find((row) => row.phase === target.phase && row.testId === target.testId && row.operation === target.operation);
}

function validateThresholds(thresholds: PerformanceThresholds): PerformanceThresholds {
  if (!Number.isFinite(thresholds.medianRegressionRatio) || thresholds.medianRegressionRatio <= 1) throw new Error("medianRegressionRatio must be greater than 1");
  if (!Number.isFinite(thresholds.medianRegressionAbsoluteMs) || thresholds.medianRegressionAbsoluteMs < 0) throw new Error("medianRegressionAbsoluteMs must be non-negative");
  if (!Number.isInteger(thresholds.recurringTailWindows) || thresholds.recurringTailWindows < 2) throw new Error("recurringTailWindows must be an integer of at least 2");
  return thresholds;
}

function median(values: number[]): number | undefined {
  if (values.length === 0) return undefined;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? round((sorted[middle - 1]! + sorted[middle]!) / 2) : sorted[middle];
}

function findingKey(item: PerformanceFinding): string {
  return `${item.phase}|${item.testId}|${item.operation}|${item.protocol}|${item.kind}`;
}

function formatMs(value: number): string {
  return `${value.toFixed(2)} ms`;
}

function markdownCell(value: string): string {
  return value.replaceAll("|", "\\|").replaceAll("\n", " ");
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

function optionalNumber(env: NodeJS.ProcessEnv, name: string): number | undefined {
  const value = env[name];
  if (value === undefined || value === "") return undefined;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new Error(`${name} must be numeric`);
  return parsed;
}
