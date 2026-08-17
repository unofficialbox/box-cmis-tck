import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { ComparisonAggregateReport, ProtocolAggregate } from "./aggregate.js";
import type { PerformanceEvaluation } from "./performance-evaluator.js";

export async function writeFinalHtmlReport(
  outputDir: string,
  aggregate: ComparisonAggregateReport,
  evaluation?: PerformanceEvaluation,
  generatedAt = evaluation?.generatedAt ?? new Date().toISOString()
): Promise<string> {
  await mkdir(outputDir, { recursive: true });
  const timestamp = generatedAt.replace(/[-:.TZ]/g, "").slice(0, 14);
  const htmlPath = path.join(outputDir, `cmis-tck-final-report-${timestamp}.html`);
  await writeFile(htmlPath, renderFinalHtmlReport(aggregate, evaluation, generatedAt), "utf8");
  return htmlPath;
}

export function renderFinalHtmlReport(
  aggregate: ComparisonAggregateReport,
  evaluation?: PerformanceEvaluation,
  generatedAt = evaluation?.generatedAt ?? aggregate.generatedAt
): string {
  const failedMeasurements = aggregate.rows.reduce((sum, row) => sum + row.cmis.failCount + row.boxRest.failCount, 0);
  const testFailures = Math.max(0, ...aggregate.rows.map((row) => row.testFailCount));
  const clientRetries = aggregate.rows.reduce((sum, row) => sum + row.cmis.totalRetries + row.boxRest.totalRetries, 0);
  const serverRetries = aggregate.rows.reduce((sum, row) => sum + row.cmis.totalServerRetries + row.boxRest.totalServerRetries, 0);
  const findings = evaluation?.findings ?? [];
  const rows = aggregate.rows.map((row) => `
          <tr>
            <td>${escapeHtml(row.phase)}</td>
            <td><strong>${escapeHtml(row.testId)}</strong></td>
            <td>${escapeHtml(row.operation)}</td>
            <td class="number">${row.pairedSampleCount}</td>
            <td class="number ${row.testFailCount > 0 ? "bad" : "good"}">${row.testPassCount} / ${row.testFailCount}</td>
            <td class="number">${protocolHtml(row.cmis)}</td>
            <td class="number">${protocolHtml(row.boxRest)}</td>
            <td class="number">${formatMs(row.deltaMs.medianMs)}</td>
            <td class="number">${formatRatio(row.cmisToBoxRestRatio.median)}</td>
            <td class="number">${row.cmis.totalRetries + row.boxRest.totalRetries}</td>
            <td>${row.flags.length === 0 ? '<span class="pill good-pill">none</span>' : row.flags.map((flag) => `<span class="pill">${escapeHtml(flag)}</span>`).join(" ")}</td>
          </tr>`).join("");
  const timingRows = aggregate.rows.flatMap((row) => [
    ...Object.entries(row.serverTimings?.cmis ?? {}).map(([stage, timing]) => ({ row, protocol: "CMIS", stage, timing })),
    ...Object.entries(row.serverTimings?.boxRest ?? {}).map(([stage, timing]) => ({ row, protocol: "Box REST", stage, timing }))
  ]);
  const stageRows = timingRows.length === 0 ? `
          <tr><td colspan="8" class="note">No connector stage timings were reported.</td></tr>` : timingRows.map(({ row, protocol, stage, timing }) => `
          <tr>
            <td><strong>${escapeHtml(row.testId)}</strong></td>
            <td>${escapeHtml(row.operation)}</td>
            <td>${escapeHtml(protocol)}</td>
            <td>${escapeHtml(stage)}</td>
            <td class="number">${timing.sampleCount}</td>
            <td class="number">${formatMs(timing.medianMs)}</td>
            <td class="number">${formatMs(timing.p95Ms)}</td>
            <td class="number">${formatMs(timing.meanMs)}</td>
          </tr>`).join("");
  const findingRows = findings.length === 0 ? `
          <tr><td colspan="6" class="good">No advisory findings.</td></tr>` : findings.map((finding) => `
          <tr>
            <td><span class="pill finding-${escapeHtml(finding.kind)}">${escapeHtml(finding.kind)}</span></td>
            <td>${escapeHtml(finding.protocol)}</td>
            <td>${escapeHtml(finding.testId)}</td>
            <td>${escapeHtml(finding.operation)}</td>
            <td>${escapeHtml(finding.message)}</td>
            <td>no</td>
          </tr>`).join("");

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>CMIS TCK Final Report</title>
  <style>
    :root { color-scheme: light; --ink:#172033; --muted:#64748b; --line:#dbe3ef; --surface:#f6f8fc; --blue:#1769e0; --green:#137a4b; --red:#b42318; --amber:#9a5b00; }
    * { box-sizing: border-box; }
    body { margin:0; background:var(--surface); color:var(--ink); font:14px/1.45 Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    main { max-width:1500px; margin:0 auto; padding:32px 24px 56px; }
    h1 { margin:0 0 6px; font-size:30px; letter-spacing:-.02em; }
    h2 { margin:32px 0 12px; font-size:20px; }
    .meta { color:var(--muted); margin:0 0 22px; }
    .cards { display:grid; grid-template-columns:repeat(auto-fit,minmax(170px,1fr)); gap:12px; }
    .card { background:white; border:1px solid var(--line); border-radius:12px; padding:16px; box-shadow:0 2px 8px rgb(23 32 51 / 4%); }
    .card span { display:block; color:var(--muted); font-size:12px; text-transform:uppercase; letter-spacing:.06em; }
    .card strong { display:block; margin-top:5px; font-size:24px; }
    .table-wrap { overflow:auto; background:white; border:1px solid var(--line); border-radius:12px; }
    table { width:100%; border-collapse:collapse; min-width:1150px; }
    th { position:sticky; top:0; background:#eef3fa; color:#42526a; text-align:left; font-size:12px; letter-spacing:.03em; }
    th, td { padding:10px 11px; border-bottom:1px solid var(--line); vertical-align:top; }
    tbody tr:hover { background:#f8fbff; }
    .number { text-align:right; white-space:nowrap; }
    .metric { white-space:nowrap; }
    .submetric { color:var(--muted); font-size:12px; }
    .pill { display:inline-block; margin:1px 2px 1px 0; border-radius:999px; padding:2px 7px; background:#fff3d6; color:var(--amber); font-size:11px; white-space:nowrap; }
    .good-pill { background:#e8f7ef; color:var(--green); }
    .good { color:var(--green); }
    .bad { color:var(--red); }
    .note { color:var(--muted); font-size:13px; }
    footer { margin-top:26px; color:var(--muted); font-size:12px; }
    @media print { body { background:white; } main { max-width:none; padding:16px; } .card,.table-wrap { box-shadow:none; } th { position:static; } }
  </style>
</head>
<body>
  <main>
    <h1>CMIS TCK Final Report</h1>
    <p class="meta">Generated ${escapeHtml(generatedAt)} · Fixture root ${escapeHtml(aggregate.fixtureRootIds.join(", ") || "none")}</p>
    <section class="cards" aria-label="Run summary">
      ${summaryCard("Source reports", aggregate.sourceReportCount)}
      ${summaryCard("Operations", aggregate.rows.length)}
      ${summaryCard("Test failures", testFailures, testFailures === 0)}
      ${summaryCard("Failed measurements", failedMeasurements, failedMeasurements === 0)}
      ${summaryCard("Client retries", clientRetries, clientRetries === 0)}
      ${summaryCard("Connector retries", serverRetries, serverRetries === 0)}
      ${summaryCard("Advisory findings", evaluation?.summary.findingCount ?? "not evaluated", evaluation?.summary.findingCount === 0)}
      ${summaryCard("Blocking findings", evaluation?.summary.blockingCount ?? 0, true)}
    </section>

    <h2>CMIS vs Box REST</h2>
    <div class="table-wrap">
      <table>
        <thead><tr><th>Phase</th><th>Test</th><th>Operation</th><th>Samples</th><th>Tests pass/fail</th><th>CMIS median / p95</th><th>Box REST median / p95</th><th>Median delta</th><th>Median ratio</th><th>Client retries</th><th>Flags</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>

    <h2>Connector stage timings</h2>
    <p class="note">Request-scoped timings reported by the connector for internal Box operations.</p>
    <div class="table-wrap">
      <table>
        <thead><tr><th>Test</th><th>Operation</th><th>Protocol</th><th>Stage</th><th>Samples</th><th>Median</th><th>p95</th><th>Mean</th></tr></thead>
        <tbody>${stageRows}</tbody>
      </table>
    </div>

    <h2>Performance evaluation</h2>
    <p class="note">${evaluation ? `Compared with ${evaluation.baselineSources.length} baseline window(s). Findings are advisory and never block the TCK.` : "No baseline evaluation was supplied for this report."}</p>
    <div class="table-wrap">
      <table>
        <thead><tr><th>Kind</th><th>Protocol</th><th>Test</th><th>Operation</th><th>Detail</th><th>Blocking</th></tr></thead>
        <tbody>${findingRows}</tbody>
      </table>
    </div>
    <footer>Self-contained report generated by box-cmis-tck. No credentials or request bodies are included.</footer>
  </main>
</body>
</html>
`;
}

function protocolHtml(value: ProtocolAggregate): string {
  return `<span class="metric">${formatMs(value.medianMs)} / ${formatMs(value.p95Ms)}</span><br><span class="submetric">pass ${value.passCount}, fail ${value.failCount}, CV ${value.coefficientOfVariation?.toFixed(2) ?? "n/a"}</span>`;
}

function summaryCard(label: string, value: string | number, good = false): string {
  return `<div class="card"><span>${escapeHtml(label)}</span><strong${good ? ' class="good"' : ""}>${escapeHtml(String(value))}</strong></div>`;
}

function formatMs(value: number | undefined): string {
  return value === undefined ? "n/a" : `${value.toFixed(2)} ms`;
}

function formatRatio(value: number | undefined): string {
  return value === undefined ? "n/a" : `${value.toFixed(2)}x`;
}

function escapeHtml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}
