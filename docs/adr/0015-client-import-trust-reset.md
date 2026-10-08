# 0015 · A client package is untrusted input: nothing arrives approved

- Status: accepted
- Date: 2026-10-08
- Amends: 0009 (import behaviour)

## Context

ADR 0009 imports a package by generating new ids and keeping every other value. The package is written by whoever made it: statuses and "who approved" are as free to choose as ids and storage keys. The audit found that a crafted package could arrive with content already Approved or Exported, with approvals attributed to real local people (people are matched by email, which the package states), with published templates (including `origin: system`), with the AI providers of the client already approved, with automations active and with Brand Identity versions already published. Each of these skips a gate that `can()` enforces for everything created here.

The structural checks (every foreign key and `client_id` stays inside the package, storage keys are this client's, files match their checksum) keep a package from reaching into another client. They do not say what a row may claim, which is this decision.

## Decision

The importer applies `applyImportTrust` (`packages/client-transfer/src/trust.ts`) to every row, after the final scope check and before the insert, on the remapped parsed rows. The rules are per table:

| Table                                                                                                               | On import                                                                                                                                                            |
| ------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `clients`                                                                                                           | new client: `approved_providers = []`; replacement: `ai_policy`, `approved_providers`, `sendable_assets` keep the replaced client's current values                   |
| `contents`                                                                                                          | `in_review`, `changes_requested`, `approved`, `exported` become `draft`; approved version, outline approval, reviewer, review note, submitter and lock cleared       |
| `content_approvals`, `content_exports`, `audit_report_exports`, `brand_check_issue_states`                          | not imported (approval records, export records, waivers granted elsewhere)                                                                                           |
| `assets`                                                                                                            | an AI image that was `approved` becomes `draft`; the decision (who, when) is cleared for every asset                                                                 |
| `templates`                                                                                                         | always `draft`, `origin = agency`, owned by the client; submission and publication fields and `validation` cleared                                                   |
| `automations`                                                                                                       | `active` becomes `paused`                                                                                                                                            |
| `automation_runs`, `automation_run_items`                                                                           | a run or item that was running or queued becomes `cancelled` (nothing here would ever finish it)                                                                     |
| `audits`                                                                                                            | `in_review`, `reviewed`, `delivered` become `in_review`; reviewer and delivery date cleared                                                                          |
| `audit_reports`                                                                                                     | `in_review`, `approved`, `exported` become `draft`; submission, review, approval and export fields cleared                                                           |
| `brand_identity_versions`                                                                                           | `approved` and `published` become `archived` (they can be restored as a new draft); `in_review` becomes `draft`; submission, approval and publication fields cleared |
| `brand_identity_proposals`, `content_creative_directions`                                                           | accepted or rejected become stale (creative directions: accepted becomes proposed); the reviewer is cleared                                                          |
| `brand_book_exports`                                                                                                | `approved`, `exported` become `draft`; approval cleared                                                                                                              |
| `memory_items`                                                                                                      | `approved` becomes `candidate`; decision cleared                                                                                                                     |
| strategy and catalogue tables (`content_pillars`, `content_rubrics`, `content_plan_items`, `product_*`, `products`) | status kept (it is the agency's working data and releases nothing); who decided or approved is cleared                                                               |
| collection pipelines and analysis tables                                                                            | unchanged, with the reason written next to the rule                                                                                                                  |

Template reuse during import looks only at agency templates (`client_id is null`) and, for a replacement, the replaced client's own templates; another client's private template is never mapped in.

The rules fail closed. `checkTrustCoverage` runs when the module loads and in a unit test: every client table with a status, approval, publication, decision or export column (or an export/approval table) needs a rule; every value of a status enum needs a target; every such column has to be named by the rule (cleared, set, or listed as deliberately left); a rule may only clear nullable columns; a rule that changes nothing states why. A new table, a new status value or a new approval column therefore stops the importer until someone decides what it means, as `SOFT_REFS` does for references. A status value this version does not know is refused at import (`UnsafePackageError`).

No package signature: a hash or HMAC proves origin only between installations that share a secret. The checks make an untrusted package harmless instead. A signature can be added later without changing the format (a new manifest field).

## Consequences

A package from a trusted source arrives needing the same clicks it needed on the source (submit, approve, publish, re-enable automations, re-approve the AI providers), and its templates must be published again. This is intended. Export records are not imported, so the files they pointed to are copied and then unreferenced until a cleanup removes them. A template of the package whose key and version already exist as another client's private template cannot be imported (the key and version are unique across the installation): the import fails and writes nothing, and the package has to be exported again with a new template version.

Residual: product `truth` levels inside the products' JSON metadata and the `verdict` of brand examples travel as they are; they guide wording and never release anything.
