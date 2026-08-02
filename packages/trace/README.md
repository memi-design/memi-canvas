# Trace authority boundary

The M0 journal enforces one writer per canonical path inside one workspace
runtime process. Reopening a journal verifies its protocol schema and complete
integrity chain before accepting another append.

This is not a cross-process locking guarantee. M1 remains **NO-GO** for multiple
runtime processes until SQLite owns writer election, intent/outbox records,
fencing, crash reconciliation, and trace metadata in the transaction protocol.
The JSONL file is append evidence, not an independent multi-process authority.
