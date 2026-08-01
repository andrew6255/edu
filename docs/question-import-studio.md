# Question Import Studio

Status: approved product and technical specification

## Purpose

Question Import Studio is the canonical super-admin workflow for adding question papers to an existing single-subject program. It accepts one questions PDF and zero or more answer or marking-scheme PDFs, audits extraction, proposes a program-wide taxonomy change, and applies only admin-approved changes to the program's active draft.

## Product invariants

- A program has exactly one subject and at most one active draft.
- Editing a published program creates (or reopens) its active draft. Published versions are immutable.
- Folders may contain folders and terminal categories. Questions may only belong to categories.
- Organizer output is a proposal. It never silently changes existing content.
- Stable question and node IDs survive moves and renames, preserving student progress.
- Source answers and AI-generated answers are visibly distinct.
- Major structure changes are approved before individual placements.
- Applying an import is atomic and creates an auditable structure version.

## Workflow

1. Upload one questions PDF plus optional answer PDFs into the active program draft.
2. Extract questions, subquestions, diagrams, tables, and answers with digital extraction or OCR.
3. Audit extracted content against the source with vision and text passes.
4. Check the batch for subject mismatches and duplicates.
5. Have the organizer propose a coherent taxonomy and typed structural change set for the whole batch.
6. Let the admin accept, reject, or edit structure changes.
7. Review individual question placements against the approved preview tree.
8. Apply approved operations atomically to the draft.
9. Publish a new immutable version after reviewing the change-impact summary.

## Review gates

Individual review is required for low extraction confidence, uncertain answer matches, generated answers, subject uncertainty, likely duplicates, low placement confidence, missing diagrams, or unreadable regions. Warning-free high-confidence questions may be bulk approved.

## Organizer contract

The organizer works in two passes. It first proposes a taxonomy for the complete batch, then assigns questions to terminal categories in that preview tree. It prefers existing terminology and prior admin decisions, keeps sibling semantics consistent, and penalizes unnecessary one-item depth.

The organizer profile is persistent program memory, not a permanently running agent. It stores preferred language and depth, minimum category size, naming style, custom instructions, and summarized admin decisions.

Supported operations are `create_node`, `rename_node`, `move_node`, `merge_nodes`, `split_node`, `reorder_node`, `place_question`, and `move_question`. The server rejects cycles, questions assigned to folders, children assigned to terminal categories, and destructive operations without an explicit destination.

## Answer provenance

Answer matching uses question labels, paper identifiers, page context, semantic compatibility, and sequence as a fallback. Extraction, answer, placement, and subject confidence remain independent.

Answer provenance is `source`, `embedded_source`, `ai_generated`, or `missing`. Generated answers are never presented as source answers and require individual review.

## Draft and concurrency behavior

The first edit to a published program forks its current published version into the single active draft. Later edits autosave there. Every mutation carries a revision number; stale revisions produce a conflict instead of overwriting another admin.

## Persistence additions

- `program_versions`
- `program_organizer_profiles`
- `program_ingestion_batches`
- `program_ingestion_sources`
- `program_structure_proposals`
- `program_structure_operations`
- `question_placement_proposals`
- `program_organizer_decisions`

Existing ingestion jobs, questions, assets, audits, and anomaly records remain the extraction foundation.

## Delivery plan

1. Add version/draft and batch/proposal persistence contracts.
2. Unify multi-source upload behind the server ingestion API.
3. Connect extraction auditing, answer provenance, subject checks, and duplicate checks.
4. Implement deterministic proposal validation and atomic application.
5. Add structure review and question placement workspaces.
6. Add impact summary, publishing, rollback, organizer memory, and collaborative presence.

