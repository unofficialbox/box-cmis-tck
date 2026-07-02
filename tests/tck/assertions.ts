import assert from "node:assert/strict";

export interface CmisErrorPayload {
  exception?: string;
  message?: string;
}

export interface ExpectedUnsupported {
  exception?: string;
  messageIncludes?: string;
}

export function assertExpectedUnsupported(payload: CmisErrorPayload, expected: ExpectedUnsupported = {}): void {
  assert.equal(payload.exception, expected.exception ?? "notSupported", "Expected CMIS notSupported exception");

  if (expected.messageIncludes) {
    assert.match(payload.message ?? "", new RegExp(escapeRegExp(expected.messageIncludes)), "Expected CMIS error message detail");
  }
}

export function assertNoReportFailures(logText: string): void {
  const failures = logText.split(/\r?\n/).filter((line) => /^\s*FAILURE:/.test(line));
  assert.deepEqual(failures, [], "OpenCMIS report contains FAILURE lines");
}

export function countReportLines(logText: string): { failures: number; warnings: number } {
  const lines = logText.split(/\r?\n/);
  return {
    failures: lines.filter((line) => /^\s*FAILURE:/.test(line)).length,
    warnings: lines.filter((line) => /^\s*WARNING:/.test(line)).length
  };
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
