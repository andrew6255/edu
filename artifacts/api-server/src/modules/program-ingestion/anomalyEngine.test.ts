import { describe, it, expect } from "vitest";
import { evaluateQuestionAnomalies, QuestionAnomalyInput } from "./anomalyEngine";

describe("Anomaly Detection Engine (Super-Admin Verification Workflow)", () => {
  const baseValidInput: QuestionAnomalyInput = {
    correctChoiceIndex: 1,
    hasAnswerMap: true,
    blocks: [{ type: "text", content: "What is 2 + 2?" }],
    choices: ["A) 3", "B) 4", "C) 5", "D) 6"],
    hasQuestionImage: false,
  };

  it("assigns VERIFIED status with zero flags for standard valid multiple choice questions", () => {
    const res = evaluateQuestionAnomalies(baseValidInput);
    expect(res.reviewStatus).toBe("VERIFIED");
    expect(res.flags).toEqual([]);
  });

  it("flags MISSING_ANSWER_KEY when correct choice was not resolved from answer key section", () => {
    const res = evaluateQuestionAnomalies({
      ...baseValidInput,
      correctChoiceIndex: -1,
    });
    expect(res.reviewStatus).toBe("FLAGGED_FOR_REVIEW");
    expect(res.flags).toContain("MISSING_ANSWER_KEY");
  });

  it("flags CONTAINS_DIAGRAM when question prompt or choice contains visual images", () => {
    // Case 1: Image block in prompt
    const res1 = evaluateQuestionAnomalies({
      ...baseValidInput,
      blocks: [{ type: "text", content: "See diagram below:" }, { type: "image", src: "data:image/png;base64,..." }],
    });
    expect(res1.reviewStatus).toBe("FLAGGED_FOR_REVIEW");
    expect(res1.flags).toContain("CONTAINS_DIAGRAM");

    // Case 2: Choice is an image
    const res2 = evaluateQuestionAnomalies({
      ...baseValidInput,
      choices: ["data:image/png;base64,111", "data:image/png;base64,222"],
    });
    expect(res2.reviewStatus).toBe("FLAGGED_FOR_REVIEW");
    expect(res2.flags).toContain("CONTAINS_DIAGRAM");
  });

  it("flags FEW_CHOICES when a question has fewer than 2 choices", () => {
    const res = evaluateQuestionAnomalies({
      ...baseValidInput,
      choices: ["A) Only option"],
    });
    expect(res.reviewStatus).toBe("FLAGGED_FOR_REVIEW");
    expect(res.flags).toContain("FEW_CHOICES");
  });

  it("accumulates multiple anomaly flags when multiple rules are violated simultaneously", () => {
    const res = evaluateQuestionAnomalies({
      correctChoiceIndex: -1,
      hasAnswerMap: true,
      blocks: [{ type: "image" }],
      choices: [],
      hasQuestionImage: true,
    });
    expect(res.reviewStatus).toBe("FLAGGED_FOR_REVIEW");
    expect(res.flags).toHaveLength(3);
    expect(res.flags).toContain("MISSING_ANSWER_KEY");
    expect(res.flags).toContain("CONTAINS_DIAGRAM");
    expect(res.flags).toContain("FEW_CHOICES");
  });
});
