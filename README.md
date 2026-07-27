# Box CMIS Technology Compatibility Kit

A fast, Box-aware compatibility test kit for CMIS 1.1 Browser Binding services.

The project validates the [Box CMIS connector](https://github.com/unofficialbox/box-cmis-connector) against CMIS behavior derived from Apache Chemistry OpenCMIS. For live operations, it runs equivalent CMIS and native Box REST API calls, compares their responses and elapsed times, and produces portable JSON, Markdown, CSV, and HTML reports.

## Why this project exists

Apache Chemistry OpenCMIS remains the external conformance reference, but its general-purpose TCK can be slow and difficult to interpret against a SaaS repository. This optimized TCK keeps the important behavioral assertions while adding:

- bounded fixtures inside a dedicated Box folder;
- strict detection of failures that OpenCMIS may only print in its logs;
- explicit handling for unsupported CMIS capabilities;
- side-by-side CMIS and Box REST measurements;
- client and connector retry telemetry;
- repeated benchmark aggregation with median and p95 statistics;
- advisory cross-window performance evaluation; and
- automatic publication of completed live reports to the Box folder used by the test.

It complements OpenCMIS; it does not replace the upstream conformance suite.

## Coverage

The current optimized suite covers:

| Area | Examples |
| --- | --- |
| Phase 2 object operations | folders, documents, items, names, filters, updates, content, change tokens, copy, move, relationships, policies, and delete tree |
| Phase 3 discovery | object queries, root queries, `IN_FOLDER`, `LIKE`, paging, invalid syntax, and content changes |
| Phase 5 compatibility | requested-property and operation-context include behavior |
| Stress coverage | the 20-document OpenCMIS delete-tree fixture |
| Paired performance | equivalent CMIS and Box REST calls with response, timing, and retry comparisons |

See [open-cmis-parity.md](open-cmis-parity.md) for the test-by-test OpenCMIS mapping.

## Requirements

- [Bun](https://bun.sh/) 1.3.11 or later
- Node.js 22 or later
- A running Box CMIS Browser Binding connector
- A Box application and credentials accepted by the connector
- A dedicated, disposable Box folder for live fixtures

The connector defaults to `http://127.0.0.1:8080/cmis`, and the repository id defaults to `box`.

## Quick start

### 1. Install and run the local checks

```bash
git clone https://github.com/unofficialbox/box-cmis-tck.git
cd box-cmis-tck
bun install --frozen-lockfile
bun test tests/tck
```

This default command is safe: it runs the local harness tests and skips every live, write/delete, and stress case until the corresponding opt-in is present.

### 2. Start the connector

Run the connector in another terminal. If both repositories are cloned beside each other:

```bash
cd ../box-cmis-connector
bun install --frozen-lockfile
bun run start
```

Follow the connector's README for its Box application and authentication setup.

### 3. Choose an isolated Box folder

Create an empty folder specifically for the TCK and copy its numeric folder id from the Box URL. Do not use the enterprise root (`0`) or a folder containing production content.

Export the connector credentials and TCK settings. When using the sibling connector's `.env`:

```bash
set -a
source ../box-cmis-connector/.env
set +a

export BOX_CMIS_TCK_RUN_ROOT_ID=YOUR_RUN_FOLDER_ID
export BOX_CMIS_TCK_ALLOW_DESTRUCTIVE=true
```

The raw Box REST comparisons support either:

- connector Client Credentials Grant variables: `BOX_CMIS_AUTH_MODE=ccg`, `BOX_CMIS_CCG_CLIENT_ID`, `BOX_CMIS_CCG_CLIENT_SECRET`, and a CCG user or enterprise id; or
- an explicit `BOX_CMIS_TCK_BOX_ACCESS_TOKEN`.

The Box application must be able to access the isolated folder.

### 4. Run the live optimized suite

```bash
bun test tests/tck
```

With the destructive opt-in above, this runs the bounded Phase 2 and Phase 3 live cases. Read-only Phase 5 and stress coverage remain separately gated.

Completed reports are written under `tests/tck/reports/` and uploaded to `BOX_CMIS_TCK_RUN_ROOT_ID`. Credentials are never written to reports.

## Run a paired benchmark

The benchmark runner executes every paired Phase 2 and Phase 3 test sequentially for each repetition. It isolates the batch in its own report directory and uploads individual and final artifacts to the test folder.

```bash
export BOX_CMIS_TCK_BENCHMARK_RUNS=10
bun run benchmark:paired
```

`BOX_CMIS_TCK_BENCHMARK_RUNS` accepts values from 2 through 20 and defaults to 3.

To compare the new window with accepted baseline aggregates:

```bash
export BOX_CMIS_TCK_BASELINE_AGGREGATES="\
tests/tck/reports/baseline-1/comparison-aggregate-1.json,\
tests/tck/reports/baseline-2/comparison-aggregate-2.json"

bun run benchmark:paired
```

Performance findings are advisory. Test assertion failures still make the benchmark exit nonzero, but the runner finishes and uploads the available reports first.

## Reports

Each live test produces JSON containing:

- mapped OpenCMIS tests and coverage mode;
- pass, fail, or blocked status;
- created/deleted object counts and cleanup status;
- CMIS and Box REST response outcomes;
- elapsed time, timing delta, and CMIS-to-Box ratio; and
- TCK client retries and connector Box SDK retries.

Repeated benchmarks add:

| Artifact | Purpose |
| --- | --- |
| `comparison-aggregate-*.json` | complete machine-readable aggregate |
| `comparison-aggregate-*.md` | concise human review |
| `comparison-aggregate-*.csv` | spreadsheet and downstream analysis |
| `cmis-tck-final-report-*.html` | self-contained browser report with side-by-side metrics |
| `performance-evaluation-*.json` | machine-readable cross-window findings |
| `performance-evaluation-*.md` | human-readable cross-window findings |

Aggregation reports sample/pass/fail counts, median, p95, mean, standard deviation, coefficient of variation, retries, paired deltas, ratios, and deterministic review flags.

Raw Box REST timings include bounded retries for HTTP 429 and 5xx responses. Authentication time is excluded. Connector-internal Box SDK retries are recorded separately when the connector provides its retry-count response header.

### Aggregate an existing directory

```bash
BOX_CMIS_TCK_REPORT_DIR=tests/tck/reports/BATCH_ID \
  bun run report:aggregate
```

This creates JSON, Markdown, CSV, and self-contained HTML artifacts and uploads them to every fixture root represented by the source reports.

### Evaluate existing benchmark windows

```bash
bun run report:evaluate -- \
  tests/tck/reports/baseline-1/comparison-aggregate-1.json \
  tests/tck/reports/baseline-2/comparison-aggregate-2.json \
  tests/tck/reports/current/comparison-aggregate-current.json
```

The last file is treated as the current window. The evaluator flags material median regressions, isolated or recurring tails, failures, and retries. It also refreshes the current window's HTML report.

## Test modes and safety gates

| Mode | Required setting | Command |
| --- | --- | --- |
| Local harness | none | `bun test tests/tck/harness.test.ts` |
| Bounded live writes | `BOX_CMIS_TCK_ALLOW_DESTRUCTIVE=true` plus a run or parent folder id | `bun test tests/tck` |
| Read-only compatibility | `BOX_CMIS_TCK_ALLOW_LIVE_READ=true` | `bun test tests/tck/phase5-compat-live.test.ts` |
| Stress | destructive opt-in, folder id, and `BOX_CMIS_TCK_ALLOW_STRESS=true` | `bun test tests/tck/stress` |

Guardrails are enforced in code:

- live tests are skipped unless explicitly enabled;
- destructive tests require `BOX_CMIS_TCK_RUN_ROOT_ID` or `BOX_CMIS_TCK_PARENT_ROOT_ID`;
- stress tests require a second opt-in;
- fixture names are deterministic, bounded, and extension-bearing;
- expected unsupported services must return explicit CMIS `notSupported`; and
- cleanup results are recorded in every report.

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

Advanced endpoint and evaluation overrides are available in [tests/tck/config.ts](tests/tck/config.ts) and [tests/tck/performance-evaluator.ts](tests/tck/performance-evaluator.ts).

Relationship metadata coverage defaults to `enterprise:cmisRelationships:relationships`. Override it with `BOX_CMIS_RELATIONSHIP_TEMPLATE=scope:templateKey:propertyKey` when the connector uses a different template.

## Troubleshooting

**All live tests are skipped**

Set the required opt-in and folder id. This is expected behavior for a default run.

**The connector cannot be reached**

Start it first or set `BOX_CMIS_TCK_BASE_URL` to its Browser Binding endpoint.

**Raw Box REST calls return 401 or 403**

Check the CCG variables or access token and confirm the Box application can access the isolated test folder.

**Report upload fails**

Report upload uses the same Box credentials as the raw REST comparisons. Fix those credentials, or set `BOX_CMIS_TCK_UPLOAD_REPORTS=false` only for an intentionally local-only run.

**A relationship test fails before comparison**

Confirm that the relationship metadata template exists, its property key matches `BOX_CMIS_RELATIONSHIP_TEMPLATE`, and the Box application can read and write that template.

## License

Licensed under the [MIT License](LICENSE).

## Contributing

Keep new tests bounded and map them to the corresponding OpenCMIS behavior. Add local assertions where practical, protect live mutations with the correct guard, record cleanup, and update the parity map when coverage changes.

Run before submitting changes:

```bash
bun install --frozen-lockfile
bun test tests/tck
```
