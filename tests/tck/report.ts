import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { createBoxRestClient } from "./box-rest-client.js";
import { readTckConfig } from "./config.js";

export type TckStatus = "pass" | "fail" | "blocked";
export type CoverageMode = "exact" | "equivalent" | "reduced-volume" | "expected-unsupported" | "deferred-stress" | "not-applicable";

export interface TckResult {
  status: TckStatus;
  phase: string;
  testId: string;
  openCmisTests: string[];
  coverageMode: CoverageMode;
  fixtureRootId?: string;
  createdObjectCount: number;
  deletedObjectCount: number;
  cleanupStatus: "pass" | "fail" | "skipped";
  retryCount: number;
  elapsedMs: number;
  warnings: string[];
  details?: Record<string, unknown>;
}

export interface TckReport {
  runId: string;
  generatedAt: string;
  results: TckResult[];
  summary: {
    total: number;
    pass: number;
    fail: number;
    blocked: number;
  };
}

export function buildTckReport(runId: string, results: TckResult[], generatedAt = new Date().toISOString()): TckReport {
  return {
    runId,
    generatedAt,
    results,
    summary: {
      total: results.length,
      pass: results.filter((result) => result.status === "pass").length,
      fail: results.filter((result) => result.status === "fail").length,
      blocked: results.filter((result) => result.status === "blocked").length
    }
  };
}

export async function writeTckReport(reportDir: string, report: TckReport): Promise<string> {
  await mkdir(reportDir, { recursive: true });
  const reportPath = path.join(reportDir, `${report.runId}.json`);
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  return reportPath;
}

export interface TimedResultOptions {
  runId: string;
  reportDir: string;
  phase: string;
  testId: string;
  openCmisTests: string[];
  coverageMode: CoverageMode;
  fixtureRootId?: string;
  createdObjectCount: number;
  deletedObjectCount: number;
  cleanupStatus: "pass" | "fail" | "skipped";
  retryCount?: number;
  warnings?: string[];
  details?: Record<string, unknown>;
}

export async function recordTimedResult<T>(options: TimedResultOptions, run: () => Promise<T>): Promise<T> {
  const start = Date.now();
  let cleanupStatus = options.cleanupStatus;
  try {
    const value = await run();
    await writeSingleResult(options, "pass", Date.now() - start, cleanupStatus);
    return value;
  } catch (error) {
    if (cleanupStatus === "pass" && options.cleanupStatus === "skipped") {
      cleanupStatus = "skipped";
    }
    await writeSingleResult(
      {
        ...options,
        details: {
          ...options.details,
          error: error instanceof Error ? error.message : String(error)
        }
      },
      "fail",
      Date.now() - start,
      cleanupStatus
    );
    throw error;
  }
}

async function writeSingleResult(
  options: TimedResultOptions,
  status: TckStatus,
  elapsedMs: number,
  cleanupStatus: "pass" | "fail" | "skipped"
): Promise<void> {
  const report = buildTckReport(options.runId, [
    {
      status,
      phase: options.phase,
      testId: options.testId,
      openCmisTests: options.openCmisTests,
      coverageMode: options.coverageMode,
      fixtureRootId: options.fixtureRootId,
      createdObjectCount: options.createdObjectCount,
      deletedObjectCount: options.deletedObjectCount,
      cleanupStatus,
      retryCount: options.retryCount ?? 0,
      elapsedMs,
      warnings: options.warnings ?? [],
      details: options.details
    }
  ]);
  const reportPath = await writeTckReport(options.reportDir, report);
  await uploadReportToFixtureFolder(reportPath, options.fixtureRootId);
}

export async function uploadReportToFixtureFolder(reportPath: string, fixtureRootId: string | undefined): Promise<void> {
  const config = readTckConfig();
  if (!config.uploadReports || !fixtureRootId) return;
  const hasAuth = Boolean(config.boxAccessToken || (config.boxAuthMode === "ccg" && config.boxClientId && config.boxClientSecret && (config.boxCcgUserId || config.boxCcgEnterpriseId)));
  if (!hasAuth) {
    throw new Error(`TCK report upload requires Box REST credentials: ${reportPath}`);
  }
  const box = await createBoxRestClient(config);
  await box.uploadFile(fixtureRootId, path.basename(reportPath), await readFile(reportPath, "utf8"), reportContentType(reportPath));
}

export function reportContentType(reportPath: string): string {
  switch (path.extname(reportPath).toLowerCase()) {
    case ".html": return "text/html";
    case ".md": return "text/markdown";
    case ".csv": return "text/csv";
    default: return "application/json";
  }
}
