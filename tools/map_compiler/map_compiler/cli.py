from __future__ import annotations

import argparse
import json
from datetime import datetime, timezone
from pathlib import Path

from .dag import build_prereq_edges_from_blueprint
from .gemini_client import GeminiClient
from .image_io import load_images_from_dir
from .models import Blueprint, ChapterData, TocData
from .pdf_io import load_pdf_pages
from .prompts import architect_prompt, laborer_prompt, organizer_prompt


TEMPLATES_ALLOWED = [
    "RegionTemplate",
    "ExerciseNodeTemplate",
    "BossNodeTemplate",
    "AtomicScrollTemplate",
]


def _safe_json_extract(text: str) -> str:
    # Gemini may wrap JSON in fences. Extract the first JSON object.
    t = text.strip()
    if "```" in t:
        # naive fence stripping
        t = t.replace("```json", "```")
        parts = t.split("```")
        # choose the largest chunk
        t = max((p.strip() for p in parts), key=len)
    # attempt to locate first '{' and last '}'
    start = t.find("{")
    end = t.rfind("}")
    if start != -1 and end != -1 and end > start:
        return t[start : end + 1]
    return t


def run_architect(args: argparse.Namespace) -> int:
    if bool(args.pdf) == bool(args.images_dir):
        raise SystemExit("architect: provide exactly one of --pdf or --images-dir")

    chapter_context_text = ""
    images: list[bytes] = []

    if args.toc:
        toc_text = Path(args.toc).read_text(encoding="utf-8")
        # prepend TOC so the model uses the file organization as the backbone
        chapter_context_text += f"[TOC_JSON]\n{toc_text}\n\n"

    if args.images_dir:
        if args.text_file:
            chapter_context_text = Path(args.text_file).read_text(encoding="utf-8")
        img_pages = load_images_from_dir(args.images_dir)
        images = [p.png_bytes for p in img_pages]
    else:
        pages = load_pdf_pages(args.pdf, start_page=args.start_page, end_page=args.end_page, dpi=args.dpi)
        chapter_context_text = "\n\n".join(f"[PDF_PAGE={p.page_number}]\n{p.text}" for p in pages)
        images = [p.png_bytes for p in pages]

    prompt = architect_prompt(chapter_context_text=chapter_context_text, templates_allowed=TEMPLATES_ALLOWED)
    client = GeminiClient()
    raw = client.generate_json(system=prompt.system, user=prompt.user, images=images)
    json_text = _safe_json_extract(raw)

    blueprint = Blueprint.model_validate_json(json_text)

    out_path = Path(args.out)
    out_path.write_text(blueprint.model_dump_json(indent=2), encoding="utf-8")
    return 0


def run_organize(args: argparse.Namespace) -> int:
    if bool(args.pdf) == bool(args.images_dir):
        raise SystemExit("organize: provide exactly one of --pdf or --images-dir")

    file_context_text = ""
    images: list[bytes] = []

    if args.images_dir:
        if args.text_file:
            file_context_text = Path(args.text_file).read_text(encoding="utf-8")
        img_pages = load_images_from_dir(args.images_dir)
        images = [p.png_bytes for p in img_pages]
    else:
        pages = load_pdf_pages(args.pdf, start_page=args.start_page, end_page=args.end_page, dpi=args.dpi)
        file_context_text = "\n\n".join(f"[PDF_PAGE={p.page_number}]\n{p.text}" for p in pages)
        images = [p.png_bytes for p in pages]

    prompt = organizer_prompt(file_context_text=file_context_text)
    client = GeminiClient()
    raw = client.generate_json(system=prompt.system, user=prompt.user, images=images)
    json_text = _safe_json_extract(raw)

    parsed = json.loads(json_text)
    if not isinstance(parsed, dict):
        raise ValueError("Organizer output must be a JSON object.")
    if not parsed.get("program_id"):
        parsed["program_id"] = "inferred-program"

    # If user provided only a handful of page images, assume the TOC is partial.
    # Clamp output size to reduce hallucinated full-book TOCs.
    if args.images_dir and isinstance(images, list) and len(images) <= 10:
        max_items = 80

        def _clamp_toc_items(items: list[dict], remaining: list[int]) -> list[dict]:
            out: list[dict] = []
            for it in items:
                if remaining[0] <= 0:
                    break
                if not isinstance(it, dict):
                    continue
                remaining[0] -= 1
                children = it.get("children")
                if isinstance(children, list) and children:
                    it["children"] = _clamp_toc_items(children, remaining)
                out.append(it)
            return out

        toc_tree = parsed.get("toc_tree")
        if isinstance(toc_tree, list):
            parsed["toc_tree"] = _clamp_toc_items(toc_tree, [max_items])

        notes = parsed.get("toc_notes")
        if not isinstance(notes, list):
            notes = []
        notes = [n for n in notes if isinstance(n, str) and "complete" not in n.lower()]
        notes.append("TOC is partial (limited evidence: small number of page images provided).")
        parsed["toc_notes"] = notes

    toc = TocData.model_validate(parsed)
    out_path = Path(args.out)
    out_path.write_text(toc.model_dump_json(indent=2), encoding="utf-8")
    return 0


