from __future__ import annotations

from typing import Any, Literal, Optional

from pydantic import BaseModel, Field


SourceKind = Literal["text", "image"]


class SourceRef(BaseModel):
    page: Optional[int] = None
    kind: SourceKind
    note: Optional[str] = None


class RegionBlueprint(BaseModel):
    region_id: str
    section_label: Optional[str] = None
    section_title: Optional[str] = None
    theme_name: Optional[str] = None
    source_refs: list[SourceRef] = Field(default_factory=list)


NodeType = Literal["exercise", "boss", "atomic_scroll"]


class NodeBlueprint(BaseModel):
    node_id: str
    node_type: NodeType
    region_id: Optional[str] = None
    textbook_ref: Optional[str] = None
    source_refs: list[SourceRef] = Field(default_factory=list)


class ExtractionTargets(BaseModel):
    questions: dict[str, Any] = Field(default_factory=dict)
    hints: dict[str, Any] = Field(default_factory=dict)


class QualityRules(BaseModel):
    no_hallucination: bool = True
    when_uncertain: Literal["set_null_and_add_note"] = "set_null_and_add_note"


class Blueprint(BaseModel):
    blueprint_version: str = "1.0"
    chapter_id: str
    chapter_title: Optional[str] = None
    domain: Optional[str] = None
    regions: list[RegionBlueprint] = Field(default_factory=list)
    node_plan: list[NodeBlueprint] = Field(default_factory=list)
    template_assignment: dict[str, str] = Field(default_factory=dict)
    extraction_targets: ExtractionTargets = Field(default_factory=ExtractionTargets)
    laborer_prompt: str
    quality_rules: QualityRules = Field(default_factory=QualityRules)
    notes: list[str] = Field(default_factory=list)


class TocItem(BaseModel):
    id: str
    title: str
    level: int
    ref: str | None = None
    page_range: tuple[int | None, int | None] | None = None
    children: list["TocItem"] = Field(default_factory=list)


class TocData(BaseModel):
    program_id: str
    program_title: str | None = None
    source: dict[str, Any] = Field(default_factory=dict)
    toc_tree: list[TocItem] = Field(default_factory=list)
    toc_notes: list[str] = Field(default_factory=list)


class AtomicScroll(BaseModel):
    scroll_id: str
    title: Optional[str] = None
    raw_text: Optional[str] = None
    latex: Optional[str] = None
    source_ref: SourceRef
    snippets: list[dict[str, Any]] = Field(default_factory=list)


class Region(BaseModel):
    region_id: str
    section_label: Optional[str] = None
    section_title: Optional[str] = None
    theme_name: Optional[str] = None


class HintRef(BaseModel):
    scroll_id: Optional[str] = None
    source_ref: Optional[SourceRef] = None


class QuestionPart(BaseModel):
    part_id: str
    raw_text: Optional[str] = None
    latex: Optional[str] = None


class Question(BaseModel):
    question_id: str
    raw_text: Optional[str] = None
    latex: Optional[str] = None
    parts: list[QuestionPart] = Field(default_factory=list)
    source_ref: SourceRef
    hint_refs: list[HintRef] = Field(default_factory=list)


class Node(BaseModel):
    node_id: str
    node_type: NodeType
    region_id: Optional[str] = None
    textbook_ref: Optional[str] = None
    tags: list[str] = Field(default_factory=list)
    question_count: Optional[int] = None
    questions: list[Question] = Field(default_factory=list)


class Edge(BaseModel):
    from_: str = Field(alias="from")
    to: str
    edge_type: Literal["prereq"] = "prereq"


class ChapterData(BaseModel):
    chapter_id: str
    title: Optional[str] = None
    created_at: str
    source: dict[str, Any] = Field(default_factory=dict)
    rendering: dict[str, Any] = Field(default_factory=dict)
    atomic_scrolls: list[AtomicScroll] = Field(default_factory=list)
    regions: list[Region] = Field(default_factory=list)
    nodes: list[Node] = Field(default_factory=list)
    edges: list[Edge] = Field(default_factory=list)
    notes: list[str] = Field(default_factory=list)


# Next-stage naming (keep backward compatibility)
ProgramData = ChapterData
