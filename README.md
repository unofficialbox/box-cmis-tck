# Optimized CMIS TCK

This folder contains the TypeScript/Bun TCK foundation for the Box CMIS connector.

## Run

```bash
bun test tests/tck
```

Destructive live tests must require an explicit opt-in:

```bash
BOX_CMIS_TCK_ALLOW_DESTRUCTIVE=true \
BOX_CMIS_TCK_PARENT_ROOT_ID=372098901031 \
BOX_CMIS_TCK_RUN_ROOT_ID=396098221315 \
bun test tests/tck
```

The connector must already be running at `BOX_CMIS_TCK_BASE_URL` for live TCK cases.

Stress tests require a second opt-in:

```bash
BOX_CMIS_TCK_ALLOW_DESTRUCTIVE=true \
BOX_CMIS_TCK_ALLOW_STRESS=true \
BOX_CMIS_TCK_RUN_ROOT_ID=396098221315 \
bun test tests/tck/stress
```

## Guardrails

- Default tests must be non-destructive.
- Write/delete tests must call `requireDestructiveTckConfig`.
- Stress tests must call `requireStressTckConfig`.
- Normal conformance should use a bounded isolated root, not tenant root `0`.
- Expected unsupported CMIS services should be asserted as explicit `notSupported` responses.
- OpenCMIS parity should be tracked in `open-cmis-parity.md`.