def run_laborer(args: argparse.Namespace) -> int:
    if bool(args.pdf) == bool(args.images_dir):
        raise SystemExit("laborer: provide exactly one of --pdf or --images-dir")

    blueprint_text = Path(args.blueprint).read_text(encoding="utf-8")
    blueprint = Blueprint.model_validate_json(blueprint_text)

    exercise_pages_text = ""
    images: list[bytes] = []

    if args.images_dir:
        if args.text_file:
            exercise_pages_text = Path(args.text_file).read_text(encoding="utf-8")
        img_pages = load_images_from_dir(args.images_dir)
        images = [p.png_bytes for p in img_pages]
    else:
        pages = load_pdf_pages(args.pdf, start_page=args.start_page, end_page=args.end_page, dpi=args.dpi)
        exercise_pages_text = "\n\n".join(f"[PDF_PAGE={p.page_number}]\n{p.text}" for p in pages)
        images = [p.png_bytes for p in pages]

    prompt = laborer_prompt(blueprint_json=blueprint.model_dump_json(indent=2), exercise_pages_text=exercise_pages_text)
    client = GeminiClient()
    used_non_verbatim = False

    def _non_verbatim_prompt_pair() -> tuple[str, str]:
        system = (
            "You are Laborer in NON-VERBATIM mode. "
            "You MUST output ONLY valid JSON (no markdown). "
            "Do NOT reproduce copyrighted text verbatim. "
            "Paraphrase problem statements and worked examples in your own words. "
            "Avoid direct quotes. If you must quote, keep it extremely short (a few words). "
            "Preserve math meaning and structure; include LaTeX only for short formulas when confident. "
            "If unsure, set raw_text=null/latex=null and provide source_ref."
        )

        user = (
            "INPUTS:\n"
            "1) blueprint_json:\n"
            f"{blueprint.model_dump_json(indent=2)}\n\n"
            "2) exercise_pages_text:\n"
            f"{exercise_pages_text}\n\n"
            "TASK:\n"
            "Produce ChapterData JSON matching the schema in the blueprint. "
            "In this mode, every raw_text you provide must be a PARAPHRASE (not a transcript). "
            "Add a note in notes[]: 'non_verbatim_paraphrase=true'."
        )

        return system, user

    try:
        raw = client.generate_json(system=prompt.system, user=prompt.user, images=images)
        json_text = _safe_json_extract(raw)
    except RuntimeError as e:
        msg = str(e)
        if "finish_reason=4" in msg or "copyright" in msg.lower():
            try:
                nv_system, nv_user = _non_verbatim_prompt_pair()
                raw2 = client.generate_json(system=nv_system, user=nv_user, images=images)
                json_text = _safe_json_extract(raw2)
                used_non_verbatim = True
            except RuntimeError:
                stub = {
                    "chapter_id": blueprint.chapter_id,
                    "title": blueprint.chapter_title,
                    "created_at": datetime.now(timezone.utc).isoformat(),
                    "source": {"pdf_name": None, "page_range": [None, None]},
                    "rendering": {"math_format": {"raw_text": True, "latex": True}},
                    "atomic_scrolls": [
                        {
                            "scroll_id": n.node_id,
                            "title": None,
                            "raw_text": None,
                            "latex": None,
                            "source_ref": {"page": None, "kind": "image", "note": "blocked by model safety"},
                            "snippets": [],
                        }
                        for n in blueprint.node_plan
                        if n.node_type == "atomic_scroll"
                    ],
                    "regions": [
                        {
                            "region_id": r.region_id,
                            "section_label": r.section_label,
                            "section_title": r.section_title,
                            "theme_name": r.theme_name,
                        }
                        for r in blueprint.regions
                    ],
                    "nodes": [
                        {
                            "node_id": n.node_id,
                            "node_type": n.node_type,
                            "region_id": n.region_id,
                            "textbook_ref": n.textbook_ref,
                            "tags": [],
                            "question_count": None,
                            "questions": [],
                        }
                        for n in blueprint.node_plan
                        if n.node_type in ("exercise", "boss")
                    ],
                    "edges": [],
                    "notes": [
                        "Model output was blocked (copyright recitation). Emitted stub program with empty questions/scroll text.",
                    ],
                }
                json_text = json.dumps(stub)
        else:
            raise

    # Fill in a few required fields if omitted (keep model output primary)
    parsed = json.loads(json_text)
    parsed["created_at"] = datetime.now(timezone.utc).isoformat()
    parsed.setdefault("rendering", {"math_format": {"raw_text": True, "latex": True}})

    if used_non_verbatim:
        notes = parsed.get("notes")
        if not isinstance(notes, list):
            notes = []
        if "non_verbatim_paraphrase=true" not in notes:
            notes.append("non_verbatim_paraphrase=true")
        parsed["notes"] = notes

    def _default_source_ref(note: str) -> dict:
        return {"page": None, "kind": "image", "note": note}

    atomic_scrolls = parsed.get("atomic_scrolls")
    if isinstance(atomic_scrolls, list):
        for i, s in enumerate(atomic_scrolls):
            if not isinstance(s, dict):
                continue

            if ("scroll_id" not in s or s.get("scroll_id") in (None, "")) and isinstance(s.get("node_id"), str):
                s["scroll_id"] = s["node_id"]
            s.pop("node_id", None)

            if "source_ref" not in s or s.get("source_ref") in (None, ""):
                s["source_ref"] = _default_source_ref(f"missing source_ref for atomic_scrolls[{i}]")

    nodes = parsed.get("nodes")
    if isinstance(nodes, list):
        blueprint_region_by_node_id = {n.node_id: n.region_id for n in blueprint.node_plan}
        for ni, n in enumerate(nodes):
            if not isinstance(n, dict):
                continue

            if (n.get("region_id") is None or n.get("region_id") == "") and isinstance(n.get("node_id"), str):
                rid = blueprint_region_by_node_id.get(n["node_id"])
                if rid:
                    n["region_id"] = rid

            questions = n.get("questions")
            if not isinstance(questions, list):
                continue
            for qi, q in enumerate(questions):
                if not isinstance(q, dict):
                    continue

                if "source_ref" not in q or q.get("source_ref") in (None, ""):
                    q["source_ref"] = _default_source_ref(f"missing source_ref for nodes[{ni}].questions[{qi}]")

                parts = q.get("parts")
                if not isinstance(parts, list):
                    continue
                for pi, part in enumerate(parts):
                    if not isinstance(part, dict):
                        continue

                    # Model sometimes emits {question_id: 'Q1a', raw_text: ...} for parts.
                    if "part_id" not in part or part.get("part_id") in (None, ""):
                        derived = part.get("question_id")
                        if not derived:
                            derived = f"{q.get('question_id', 'part')}_{pi+1}"
                        part["part_id"] = derived

                    # Strip unexpected keys that can break QuestionPart validation.
                    part.pop("question_id", None)

    # Deterministic DAG: if the model omitted edges (or returned empty), generate them.
    edges = parsed.get("edges")
    if not isinstance(edges, list) or len(edges) == 0:
        dag = build_prereq_edges_from_blueprint(blueprint)
        parsed["edges"] = [e.model_dump(by_alias=True) for e in dag.edges]
        notes = parsed.get("notes")
        if not isinstance(notes, list):
            notes = []
        notes.extend(["Edges auto-generated from blueprint ordering (MVP prereq chain)."])
        notes.extend(dag.notes)
        parsed["notes"] = notes

    chapter_data = ChapterData.model_validate(parsed)

    out_path = Path(args.out)
    out_path.write_text(chapter_data.model_dump_json(indent=2, by_alias=True), encoding="utf-8")
    return 0


