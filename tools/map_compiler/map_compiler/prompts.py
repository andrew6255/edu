from __future__ import annotations

from dataclasses import dataclass


@dataclass
class PromptPair:
    system: str
    user: str


def organizer_prompt(*, file_context_text: str) -> PromptPair:
    system = (
        "You are Organizer, responsible for understanding the organization of an uploaded math book/PDF.\n"
        "Your job is to extract an existing table of contents (TOC) if present, or generate one if missing.\n\n"
        "You MUST: Output ONLY valid JSON (no markdown). Do not hallucinate page numbers; if unknown, set them to null. "
        "If uncertain about a title/ref, set it to null and add a note in toc_notes. "
        "If the provided pages show only a partial TOC, output ONLY what is visible and note that the TOC is partial."
    )

    user = f"""INPUTS:\n1) file_context_text:\n{file_context_text}\n\nTASK:\nProduce a normalized TOC JSON for this file.\n\nOUTPUT JSON SCHEMA (must follow):\n{{\n  \"program_id\": string,\n  \"program_title\": string|null,\n  \"source\": {{ \"file_name\": string|null, \"page_range\": [int|null, int|null] }},\n  \"toc_tree\": [\n    {{\n      \"id\": string,\n      \"title\": string,\n      \"level\": int,\n      \"ref\": string|null,\n      \"page_range\": [int|null, int|null]|null,\n      \"children\": [ ... same shape ... ]\n    }}\n  ],\n  \"toc_notes\": [string]\n}}\n\nRULES:\n- If the file has Units/Chapters/Sections/Exercises, reflect that hierarchy.\n- If there is no TOC visible in the provided pages, generate ONLY the hierarchy you can justify from visible headings/page structure in the provided pages.\n- Do NOT extrapolate or invent additional Units/Chapters/Sections not visible in the provided pages.\n- Keep ids stable and human-readable (slug-like).\n"""

    return PromptPair(system=system, user=user)


def architect_prompt(*, chapter_context_text: str, templates_allowed: list[str]) -> PromptPair:
    system = (
        "You are Architect, a schema-template selector and extraction planner for a gamified math textbook pipeline.\n"
        "Your job is to: (1) Identify chapter/section/exercise structure. (2) Identify Self Tutor/example boxes as Atomic Scrolls. "
        "(3) Produce a Blueprint JSON that tells a second model (Laborer) exactly what to extract.\n\n"
        "You MUST: Output ONLY valid JSON (no markdown). Choose templates only from templates_allowed. "
        "Never invent new top-level keys outside the provided output schema. If uncertain, set fields to null and add a note in notes[]."
    )

    user = f"""INPUTS:\n1) chapter_context_text:\n{chapter_context_text}\n\n2) templates_allowed:\n{templates_allowed}\n\nTASK:\nGenerate a Blueprint JSON for this chapter using the output schema below.\n\nOUTPUT JSON SCHEMA (you must follow this exactly):\n{{\n  \"blueprint_version\": \"1.0\",\n  \"chapter_id\": string,\n  \"chapter_title\": string|null,\n  \"domain\": string|null,\n  \"regions\": [\n    {{\n      \"region_id\": string,\n      \"section_label\": string|null,\n      \"section_title\": string|null,\n      \"theme_name\": string|null,\n      \"source_refs\": [ {{ \"page\": int|null, \"kind\": \"text\"|\"image\", \"note\": string|null }} ]\n    }}\n  ],\n  \"node_plan\": [\n    {{\n      \"node_id\": string,\n      \"node_type\": \"exercise\"|\"boss\"|\"atomic_scroll\",\n      \"region_id\": string|null,\n      \"textbook_ref\": string|null,\n      \"source_refs\": [ {{ \"page\": int|null, \"kind\": \"text\"|\"image\", \"note\": string|null }} ]\n    }}\n  ],\n  \"template_assignment\": {{\n    \"region\": \"RegionTemplate\",\n    \"exercise\": \"ExerciseNodeTemplate\",\n    \"boss\": \"BossNodeTemplate\",\n    \"atomic_scroll\": \"AtomicScrollTemplate\"\n  }},\n  \"extraction_targets\": {{\n    \"questions\": {{ \"include_full_text\": true, \"include_latex\": true }},\n    \"hints\": {{ \"include_self_tutor_scrolls\": true, \"include_example_snippets\": true }}\n  }},\n  \"laborer_prompt\": string,\n  \"quality_rules\": {{\n    \"no_hallucination\": true,\n    \"when_uncertain\": \"set_null_and_add_note\"\n  }},\n  \"notes\": [string]\n}}\n\nIMPORTANT RULES:\n- Use human-readable stable IDs: Regions: CH{{chapter}}_SEC_{{A..H}}, Exercises: CH{{chapter}}_EX_{{1A..}}, Boss: CH{{chapter}}_BOSS_{{...}}, Scrolls: CH{{chapter}}_SCROLL_{{topic_slug}}\n- Identify boss candidates (Review Set, Investigation) if present.\n- Do not create prerequisites here; just plan nodes and extraction.\n"""

    return PromptPair(system=system, user=user)


def laborer_prompt(*, blueprint_json: str, exercise_pages_text: str) -> PromptPair:
    system = (
        "You are Laborer, an extraction engine.\n"
        "You MUST: Output ONLY valid JSON (no markdown). Follow the Blueprint exactly. "
        "Extract full question text for all questions. Provide raw_text always; provide latex when confident; otherwise latex=null. "
        "Never invent questions, numbers, or answers. If unreadable, set raw_text=null and cite source_ref."
    )

    user = f"""INPUTS:\n1) blueprint_json:\n{blueprint_json}\n\n2) exercise_pages_text:\n{exercise_pages_text}\n\nTASK:\nGenerate ChapterData JSON for this chapter that matches the Blueprint.\n\nOUTPUT JSON SCHEMA (must follow):\n{{\n  \"chapter_id\": string,\n  \"title\": string|null,\n  \"created_at\": string,\n  \"source\": {{ \"pdf_name\": string|null, \"page_range\": [int|null, int|null] }},\n  \"rendering\": {{ \"math_format\": {{ \"raw_text\": true, \"latex\": true }} }},\n  \"atomic_scrolls\": [ ... ],\n  \"regions\": [ ... ],\n  \"nodes\": [ ... ],\n  \"edges\": [ {{ \"from\": string, \"to\": string, \"edge_type\": \"prereq\" }} ],\n  \"notes\": [string]\n}}\n\nQUALITY RULES:\n- Don’t guess unreadable text; set null and cite page.\n- For every extracted atomic_scroll and every question, include a source_ref with page=null if unknown. Do not omit source_ref.\n- Keep question_id stable: Q1, Q2, ...\n- For question parts, use part_id only: \"a\", \"b\", \"c\" ... (do not use question_id inside parts).\n- Avoid inventing timestamps; you may omit created_at and it will be filled by the pipeline.\n"""

    return PromptPair(system=system, user=user)
