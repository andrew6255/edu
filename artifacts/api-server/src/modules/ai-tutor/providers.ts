import type {
  TutorAnswerPackage,
  TutorChatInput,
  TutorChatResult,
  TutorEvaluationInput,
  TutorEvaluationResult,
  TutorPaperGradeRequest,
  TutorPaperGradeResult,
  TutorPaperHelpRequest,
  TutorPaperHelpResult,
} from './types';

export interface AiTutorExternalProvider {
  evaluateWork(input: TutorEvaluationInput): Promise<TutorEvaluationResult | null>;
  chat(input: TutorChatInput): Promise<TutorChatResult | null>;
  generateAnswer(questionPrompt: string): Promise<TutorAnswerPackage | null>;
  paperHelp(input: TutorPaperHelpRequest, answerPackage: TutorAnswerPackage): Promise<TutorPaperHelpResult | null>;
  gradePaper(input: TutorPaperGradeRequest, answerPackage: TutorAnswerPackage): Promise<TutorPaperGradeResult | null>;
}

type ChatContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } };

export function getAiTutorProviderConfig() {
  const serverGroqKey = (process.env['GROQ_API_KEY'] ?? '').trim();
  const legacyGroqKey = (process.env['VITE_GROQ_API_KEY'] ?? '').trim();
  // Groq keys are compact `gsk_...` values. A common local-env failure is an
  // accidentally concatenated value in GROQ_API_KEY while the legacy Vite
  // variable still contains the valid key. Prefer a structurally valid key so
  // the server can recover without ever sending the malformed credential.
  const isPlausibleGroqKey = (value: string) => value.startsWith('gsk_') && value.length >= 40 && value.length <= 120;
  const groqKey = isPlausibleGroqKey(serverGroqKey)
    ? serverGroqKey
    : isPlausibleGroqKey(legacyGroqKey) ? legacyGroqKey : serverGroqKey;
  const apiKey = (process.env['AI_TUTOR_API_KEY'] ?? process.env['OPENAI_API_KEY'] ?? groqKey).trim();
  const defaultBaseUrl = groqKey && !process.env['AI_TUTOR_API_KEY'] && !process.env['OPENAI_API_KEY']
    ? 'https://api.groq.com/openai/v1'
    : 'https://api.openai.com/v1';
  const baseUrl = (process.env['AI_TUTOR_BASE_URL'] ?? defaultBaseUrl).replace(/\/+$/, '');
  const defaultModel = defaultBaseUrl.includes('groq.com') ? 'llama-3.3-70b-versatile' : 'gpt-4o-mini';
  const model = (process.env['AI_TUTOR_MODEL'] ?? defaultModel).trim();
  return { apiKey, baseUrl, model };
}

function extractJsonObject(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start >= 0 && end > start) return JSON.parse(text.slice(start, end + 1));
    throw new Error('AI tutor response was not JSON.');
  }
}

function asEvaluation(value: unknown): TutorEvaluationResult | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as Partial<TutorEvaluationResult>;
  const status = record.stepStatus === 'correct' || record.stepStatus === 'partially_correct' || record.stepStatus === 'incorrect' || record.stepStatus === 'unclear'
    ? record.stepStatus
    : 'unclear';
  return {
    isCorrect: record.isCorrect === true,
    stepStatus: status,
    detectedMistake: typeof record.detectedMistake === 'string' ? record.detectedMistake : null,
    studentMessage: typeof record.studentMessage === 'string' ? record.studentMessage : 'I checked your work.',
    hint: typeof record.hint === 'string' ? record.hint : null,
    annotations: Array.isArray(record.annotations) ? record.annotations : [],
    nextExpectedStep: typeof record.nextExpectedStep === 'string' ? record.nextExpectedStep : null,
  };
}

function asChat(value: unknown): TutorChatResult | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as Partial<TutorChatResult>;
  if (typeof record.reply !== 'string') return null;
  return {
    reply: record.reply,
    suggestedActions: Array.isArray(record.suggestedActions) ? record.suggestedActions.filter((entry): entry is string => typeof entry === 'string') : [],
  };
}