def run_export_mermaid(args: argparse.Namespace) -> int:
    program_text = Path(args.program).read_text(encoding="utf-8")
    program = ChapterData.model_validate_json(program_text)

    label_by_id: dict[str, str] = {}
    for n in program.nodes:
        label = n.textbook_ref or n.node_id
        # Mermaid node labels can't contain raw newlines or quotes safely.
        safe = label.replace("\n", " ").replace('"', "'").strip()
        label_by_id[n.node_id] = safe

    lines: list[str] = []
    lines.append("flowchart LR")

    # Declare nodes with labels.
    for node_id, label in label_by_id.items():
        lines.append(f"  {node_id}[\"{label}\"]")

    # Render edges.
    for e in program.edges:
        src = e.from_
        dst = e.to
        if src not in label_by_id:
            label_by_id[src] = src
            lines.append(f"  {src}[\"{src}\"]")
        if dst not in label_by_id:
            label_by_id[dst] = dst
            lines.append(f"  {dst}[\"{dst}\"]")
        lines.append(f"  {src} --> {dst}")

    Path(args.out).write_text("\n".join(lines) + "\n", encoding="utf-8")
    return 0


def run_export_toc_mermaid(args: argparse.Namespace) -> int:
    toc_text = Path(args.toc).read_text(encoding="utf-8")
    toc = TocData.model_validate_json(toc_text)

    def _safe_node_id(raw: str) -> str:
        out = []
        for ch in raw:
            if ch.isalnum() or ch == "_":
                out.append(ch)
            else:
                out.append("_")
        s = "".join(out)
        while "__" in s:
            s = s.replace("__", "_")
        s = s.strip("_")
        if not s:
            s = "node"
        if s[0].isdigit():
            s = f"N_{s}"
        return f"TOC_{s}"

    def _label(s: str | None) -> str:
        if not s:
            return "(untitled)"
        return s.replace("\n", " ").replace('"', "'").strip()

    lines: list[str] = []
    lines.append("flowchart LR")

    declared: set[str] = set()

    def _declare(node_id: str, label: str) -> None:
        if node_id in declared:
            return
        declared.add(node_id)
        lines.append(f"  {node_id}[\"{label}\"]")

    # Flatten top-level (level=1) entries in order.
    top = toc.model_dump().get("toc_tree", [])
    top_items = [it for it in top if isinstance(it, dict)]

    top_node_ids: list[str] = []
    for it in top_items:
        raw_id = str(it.get("id") or it.get("title") or "")
        node_id = _safe_node_id(raw_id)
        _declare(node_id, _label(it.get("title")))
        top_node_ids.append(node_id)

        # Optionally add children (sections) as subnodes.
        if args.include_sections:
            children = it.get("children")
            if isinstance(children, list):
                for ch in children:
                    if not isinstance(ch, dict):
                        continue
                    ch_raw_id = str(ch.get("id") or ch.get("title") or "")
                    ch_node_id = _safe_node_id(f"{raw_id}__{ch_raw_id}")
                    _declare(ch_node_id, _label(ch.get("title")))
                    lines.append(f"  {node_id} -.-> {ch_node_id}")

    # Sequential progression across top-level items (MVP).
    for a, b in zip(top_node_ids, top_node_ids[1:]):
        lines.append(f"  {a} --> {b}")

    Path(args.out).write_text("\n".join(lines) + "\n", encoding="utf-8")
    return 0


