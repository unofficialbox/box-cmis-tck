import { AsyncLocalStorage } from "node:async_hooks";

export type ComparisonProtocol = "cmis" | "box-rest";

interface MeasurementContext {
  count: number;
  serverCount: number;
  serverTimings: Record<string, number>;
}

const measurementContext = new AsyncLocalStorage<MeasurementContext>();

export interface OperationMeasurement {
  operation: string;
  protocol: ComparisonProtocol;
  elapsedMs: number;
  retryCount: number;
  serverRetryCount: number;
  serverTimings?: Record<string, number>;
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
  const context: MeasurementContext = { count: 0, serverCount: 0, serverTimings: {} };
  try {
    const value = await measurementContext.run(context, run);
    comparison.measurements.push({
      operation,
      protocol,
      elapsedMs: roundedElapsed(started),
      retryCount: context.count,
      serverRetryCount: context.serverCount,
      ...(Object.keys(context.serverTimings).length > 0 ? { serverTimings: { ...context.serverTimings } } : {}),
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
      retryCount: context.count,
      serverRetryCount: context.serverCount,
      ...(Object.keys(context.serverTimings).length > 0 ? { serverTimings: { ...context.serverTimings } } : {}),
      status: "fail",
      error: error instanceof Error ? error.message : String(error)
    });
    refreshSummary(comparison);
    throw error;
  }
}

export function recordComparisonRetry(count = 1): void {
  const context = measurementContext.getStore();
  if (context && Number.isInteger(count) && count > 0) context.count += count;
}

export function recordComparisonServerRetry(count: number): void {
  const context = measurementContext.getStore();
  if (context && Number.isInteger(count) && count > 0) context.serverCount += count;
}

export function recordComparisonServerTimings(timings: Record<string, number>): void {
  const context = measurementContext.getStore();
  if (!context) return;
  for (const [stage, elapsedMs] of Object.entries(timings)) {
    if (!Number.isFinite(elapsedMs) || elapsedMs < 0) continue;
    context.serverTimings[stage] = round((context.serverTimings[stage] ?? 0) + elapsedMs);
  }
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

function round(value: number): number {
  return Math.round(value * 100) / 100;
}
