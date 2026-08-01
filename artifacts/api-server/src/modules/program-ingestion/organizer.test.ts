import { describe, expect, it } from "vitest";
import { requiresIndividualReview, validateOrganizerProposal } from "./organizer";
import { DeterministicOrganizerProvider } from "./providers.organizer";

const folder = { id: "algebra", title: "Algebra", kind: "folder" as const, children: [{ id: "lines", title: "Equations of Lines", kind: "category" as const, children: [] }] };

describe("organizer proposal validation", () => {
  it("accepts placements into terminal categories", () => {
    expect(() => validateOrganizerProposal({ baseRevision: 2, previewTree: [folder], operations: [], placements: [{ id: "p1", questionId: "q1", destinationCategoryId: "lines", alternativeCategoryIds: [], confidence: 0.94, rationale: "Tests line equations", decision: "pending" }] })).not.toThrow();
  });
  it("rejects questions placed in folders", () => {
    expect(() => validateOrganizerProposal({ baseRevision: 0, previewTree: [folder], operations: [], placements: [{ id: "p1", questionId: "q1", destinationCategoryId: "algebra", alternativeCategoryIds: [], confidence: 0.9, rationale: "", decision: "pending" }] })).toThrow(/terminal category/);
  });
  it("rejects categories with children", () => {
    expect(() => validateOrganizerProposal({ baseRevision: 0, previewTree: [{ id: "bad", title: "Bad", kind: "category", children: [folder] }], operations: [], placements: [] })).toThrow(/terminal/);
  });
});

describe("individual review gate", () => {
  const safe = { extractionConfidence: 0.95, answerConfidence: 0.95, placementConfidence: 0.9, subjectConfidence: 0.95, answerProvenance: "source" as const, flags: [], likelyDuplicate: false };
  it("allows bulk review only for warning-free high-confidence source answers", () => {
    expect(requiresIndividualReview(safe)).toBe(false);
    expect(requiresIndividualReview({ ...safe, answerProvenance: "ai_generated" })).toBe(true);
    expect(requiresIndividualReview({ ...safe, likelyDuplicate: true })).toBe(true);
    expect(requiresIndividualReview({ ...safe, subjectConfidence: 0.5 })).toBe(true);
  });
});

describe("deterministic organizer fallback", () => {
  it("creates a valid terminal category for an empty program", async () => {
    const result = await new DeterministicOrganizerProvider().organize({
      programId: "math", programSubject: "Mathematics", baseRevision: 0, currentTree: [],
      incomingQuestions: [{ id: "q1", text: "Find the slope of this line" }], existingQuestions: [],
    });
    expect(result.previewTree[0]?.kind).toBe("folder");
    expect(result.previewTree[0]?.children[0]?.kind).toBe("category");
    expect(result.placements[0]?.questionId).toBe("q1");
  });

  it("flags highly similar existing questions as likely duplicates", async () => {
    const result = await new DeterministicOrganizerProvider().organize({
      programId: "math", programSubject: "Mathematics", baseRevision: 1, currentTree: [folder],
      incomingQuestions: [{ id: "new", text: "Find equation line through two given points" }],
      existingQuestions: [{ id: "old", text: "Find equation line through two given points" }],
    });
    expect(result.assessments[0]?.likelyDuplicateQuestionId).toBe("old");
  });

  it("creates an algebraic expressions branch instead of using combinatorics", async () => {
    const combinatorics = { id: "combinatorics", title: "Combinatorics", kind: "folder" as const, children: [{ id: "permutations", title: "Combinations and Permutations", kind: "category" as const, children: [] }] };
    const result = await new DeterministicOrganizerProvider().organize({
      programId: "math", programSubject: "Mathematics", baseRevision: 2, currentTree: [combinatorics],
      incomingQuestions: [{ id: "q1", text: "Expand and factorize the algebraic expression (x + 2)(x - 3)." }], existingQuestions: [],
    });
    const destinationId = result.placements[0]?.destinationCategoryId;
    expect(destinationId).toContain("algebraic_expressions");
    expect(destinationId).not.toBe("permutations");
    expect(result.previewTree.some(node => node.title === "Algebra")).toBe(true);
  });
});