def run_normalize_manual(args: argparse.Namespace) -> int:
    blueprint_text = Path(args.blueprint).read_text(encoding="utf-8")
    blueprint = Blueprint.model_validate_json(blueprint_text)

    raw_text = Path(args.input).read_text(encoding="utf-8")
    try:
        parsed = json.loads(raw_text)
    except json.JSONDecodeError as e:
        # Common when copy/pasting LaTeX into JSON: backslashes like \dots, \times, etc.
        # Attempt a best-effort fix by escaping single backslashes, while preserving existing
        # double-backslashes (e.g. LaTeX line breaks "\\").
        placeholder = "__MAP_COMPILER_DBL_BSLASH__"
        fixed = raw_text.replace("\\\\", placeholder)
        fixed = fixed.replace("\\", "\\\\")
        fixed = fixed.replace(placeholder, "\\\\")
        try:
            parsed = json.loads(fixed)
        except json.JSONDecodeError as e2:
            raise ValueError(
                "Manual JSON could not be parsed. It likely contains invalid backslash escapes (LaTeX). "
                "Try replacing all backslashes in LaTeX strings with double backslashes (e.g. \\\\times)."
            ) from e2
    if not isinstance(parsed, dict):
        raise ValueError("Manual input must be a JSON object.")

    def _default_source_ref(note: str) -> dict:
        return {"page": None, "kind": "image", "note": note}

    # Backfill region_id for nodes from blueprint.
    blueprint_region_by_node_id = {n.node_id: n.region_id for n in blueprint.node_plan}

    # Atomic scroll normalization: support {content:{raw_text,latex}, source_refs:[...]}
    atomic_scrolls = parsed.get("atomic_scrolls")
    if isinstance(atomic_scrolls, list):
        for i, s in enumerate(atomic_scrolls):
            if not isinstance(s, dict):
                continue

            # Flatten content -> raw_text/latex
            content = s.pop("content", None)
            if isinstance(content, dict):
                s.setdefault("raw_text", content.get("raw_text"))
                s.setdefault("latex", content.get("latex"))

            # Convert source_refs -> source_ref
            if "source_ref" not in s or s.get("source_ref") in (None, ""):
                srcs = s.pop("source_refs", None)
                if isinstance(srcs, list) and len(srcs) > 0 and isinstance(srcs[0], dict):
                    s["source_ref"] = srcs[0]
                else:
                    s["source_ref"] = _default_source_ref(f"missing source_ref for atomic_scrolls[{i}]")
            else:
                s.pop("source_refs", None)

            s.setdefault("snippets", [])

    # Node/question normalization: support question.text.{raw_text,latex}
    nodes = parsed.get("nodes")
    if isinstance(nodes, list):
        for ni, n in enumerate(nodes):
            if not isinstance(n, dict):
                continue

            node_id = n.get("node_id")
            if (n.get("region_id") is None or n.get("region_id") == "") and isinstance(node_id, str):
                rid = blueprint_region_by_node_id.get(node_id)
                if rid:
                    n["region_id"] = rid

            # map title -> textbook_ref (schema expects textbook_ref)
            if "textbook_ref" not in n and isinstance(n.get("title"), str):
                n["textbook_ref"] = n.get("title")
            n.pop("title", None)

            questions = n.get("questions")
            if not isinstance(questions, list):
                continue

            # choose a default question source ref from the node's source_refs if present
            node_src = None
            node_srcs = n.get("source_refs")
            if isinstance(node_srcs, list) and len(node_srcs) > 0 and isinstance(node_srcs[0], dict):
                node_src = node_srcs[0]
            n.pop("source_refs", None)

            for qi, q in enumerate(questions):
                if not isinstance(q, dict):
                    continue

                # flatten text -> raw_text/latex
                t = q.pop("text", None)
                if isinstance(t, dict):
                    q.setdefault("raw_text", t.get("raw_text"))
                    q.setdefault("latex", t.get("latex"))

                # parts: flatten part.text -> raw_text/latex
                parts = q.get("parts")
                if isinstance(parts, list):
                    for pi, part in enumerate(parts):
                        if not isinstance(part, dict):
                            continue
                        pt = part.pop("text", None)
                        if isinstance(pt, dict):
                            part.setdefault("raw_text", pt.get("raw_text"))
                            part.setdefault("latex", pt.get("latex"))

                        if "part_id" not in part or part.get("part_id") in (None, ""):
                            derived = part.get("question_id")
                            if not derived:
                                derived = f"{q.get('question_id', 'part')}_{pi+1}"
                            part["part_id"] = derived
                        part.pop("question_id", None)

                # required by schema
                if "source_ref" not in q or q.get("source_ref") in (None, ""):
                    q["source_ref"] = node_src or _default_source_ref(
                        f"missing source_ref for nodes[{ni}].questions[{qi}]"
                    )

                q.setdefault("hint_refs", [])

    # Ensure rendering exists
    parsed.setdefault("rendering", {"math_format": {"raw_text": True, "latex": True}})

    # Ensure edges exist; auto-generate if missing/empty
    edges = parsed.get("edges")
    if not isinstance(edges, list) or len(edges) == 0:
        dag = build_prereq_edges_from_blueprint(blueprint)
        parsed["edges"] = [e.model_dump(by_alias=True) for e in dag.edges]
        notes = parsed.get("notes")
        if not isinstance(notes, list):
            notes = []
        notes.extend(["Edges auto-generated from blueprint ordering (MVP prereq chain)."])
        notes.extend(dag.notes)
        parsed["notes"] = notes

    chapter_data = ChapterData.model_validate(parsed)
    out_path = Path(args.out)
    out_path.write_text(chapter_data.model_dump_json(indent=2, by_alias=True), encoding="utf-8")
    return 0


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(prog="map_compiler")
    sub = p.add_subparsers(dest="cmd", required=True)

    arch = sub.add_parser("architect", help="Generate Blueprint JSON from PDF pages")
    arch.add_argument("--pdf", required=False)
    arch.add_argument("--images-dir", required=False)
    arch.add_argument("--text-file", required=False)
    arch.add_argument("--toc", required=False)
    arch.add_argument("--out", required=True)
    arch.add_argument("--start-page", type=int, default=None)
    arch.add_argument("--end-page", type=int, default=None)
    arch.add_argument("--dpi", type=int, default=150)
    arch.set_defaults(func=run_architect)

    lab = sub.add_parser("laborer", help="Generate ChapterData JSON using an existing Blueprint")
    lab.add_argument("--pdf", required=False)
    lab.add_argument("--images-dir", required=False)
    lab.add_argument("--text-file", required=False)
    lab.add_argument("--blueprint", required=True)
    lab.add_argument("--out", required=True)
    lab.add_argument("--start-page", type=int, default=None)
    lab.add_argument("--end-page", type=int, default=None)
    lab.add_argument("--dpi", type=int, default=150)
    lab.set_defaults(func=run_laborer)

    org = sub.add_parser("organize", help="Generate TOC JSON (extract or generate)")
    org.add_argument("--pdf", required=False)
    org.add_argument("--images-dir", required=False)
    org.add_argument("--text-file", required=False)
    org.add_argument("--out", required=True)
    org.add_argument("--start-page", type=int, default=None)
    org.add_argument("--end-page", type=int, default=None)
    org.add_argument("--dpi", type=int, default=150)
    org.set_defaults(func=run_organize)

    norm = sub.add_parser("normalize-manual", help="Normalize manual Gemini JSON into ChapterData schema")
    norm.add_argument("--input", required=True, help="Path to manual Gemini JSON")
    norm.add_argument("--blueprint", required=True, help="Path to Blueprint JSON")
    norm.add_argument("--out", required=True, help="Output ChapterData JSON path")
    norm.set_defaults(func=run_normalize_manual)

    mer = sub.add_parser("export-mermaid", help="Export a Mermaid flowchart from ChapterData/ProgramData")
    mer.add_argument("--program", required=True, help="Path to ChapterData/ProgramData JSON")
    mer.add_argument("--out", required=True, help="Output .mmd file")
    mer.set_defaults(func=run_export_mermaid)

    toc_mer = sub.add_parser("export-toc-mermaid", help="Export a full-book Mermaid map from TocData")
    toc_mer.add_argument("--toc", required=True, help="Path to TocData JSON")
    toc_mer.add_argument("--out", required=True, help="Output .mmd file")
    toc_mer.add_argument(
        "--include-sections",
        action="store_true",
        help="Also include section-level children as dashed subnodes under each top-level item",
    )
    toc_mer.set_defaults(func=run_export_toc_mermaid)

    return p


def main() -> int:
    parser = build_parser()
    args = parser.parse_args()
    return args.func(args)


if __name__ == "__main__":
    raise SystemExit(main())
