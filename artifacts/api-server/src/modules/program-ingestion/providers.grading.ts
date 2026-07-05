/**
 * providers.grading.ts - Phase 3 Question Enrichment
 */

const GROQ_API_URL = "https://api.groq.com/openai/v1/chat/completions";
const GROQ_MODEL = "llama-3.3-70b-versatile";

export interface GradingCriterion {
  criterion: string;
  points: number;
  deductionOnError: string;
}

export interface EnrichedQuestionData {
  solution: string;
  solutionPlan: string;
  hint: string;
  gradingSchema: GradingCriterion[];
  modelAnswer: string;
  answerFromPdf: boolean;
}

function buildPrompt(questionText: string, modelAnswer: string): string {
  return (
    "You are an expert tutor. Analyze this question and correct answer.\n\n" +
    "QUESTION:\n" + questionText + "\n\n" +
    "CORRECT ANSWER:\n" + modelAnswer + "\n\n" +
    "Return JSON with these exact keys: solution, solutionPlan, hint, gradingSchema.\n" +
    "solution: Detailed step-by-step worked solution (min 3 steps).\n" +
    "solutionPlan: High-level bullet plan, NO details, 3-5 bullets.\n" +
    "hint: Single hint that nudges WITHOUT giving the answer.\n" +
    "gradingSchema: array of 2-5 criteria objects, points must sum to 100.\n\n" +
    "CRITICAL: You MUST wrap all math, equations, and symbols in $...$ (inline) or $$...$$ (display) delimiters."
  );
}

export async function enrichQuestion(
  questionText: string,
  modelAnswer: string,
  answerFromPdf: boolean,
  apiKey: string,
): Promise<EnrichedQuestionData> {
  const response = await fetch(GROQ_API_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": "Bearer " + apiKey },
    body: JSON.stringify({
      model: GROQ_MODEL, temperature: 0.1, max_tokens: 1200,
      messages: [
        { role: "system", content: "Output only valid JSON with keys: solution, solutionPlan, hint, gradingSchema." },
        { role: "user", content: buildPrompt(questionText, modelAnswer) },
      ],
    }),
  });

  if (!response.ok) throw new Error("Groq enrichment failed: " + response.status);

  const payload = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
  let raw = (payload.choices?.[0]?.message?.content ?? "").trim();
  if (raw.startsWith("```")) raw = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/, "");

  const parsed = JSON.parse(raw) as {
    solution?: string; solutionPlan?: string; hint?: string; gradingSchema?: GradingCriterion[];
  };

  const schema = (parsed.gradingSchema ?? []).filter(
    (c) => typeof c.criterion === "string" && typeof c.points === "number",
  );

  const total = schema.reduce((s, c) => s + c.points, 0);
  if (total !== 100 && total > 0) {
    const factor = 100 / total;
    let remaining = 100;
    schema.forEach((c, i) => {
      if (i < schema.length - 1) { c.points = Math.round(c.points * factor); remaining -= c.points; }
      else { c.points = remaining; }
    });
  }

  return {
    solution: parsed.solution ?? ("The correct answer is: " + modelAnswer),
    solutionPlan: parsed.solutionPlan ?? "Understand, apply method, verify",
    hint: parsed.hint ?? "Re-read the question and identify the method.",
    gradingSchema: schema.length > 0 ? schema
      : [{ criterion: "Correct answer", points: 100, deductionOnError: "All marks deducted" }],
    modelAnswer,
    answerFromPdf,
  };
}

export async function enrichQuestionsBatch(
  questions: Array<{ id: string; rawText: string; modelAnswer: string; answerFromPdf: boolean }>,
  apiKey: string,
  concurrency = 3,
  onProgress?: (done: number, total: number) => void,
): Promise<Record<string, EnrichedQuestionData>> {
  const results: Record<string, EnrichedQuestionData> = {};
  let done = 0;

  for (let i = 0; i < questions.length; i += concurrency) {
    const batch = questions.slice(i, i + concurrency);
    await Promise.all(batch.map(async (q) => {
      try {
        results[q.id] = await enrichQuestion(q.rawText, q.modelAnswer, q.answerFromPdf, apiKey);
      } catch (err) {
        console.error("[Grading] Failed for " + q.id + ":", err);
        results[q.id] = {
          solution: "The correct answer is: " + q.modelAnswer,
          solutionPlan: "Understand, apply method, verify",
          hint: "Re-read the question.",
          gradingSchema: [{ criterion: "Correct answer", points: 100, deductionOnError: "All marks deducted" }],
          modelAnswer: q.modelAnswer,
          answerFromPdf: q.answerFromPdf,
        };
      }
      done++;
      onProgress?.(done, questions.length);
    }));
  }

  return results;
}
