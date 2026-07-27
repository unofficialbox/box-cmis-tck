import { aggregateComparisonDirectory, writeComparisonAggregateArtifacts } from "./aggregate.js";
import { readTckConfig } from "./config.js";
import { writeFinalHtmlReport } from "./final-html-report.js";
import { uploadReportToFixtureFolder } from "./report.js";

const config = readTckConfig();
const report = await aggregateComparisonDirectory(config.reportDir);
const reportPaths = await writeComparisonAggregateArtifacts(config.reportDir, report);
const htmlPath = await writeFinalHtmlReport(config.reportDir, report);
for (const fixtureRootId of report.fixtureRootIds) {
  for (const reportPath of [...Object.values(reportPaths), htmlPath]) {
    await uploadReportToFixtureFolder(reportPath, fixtureRootId);
  }
}
console.log(JSON.stringify({ reportPaths, htmlPath, sourceReportCount: report.sourceReportCount, rowCount: report.rows.length, fixtureRootIds: report.fixtureRootIds }));