function asAnswerPackage(value: unknown): TutorAnswerPackage | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  const modelAnswer = typeof record.modelAnswer === 'string' ? record.modelAnswer.trim() : '';
  if (!modelAnswer) return null;
  const highLevelSteps = Array.isArray(record.highLevelSteps)
    ? record.highLevelSteps.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0).slice(0, 12)
    : [];
  const fullSolution = Array.isArray(record.fullSolution)
    ? record.fullSolution.map((entry) => {
        if (!entry || typeof entry !== 'object') return null;
        const item = entry as Record<string, unknown>;
        return typeof item.title === 'string' && typeof item.body === 'string'
          ? { title: item.title, body: item.body }
          : null;
      }).filter((entry): entry is { title: string; body: string } => entry !== null).slice(0, 12)
    : [];
  const gradingRubric = Array.isArray(record.gradingRubric)
    ? record.gradingRubric.map((entry) => {
        if (!entry || typeof entry !== 'object') return null;
        const item = entry as Record<string, unknown>;
        return typeof item.criterion === 'string' && typeof item.points === 'number'
          ? { criterion: item.criterion, points: item.points }
          : null;
      }).filter((entry): entry is { criterion: string; points: number } => entry !== null).slice(0, 12)
    : [];
  return {
    modelAnswer,
    highLevelSteps,
    fullSolution,
    gradingRubric,
    provenance: 'ai_generated',
    reviewStatus: 'pending_review',
    generatedAt: new Date().toISOString(),
    model: getAiTutorProviderConfig().model,
  };
}

function asPaperHelp(value: unknown, mode: TutorPaperHelpRequest['mode'], answerPackage: TutorAnswerPackage): TutorPaperHelpResult | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  const steps = Array.isArray(record.steps)
    ? record.steps.map((entry) => {
        if (!entry || typeof entry !== 'object') return null;
        const item = entry as Record<string, unknown>;
        const title = typeof item.title === 'string' ? item.title.trim() : '';
        const body = typeof item.body === 'string' ? item.body.trim() : null;
        return title ? { title, body } : null;
      }).filter((entry): entry is { title: string; body: string | null } => entry !== null).slice(0, mode === 'next_step' ? 1 : 12)
    : [];
  return { mode, steps, answerPackage };
}

function asPaperGrade(value: unknown, input: TutorPaperGradeRequest): TutorPaperGradeResult | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  const parsedParts = Array.isArray(record.parts)
    ? record.parts.map((entry) => {
        if (!entry || typeof entry !== 'object') return null;
        const item = entry as Record<string, unknown>;
        const id = typeof item.id === 'string' ? item.id : '';
        const source = input.parts.find((part) => part.id === id);
        if (!id || !source) return null;
        const maxPoints = typeof item.maxPoints === 'number' ? Math.max(0, item.maxPoints) : 0;
        const score = source.hasStudentWork && typeof item.score === 'number' ? Math.max(0, Math.min(maxPoints, item.score)) : 0;
        return {
          id,
          score,
          maxPoints,
          feedback: source.hasStudentWork && typeof item.feedback === 'string' ? item.feedback : 'Question not answered.',
          unanswered: !source.hasStudentWork,
        };
      }).filter((entry): entry is TutorPaperGradeResult['parts'][number] => entry !== null)
    : [];
  const parsedById = new Map(parsedParts.map(part => [part.id, part]));
  const fallbackPoints = 100 / input.parts.length;
  const parts = input.parts.map(source => parsedById.get(source.id) ?? {
    id: source.id,
    score: 0,
    maxPoints: fallbackPoints,
    feedback: source.hasStudentWork ? 'This response could not be graded automatically.' : 'Question not answered.',
    unanswered: !source.hasStudentWork,
  });
  const totalPoints = parts.reduce((sum, part) => sum + part.maxPoints, 0);
  const score = parts.reduce((sum, part) => sum + part.score, 0);
  return {
    score,
    totalPoints,
    assisted: input.assisted,
    feedback: typeof record.feedback === 'string' ? record.feedback : '',
    parts,
  };
}

