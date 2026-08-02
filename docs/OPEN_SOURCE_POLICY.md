# Open Source and Provenance Policy

Status: Draft for M0 review
Target project license: Apache-2.0
Policy owner: Principal Architect
Required approvers: Founder/Product Lead and Legal/licensing
Legal approval: **Not signed**

## Project boundary

Memi Canvas is a clean, standalone implementation. Its source, tests,
fixtures, contracts, interface, assets, and protocols must be independently
authored or incorporated under a verified compatible license.

Memi Canvas does not copy or adapt Figma or FigJam source code, plugin code,
assets, icons, fonts, illustrations, files, schemas, private APIs, undocumented
protocols, or proprietary interface definitions. It does not implement a Figma
compatibility layer. Public standards such as SVG, PNG, JSON, WebSocket, Git,
and DTCG remain usable when their use does not create a Figma dependency.

References to Figma or FigJam are permitted only for:

- Explaining the explicit non-goal
- Negative tests that reject unsupported import modes
- User-supplied reference material that is not redistributed
- Factual comparison in documentation

The same intake rules apply to current Memi and Studio material. Existing
source, tests, fixtures, generated assets, or interfaces are not assumed to be
reusable merely because they share a product lineage.

## Required disposition

Every nontrivial external input receives one recorded disposition before it
enters a shipping branch:

1. Compatible reuse under a verified license
2. Relicensed by the copyright holder
3. Optional, separately installed external tool
4. Clean-room implementation from public behavior and new contracts
5. Retired or rejected

Unknown provenance is a release blocker.

## Dependency intake

The dependency owner must add or update `docs/PROVENANCE_LEDGER.md` in the same
change that introduces a package.

Required intake evidence:

1. Exact package name, version, registry or repository, and intended use
2. SPDX identifier and upstream license text from the distributed package
3. Lockfile-resolved transitive dependency and license scan
4. Confirmation that build scripts, bundled binaries, generated code, and
   downloaded assets have been inspected
5. Required attribution, source-offer, NOTICE, or redistribution obligations
6. Security and maintenance review appropriate to the dependency's privilege
7. Legal/licensing review when the license or provenance is not pre-cleared

### Intake categories

| Category | Treatment |
| --- | --- |
| Apache-2.0, MIT, BSD-2-Clause, BSD-3-Clause, ISC, 0BSD | May proceed after evidence is recorded and transitive licenses pass |
| MPL, EPL, LGPL, CDDL, OFL, CC-BY, dual-license, custom, commercial | Legal/licensing review required before merge |
| GPL, AGPL, SSPL, FSL, Commons Clause, noncommercial, no-derivatives, unknown | Prohibited unless Legal/licensing records a written exception compatible with the distribution model |

This table is an engineering gate, not legal advice. Legal/licensing may
require review for any dependency.

Dependencies must be pinned through the lockfile. A version update repeats the
license and transitive scan. Vendoring requires a separate ledger entry with
the upstream source revision and preserved license files.

## NOTICE and attribution

- The root Apache-2.0 license text ships in `LICENSE`.
- A root `NOTICE` file is created when a dependency or incorporated work
  requires notices or attribution in that form.
- Existing upstream NOTICE content is preserved without implying upstream
  endorsement.
- Required license texts and attributions must be included in source archives,
  binary distributions, installers, and hosted downloadable bundles.
- The release scan compares the dependency and asset inventories with `NOTICE`.
  Missing or stale notice content blocks release.
- Project-authored marketing copy, acknowledgements, or optional credits do not
  replace mandatory attribution.

## Assets, fonts, icons, and generated media

Every shipping visual or media asset must have a ledger entry or belong to an
explicitly inventoried project-authored set.

Required evidence:

- File path and content hash
- Original creator or upstream source
- License and attribution terms
- Modification history
- Whether redistribution and commercial use are allowed
- Reviewer and review date

Rules:

- System font stacks require no bundled font file. Any bundled font requires
  its own license and redistribution review.
- Icons must be locally authored or sourced from a compatible, recorded icon
  set. Copying icons from Figma, FigJam, or another product UI is prohibited.
- Product screenshots are reference-only unless the project has documented
  redistribution permission.
- Generated assets record the tool, model or generator, prompt owner, date,
  source inputs, and applicable usage terms.
- Brand marks, logos, photographs, and datasets require explicit permission.
- Coverage reports, build artifacts, caches, and downloaded fixtures are not
  shipping assets and must remain ignored.

## Contributor attestation

Every contribution must include a Developer Certificate of Origin sign-off:

```text
Signed-off-by: Name <email>
```

The sign-off attests that the contributor:

- Authored the work or has the right to submit it under Apache-2.0
- Has identified incorporated third-party material
- Did not copy incompatible current Memi, Studio, Figma, FigJam, or other
  proprietary source, tests, assets, interfaces, or protocols
- Has authority to contribute the work, including any employer obligations
- Has not included secrets, private customer data, or restricted datasets

Large generated changes, imported fixtures, assets, fonts, icons, schemas, and
clean-room implementations require an explicit provenance note in the pull
request or ledger. A future CLA does not replace the DCO unless the governance
policy is formally changed.

## Clean-room implementation

Clean-room work must:

1. Start from public behavior, public standards, or newly written requirements
2. Use independently authored contracts and tests
3. Avoid access to incompatible source or copied proprietary artifacts during
   implementation
4. Record the public references and author attestation
5. Receive independent review for suspicious structural or textual similarity

Private or undocumented Figma/FigJam protocols are out of scope even for
clean-room implementation.

## Release evidence

Every public release must retain:

- Lockfile and reproducible dependency tree
- Machine-readable SBOM
- Direct and transitive license scan report
- Source and generated-file provenance scan
- Asset, font, icon, fixture, and binary inventory
- Forbidden-dependency and Figma/FigJam boundary scan
- `LICENSE` and, when required, `NOTICE`
- Updated provenance ledger
- List of reviewed exceptions and their expiry
- Commit SHA, build environment, commands, and artifact hashes

The release packet must show zero unresolved:

- Unknown licenses
- Missing attributions
- FSL-only shipping dependencies
- Copied Figma/FigJam code, assets, or protocols
- Unapproved generated or binary artifacts
- Provenance exceptions without owner and expiry

Security, QA/Release, and Legal/licensing review the evidence independently.
Legal approval must be recorded explicitly; absence of an objection is not
approval.

## Exception process

An exception request identifies the exact item, purpose, alternatives, license,
distribution effect, containment, owner, and expiry. Principal Architecture
and Legal/licensing must approve it in writing before merge.

Exceptions cannot authorize copied Figma/FigJam code, assets, private
protocols, or a hidden Figma runtime dependency.
