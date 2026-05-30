from __future__ import annotations

from dataclasses import dataclass

from .models import Blueprint, Edge


@dataclass(frozen=True)
class DagBuildResult:
    edges: list[Edge]
    notes: list[str]


def build_prereq_edges_from_blueprint(blueprint: Blueprint) -> DagBuildResult:
    """Build a deterministic prereq chain based on Blueprint ordering.

    MVP rule:
    - Follow the order of blueprint.node_plan as the canonical progression order.
    - Create edges between consecutive nodes of type exercise/boss.

    This is intentionally simple and deterministic. More advanced branching can be
    introduced later via a rules.yaml overlay.
    """

    notes: list[str] = []
    edges: list[Edge] = []

    playable = [n for n in blueprint.node_plan if n.node_type in ("exercise", "boss")]
    node_ids = [n.node_id for n in playable]
    if len(node_ids) < 2:
        return DagBuildResult(edges=[], notes=["Not enough nodes to build edges."])

    for prev_id, next_id in zip(node_ids, node_ids[1:]):
        if prev_id == next_id:
            notes.append(f"Duplicate node_id in blueprint ordering: {prev_id}")
            continue
        edges.append(Edge.model_validate({"from": prev_id, "to": next_id, "edge_type": "prereq"}))

    return DagBuildResult(edges=edges, notes=notes)