export class OpenAiCompatibleTutorProvider implements AiTutorExternalProvider {
  async completeJson(system: string, user: unknown): Promise<unknown | null> {
    const { apiKey, baseUrl, model } = getAiTutorProviderConfig();
    if (!apiKey) return null;
    const requestPayload = user && typeof user === 'object' ? user as Record<string, unknown> : { input: user };
    const { canvasImageBase64, ...textPayload } = requestPayload;
    const imageUrl = typeof canvasImageBase64 === 'string' ? canvasImageBase64 : null;
    const userContent: string | ChatContentPart[] = imageUrl
      ? [
          { type: 'text', text: JSON.stringify(textPayload) },
          { type: 'image_url', image_url: { url: imageUrl } },
        ]
      : JSON.stringify(textPayload);

    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        temperature: 0.1,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: userContent },
        ],
      }),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`External tutor failed (${response.status}): ${text.slice(0, 300)}`);
    }

    const responsePayload = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
    const content = responsePayload.choices?.[0]?.message?.content;
    if (!content) throw new Error('External tutor returned no content.');
    return extractJsonObject(content);
  }

  async evaluateWork(input: TutorEvaluationInput): Promise<TutorEvaluationResult | null> {
    const system = [
      'You are a strict but helpful math tutor evaluating a student\'s handwritten work.',
      'CRITICAL RULE FOR ARITHMETIC: Before judging any numeric answer, you MUST compute the correct answer yourself step by step. Only claim a numeric result is wrong if you have independently verified the correct answer with certainty.',
      'For example: if the question is "595+236" and the student writes "831", compute 595+236 yourself: 5+6=11 (write 1 carry 1), 9+3+1=13 (write 3 carry 1), 5+2+1=8. Result=831. Student wrote 831. Therefore the student is CORRECT.',
      'Do NOT rely on pattern matching or memory for arithmetic — always compute fresh.',
      'Evaluate only the current step.',
      'If the student\'s answer is completely correct, set isCorrect to true, stepStatus to "correct", detectedMistake to null, and write a positive studentMessage.',
      'Only if there is a genuine error, identify the first mathematical mistake. Do not invent mistakes.',
      'Return strict JSON with keys: isCorrect, stepStatus ("correct"|"partially_correct"|"incorrect"|"unclear"), detectedMistake, studentMessage, hint, annotations, nextExpectedStep.',
      'annotations must be an array of objects with keys: type ("circle"|"underline"|"write_text"), optional targetText, optional text, and color ("red"|"green").',
      'If the answer is correct, annotations should be empty or contain green underlines only.',
    ].join(' ');
    const result = await this.completeJson(system, input);
    return asEvaluation(result);
  }

  async chat(input: TutorChatInput): Promise<TutorChatResult | null> {
    const system = [
      'You are a friendly AI math tutor chatting with a student.',
      'Use the current question, current step, recognized work, and latest evaluation.',
      'Be concise and guide the student without giving away too much unless asked.',
      'Return strict JSON with keys: reply and suggestedActions.',
    ].join(' ');
    const result = await this.completeJson(system, input);
    return asChat(result);
  }

  async generateAnswer(questionPrompt: string): Promise<TutorAnswerPackage | null> {
    const system = [
      'You are an expert teacher creating the canonical answer package for one question.',
      'Solve the problem independently and verify every calculation.',
      'Use the same language as the question.',
      'Return strict JSON with: modelAnswer (concise final answer), highLevelSteps (3-8 short strategy steps), fullSolution (array of {title,body}), and gradingRubric (array of {criterion,points}).',
      'Rubric points must add to exactly 100. Do not include markdown fences.',
    ].join(' ');
    return asAnswerPackage(await this.completeJson(system, { questionPrompt }));
  }

  async paperHelp(input: TutorPaperHelpRequest, answerPackage: TutorAnswerPackage): Promise<TutorPaperHelpResult | null> {
    const modeInstruction = input.mode === 'steps'
      ? 'Return every high-level solving step with an empty body. Do not reveal calculations or the final answer.'
      : input.mode === 'next_step'
        ? 'Return only the single next high-level step after the student work. Its body must be empty and it must not reveal later steps.'
        : 'Return every solving step with its complete worked calculation and final answer in body.';
    const system = [
      'You are placing tutoring guidance directly on a student worksheet.',
      modeInstruction,
      'Use the same language as the question.',
      'Return strict JSON: {"steps":[{"title":"...","body":null or "..."}]}.',
    ].join(' ');
    const result = await this.completeJson(system, { ...input, answerPackage });
    return asPaperHelp(result, input.mode, answerPackage);
  }

  async gradePaper(input: TutorPaperGradeRequest, answerPackage: TutorAnswerPackage): Promise<TutorPaperGradeResult | null> {
    const system = [
      'You are a strict but fair teacher grading every part of a handwritten worksheet.',
      'Use the supplied canonical answer and rubric. Award partial credit for valid reasoning.',
      'Any part with hasStudentWork=false must receive score 0 and feedback exactly "Question not answered.".',
      'AI guidance is not student work and has already been excluded.',
      'Distribute 100 total points across all parts and return strict JSON with feedback and parts [{id,score,maxPoints,feedback}].',
    ].join(' ');
    return asPaperGrade(await this.completeJson(system, { ...input, answerPackage }), input);
  }
}

export function getExternalAiTutorProvider(): AiTutorExternalProvider | null {
  const { apiKey } = getAiTutorProviderConfig();
  if (!apiKey) return null;
  return new OpenAiCompatibleTutorProvider();
}
