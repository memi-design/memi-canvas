# Gate C release evidence lane

Gate C real-repository evidence is intentionally separate from normal pull
request and `main` CI. The `Gate C release evidence` workflow is manual-only,
reads a private Buzzr checkout on a dedicated macOS runner, and uploads one
sanitized manifest. It does not upload the checkout, SQLite database, captured
pixels, hierarchy, geometry, or reconstruction files.

## Required protected setup

Do not dispatch the workflow until all of the following are configured:

1. Create the `gate-c-private-evidence` GitHub environment. Require an
   independent reviewer, prevent self-review, and restrict deployments to the
   protected `main` branch.
2. Register a repository-scoped, dedicated Apple Silicon runner with exactly
   these labels: `self-hosted`, `macOS`, `ARM64`, and `memi-gate-c`. Do not use
   a general workstation runner that accepts jobs from other repositories.
3. Give that runner a clean, read-only Buzzr checkout and an existing native
   development client. Keep unrelated credentials and private services off the
   runner.
4. Set the protected environment variable `MEMI_BUZZR_REPOSITORY` to the clean
   checkout's absolute path. Set `MEMI_BUZZR_EXPECTED_REVISION` to its full
   lowercase 40-character commit SHA. Do not add a private-repository token to
   this workflow.

GitHub documents that self-hosted jobs are not isolated, even when an
environment protects their start. The runner and private checkout therefore
remain a trusted release resource, not a general CI resource.

## Dispatch contract

Dispatch `.github/workflows/gate-c-release-evidence.yml` from `main`. The job
fails closed unless:

- the protected checkout exists and is not a symbolic link;
- its `HEAD` is the requested SHA;
- it has no tracked or untracked changes;
- the production pilot commits real native evidence;
- every capture has screenshot, hierarchy, geometry, reconstruction, stable
  frame, source-revision, and rejection evidence; and
- the committed project rehydrates into Canvas V3 from read-only storage.

The uploaded `evidence-manifest.json` contains opaque source/capture authority
commitments, content hashes and byte sizes, native dimensions, routes,
verification outcomes, hydration counts, and database hashes. It excludes the
raw private commit SHA, import/project IDs, absolute paths, and source-dirty
fingerprint. Raw evidence stays on the protected runner under its bounded,
run-unique application-data root for private inspection and retention.

## Truth boundary

The workflow file alone does not close Gate C. Gate C closes only after a
protected run from `main` succeeds, its sanitized manifest is retained, and an
independent reviewer confirms that the manifest binds to the expected Buzzr
revision. If no correctly configured runner is online, the job must remain
queued; never replace the private source or native runtime with a fixture to
make the lane green.
