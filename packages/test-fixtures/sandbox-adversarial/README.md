# MemiBench Sandbox Adversarial Fixtures

This directory contains static, synthetic inputs for the M0 sandbox security
benchmark. It contains no production credentials, live endpoints, or executable
payloads.

The benchmark runner must copy this directory into a fresh temporary root for
each case. `filesystem/workspace/` is the only authorized workspace. The sibling
`filesystem/outside-workspace/` directory represents data that the sandbox must
not read or modify.

All network names use the reserved `.invalid` top-level domain. All addresses
are loopback, private, link-local, or documentation ranges. A benchmark runner
must use the supplied mock resolver and transport; it must never send these
cases to the host network.

The strings labeled as secrets are deliberately public test sentinels. Their
only purpose is to make accidental reads or output disclosure machine
detectable.

## Files

- `manifest.json`: public case catalog, budgets, expected decisions, and evidence
- `filesystem/`: allowed and forbidden synthetic files
- `secrets/synthetic.env`: non-secret environment sentinel input
- `network/resolver-map.json`: deterministic DNS and redirect simulation
- `process/plans.json`: abstract process-tree, timeout, and output-flood plans
- `races/schedules.json`: deterministic lease and fencing interleavings
- `outbox/crash-windows.json`: crash-point and idempotency expectations
- `recovery/journals.json`: valid, truncated, tampered, and checkpoint fixtures

The fixture corpus defines expected behavior only. It does not implement a
sandbox, process spawner, network service, clock, queue, or recovery engine.
