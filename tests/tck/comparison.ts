import { AsyncLocalStorage } from "node:async_hooks";

export type ComparisonProtocol = "cmis" | "box-rest";

interface RetryContext {
  count: number;
  serverCount: number;
}

const retryContext = new AsyncLocalStorage<RetryContext>();

export interface OperationMeasurement {
  operation: string;
  protocol: ComparisonProtocol;
  elapsedMs: number;
  retryCount: number;
  serverRetryCount: number;
  status: "pass" | "fail";
  outcome?: Record<string, unknown>;
  error?: string;
}

export interface SideBySideComparison {
  measurements: OperationMeasurement[];
  summary: Array<{
    operation: string;
    cmisElapsedMs?: number;
    boxRestElapsedMs?: number;
    cmisRetryCount?: number;
    boxRestRetryCount?: number;
    cmisServerRetryCount?: number;
    boxRestServerRetryCount?: number;
    deltaMs?: number;
    cmisToBoxRestRatio?: number;
  }>;
}

export function createSideBySideComparison(): SideBySideComparison {
  return { measurements: [], summary: [] };
}

export async function measureOperation<T>(
  comparison: SideBySideComparison,
  operation: string,
  protocol: ComparisonProtocol,
  run: () => Promise<T>,
  outcome: (value: T) => Record<string, unknown> = () => ({})
): Promise<T> {
  const started = performance.now();
  const retries = { count: 0, serverCount: 0 };
  try {
    const value = await retryContext.run(retries, run);
    comparison.measurements.push({
      operation,
      protocol,
      elapsedMs: roundedElapsed(started),
      retryCount: retries.count,
      serverRetryCount: retries.serverCount,
      status: "pass",
      outcome: outcome(value)
    });
    refreshSummary(comparison);
    return value;
  } catch (error) {
    comparison.measurements.push({
      operation,
      protocol,
      elapsedMs: roundedElapsed(started),
      retryCount: retries.count,
      serverRetryCount: retries.serverCount,
      status: "fail",
      error: error instanceof Error ? error.message : String(error)
    });
    refreshSummary(comparison);
    throw error;
  }
}

export function recordComparisonRetry(count = 1): void {
  const context = retryContext.getStore();
  if (context && Number.isInteger(count) && count > 0) context.count += count;
}

export function recordComparisonServerRetry(count: number): void {
  const context = retryContext.getStore();
  if (context && Number.isInteger(count) && count > 0) context.serverCount += count;
}

function refreshSummary(comparison: SideBySideComparison): void {
  const operations = [...new Set(comparison.measurements.map(({ operation }) => operation))];
  comparison.summary = operations.map((operation) => {
    const cmis = comparison.measurements.find((entry) => entry.operation === operation && entry.protocol === "cmis");
    const boxRest = comparison.measurements.find((entry) => entry.operation === operation && entry.protocol === "box-rest");
    const row: SideBySideComparison["summary"][number] = { operation };
    if (cmis) row.cmisElapsedMs = cmis.elapsedMs;
    if (boxRest) row.boxRestElapsedMs = boxRest.elapsedMs;
    if (cmis) row.cmisRetryCount = cmis.retryCount;
    if (boxRest) row.boxRestRetryCount = boxRest.retryCount;
    if (cmis) row.cmisServerRetryCount = cmis.serverRetryCount;
    if (boxRest) row.boxRestServerRetryCount = boxRest.serverRetryCount;
    if (cmis && boxRest) {
      row.deltaMs = Math.round((cmis.elapsedMs - boxRest.elapsedMs) * 100) / 100;
      row.cmisToBoxRestRatio = boxRest.elapsedMs === 0 ? undefined : Math.round((cmis.elapsedMs / boxRest.elapsedMs) * 100) / 100;
    }
    return row;
  });
}

function roundedElapsed(started: number): number {
  return Math.round((performance.now() - started) * 100) / 100;
}
