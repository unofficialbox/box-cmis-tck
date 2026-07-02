export function buildRunId(now = new Date()): string {
  const timestamp = now.toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);
  return `cmis-tck-${timestamp}`;
}

export function buildFixtureName(runId: string, phase: string, name: string): string {
  const safePhase = sanitizeNamePart(phase);
  const safeName = sanitizeNamePart(name);
  return `${runId}-${safePhase}-${safeName}`;
}

function sanitizeNamePart(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48);
}
