# Advanced TCK Usage

This guide contains operational details that are useful after the basic workflow in the [project README](../README.md) is working.

## Test modes and safety gates

| Mode | Required setting | Command |
| --- | --- | --- |
| Local harness | none | `bun test tests/tck/harness.test.ts` |
| Bounded live writes | `BOX_CMIS_TCK_ALLOW_DESTRUCTIVE=true` plus a run or parent folder id | `bun test tests/tck` |
| Read-only compatibility | `BOX_CMIS_TCK_ALLOW_LIVE_READ=true` | `bun test tests/tck/phase5-compat-live.test.ts` |
| Stress | destructive opt-in, folder id, and `BOX_CMIS_TCK_ALLOW_STRESS=true` | `bun test tests/tck/stress` |

Guardrails are enforced in code:

- Live tests are skipped unless explicitly enabled.
- Destructive tests require `BOX_CMIS_TCK_RUN_ROOT_ID` or `BOX_CMIS_TCK_PARENT_ROOT_ID`.
- Stress tests require a second opt-in.
- Fixture names are deterministic, bounded, and extension-bearing.
- Expected unsupported services must return explicit CMIS `notSupported` responses.
- Cleanup results are recorded in every report.

## Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `BOX_CMIS_TCK_BASE_URL` | `http://127.0.0.1:8080/cmis` | Connector Browser Binding endpoint |
| `BOX_CMIS_TCK_REPOSITORY_ID` | `box` | CMIS repository id |
| `BOX_CMIS_TCK_RUN_ROOT_ID` | none | Preferred isolated fixture folder |
| `BOX_CMIS_TCK_PARENT_ROOT_ID` | none | Fallback fixture parent |
| `BOX_CMIS_TCK_ALLOW_LIVE_READ` | `false` | Enables read-only live tests |
| `BOX_CMIS_TCK_ALLOW_DESTRUCTIVE` | `false` | Enables bounded write/delete tests |
| `BOX_CMIS_TCK_ALLOW_STRESS` | `false` | Enables stress tests |
| `BOX_CMIS_TCK_REPORT_DIR` | `tests/tck/reports` | Local report output directory |
| `BOX_CMIS_TCK_UPLOAD_REPORTS` | `true` | Uploads completed live artifacts to the fixture folder |
| `BOX_CMIS_TCK_BOX_ACCESS_TOKEN` | none | Explicit token for raw Box REST comparisons |
| `BOX_CMIS_TCK_BENCHMARK_RUNS` | `3` | Paired benchmark repetitions, from 2 through 20 |
| `BOX_CMIS_TCK_BASELINE_AGGREGATES` | none | Comma-separated baseline aggregate paths |

Advanced endpoint settings are defined in [`tests/tck/config.ts`](../tests/tck/config.ts). Performance evaluation thresholds are defined in [`tests/tck/performance-evaluator.ts`](../tests/tck/performance-evaluator.ts).

Relationship metadata coverage defaults to `enterprise:cmisRelationships:relationships`. Override it with `BOX_CMIS_RELATIONSHIP_TEMPLATE=scope:templateKey:propertyKey` when the connector uses another template. The paired comparison writes and removes the relationship entry on both source and target objects through Box REST, matching the connector's mirrored storage semantics.

## Authentication for Box REST comparisons

The comparisons accept either:

- connector Client Credentials Grant variables: `BOX_CMIS_AUTH_MODE=ccg`, `BOX_CMIS_CCG_CLIENT_ID`, `BOX_CMIS_CCG_CLIENT_SECRET`, and a CCG user or enterprise id; or
- an explicit `BOX_CMIS_TCK_BOX_ACCESS_TOKEN`.

Authentication time is excluded from measured Box REST operations. Raw REST requests use bounded retries for HTTP 429 and 5xx responses. Connector-internal Box SDK retries remain separate from TCK client retries.

## Repeated benchmarks

```bash
export BOX_CMIS_TCK_BENCHMARK_RUNS=10
bun run benchmark:paired
```

The runner executes paired Phase 2 and Phase 3 tests sequentially for each repetition and isolates the batch in its own report directory.

To evaluate a new window against accepted baselines:

```bash
export BOX_CMIS_TCK_BASELINE_AGGREGATES="\
tests/tck/reports/baseline-1/comparison-aggregate-1.json,\
tests/tck/reports/baseline-2/comparison-aggregate-2.json"

bun run benchmark:paired
```

Performance findings are advisory. Test assertion failures still make the benchmark exit nonzero, but the runner completes the batch and uploads available reports first.

## Reports

Each live test writes JSON with its OpenCMIS mapping, coverage mode, status, fixture counts, cleanup status, protocol outcomes, elapsed time, and retry counts.

Repeated benchmarks add:

| Artifact | Purpose |
| --- | --- |
| `comparison-aggregate-*.json` | Complete machine-readable aggregate |
| `comparison-aggregate-*.md` | Concise human review |
| `comparison-aggregate-*.csv` | Spreadsheet and downstream analysis |
| `cmis-tck-final-report-*.html` | Self-contained side-by-side report |
| `performance-evaluation-*.json` | Machine-readable cross-window findings |
| `performance-evaluation-*.md` | Human-readable cross-window findings |

Aggregates include sample/pass/fail counts, median, p95, mean, standard deviation, coefficient of variation, retries, paired deltas, ratios, and deterministic review flags. Connector relationship-stage distributions are included when response telemetry is available.

### Aggregate an existing directory

```bash
BOX_CMIS_TCK_REPORT_DIR=tests/tck/reports/BATCH_ID \
  bun run report:aggregate
```

This generates JSON, Markdown, CSV, and HTML artifacts and uploads them to every fixture root represented by the source reports.

### Evaluate existing benchmark windows

```bash
bun run report:evaluate -- \
  tests/tck/reports/baseline-1/comparison-aggregate-1.json \
  tests/tck/reports/baseline-2/comparison-aggregate-2.json \
  tests/tck/reports/current/comparison-aggregate-current.json
```

The final file is the current window. The evaluator reports material median regressions, isolated or recurring tails, failures, and retries, then refreshes the current HTML report.

## Focused development diagnostics

Focused tests are useful while validating new connector behavior but are not part of the stable full-benchmark contract unless added to the benchmark runner.

For metadata-backed `IN_TREE` post-filtering:

```bash
bun test tests/tck/phase3-paired-metadata-query-live.test.ts
```

This diagnostic requires the connector's `BOX_CMIS_METADATA_TEMPLATES` configuration and, for enterprise templates, `BOX_CMIS_ENTERPRISE_ID`. It builds equivalent two-level Box trees, requests the exact metadata template through both protocols, and uploads its report to the configured test folder.

## Troubleshooting

### All live tests are skipped

Set the required opt-in and folder id. Skipping is the expected default behavior.

### The connector cannot be reached

Start it first or set `BOX_CMIS_TCK_BASE_URL` to its Browser Binding endpoint.

### Box REST calls return 401 or 403

Check the CCG variables or access token and confirm that the Box application can access the isolated folder.

### Report upload fails

Report upload uses the same Box credentials as the REST comparisons. Fix those credentials, or set `BOX_CMIS_TCK_UPLOAD_REPORTS=false` only for an intentionally local-only run.

### A relationship test fails before comparison

Confirm that the metadata template exists, its property key matches `BOX_CMIS_RELATIONSHIP_TEMPLATE`, and the Box application can read and write the template.
