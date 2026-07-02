import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

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
