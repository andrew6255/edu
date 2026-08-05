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
  const serverGroqKey = (process.env['GROQ_API_KEY'] ?? '')
    .split(',')
    .map(value => value.trim())
    .find(Boolean) ?? '';
  // GROQ_API_KEY may be a comma-separated server-side failover pool. The tutor
  // uses its first key; ingestion owns pool failover.
  const groqKey = serverGroqKey;
  const apiKey = (process.env['AI_TUTOR_API_KEY'] ?? process.env['OPENAI_API_KEY'] ?? groqKey).trim();
  const defaultBaseUrl = groqKey && !process.env['AI_TUTOR_API_KEY'] && !process.env['OPENAI_API_KEY']
    ? 'https://api.groq.com/openai/v1'
    : 'https://api.openai.com/v1';
  const baseUrl = (process.env['AI_TUTOR_BASE_URL'] ?? defaultBaseUrl).replace(/\/+$/, '');
  const defaultModel = defaultBaseUrl.includes('groq.com') ? 'llama-3.3-70b-versatile' : 'gpt-4o-mini';
  const model = (process.env['AI_TUTOR_MODEL'] ?? defaultModel).trim();
  return { apiKey, baseUrl, model };
}

function getTutorTaskModel(envName: string, groqDefault: string): string {
  const config = getAiTutorProviderConfig();
  return (process.env[envName] ?? '').trim() || (config.baseUrl.includes('groq.com') ? groqDefault : config.model);
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

function normalizeMathNotation(value: string): string {
  return value
    .replace(/\$([^$]+)\$/g, (_match, math: string) => `$${math.replace(/\s*\*\s*/g, ' \\times ')}$`)
    .replace(/([\p{L}\p{N})])\s*\*\s*(?=[\p{L}\p{N}(])/gu, '$1 × ');
}

export function parseProviderAnswerPackage(value: unknown): TutorAnswerPackage | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  const textField = (...keys: string[]): string => {
    for (const key of keys) {
      const candidate = record[key];
      if (typeof candidate === 'string' && candidate.trim()) return candidate.trim();
    }
    return '';
  };
  const highLevelSource = record.highLevelSteps ?? record.solutionPlan ?? record.stepsPlan ?? record.plan;
  const highLevelSteps = Array.isArray(highLevelSource)
    ? highLevelSource.map(entry => typeof entry === 'string' ? normalizeMathNotation(entry.trim()) : '').filter(Boolean).slice(0, 5)
    : typeof highLevelSource === 'string'
      ? highLevelSource.split(/\r?\n/).map(entry => normalizeMathNotation(entry.replace(/^[\s•*-]+/, '').trim())).filter(Boolean).slice(0, 5)
      : [];
  const solutionSource = record.fullSolution ?? record.solutionSteps ?? record.workedSolution ?? record.solution;
  const fullSolution = Array.isArray(solutionSource)
    ? solutionSource.map((entry, index) => {
        if (typeof entry === 'string' && entry.trim()) return { title: `Step ${index + 1}`, body: normalizeMathNotation(entry.trim()) };
        if (!entry || typeof entry !== 'object') return null;
        const item = entry as Record<string, unknown>;
        const title = [item.title, item.step, item.name].find(candidate => typeof candidate === 'string' && candidate.trim()) as string | undefined;
        const body = [item.body, item.explanation, item.content, item.work].find(candidate => typeof candidate === 'string' && candidate.trim()) as string | undefined;
        return body ? { title: normalizeMathNotation(title?.trim() || `Step ${index + 1}`), body: normalizeMathNotation(body.trim()) } : null;
      }).filter((entry): entry is { title: string; body: string } => entry !== null).slice(0, 12)
    : typeof solutionSource === 'string' && solutionSource.trim()
      ? [{ title: 'Solution', body: solutionSource.trim() }]
      : [];
  const rubricSource = record.gradingRubric ?? record.gradingSchema ?? record.rubric;
  const gradingRubric = Array.isArray(rubricSource)
    ? rubricSource.map((entry) => {
        if (!entry || typeof entry !== 'object') return null;
        const item = entry as Record<string, unknown>;
        const criterion = [item.criterion, item.criteria, item.description, item.label].find(candidate => typeof candidate === 'string' && candidate.trim()) as string | undefined;
        const numericPoints = typeof item.points === 'number' ? item.points : typeof item.score === 'number' ? item.score : Number(item.points ?? item.score);
        return criterion && Number.isFinite(numericPoints)
          ? { criterion: criterion.trim(), points: numericPoints }
          : null;
      }).filter((entry): entry is { criterion: string; points: number } => entry !== null).slice(0, 12)
    : [];
  const nestedAnswer = record.answer && typeof record.answer === 'object' ? record.answer as Record<string, unknown> : null;
  const nestedModelAnswer = nestedAnswer
    ? [nestedAnswer.modelAnswer, nestedAnswer.finalAnswer, nestedAnswer.answer].find(candidate => typeof candidate === 'string' && candidate.trim()) as string | undefined
    : undefined;
  const modelAnswer = normalizeMathNotation(textField('modelAnswer', 'model_answer', 'finalAnswer', 'final_answer', 'answerText', 'answer')
    || nestedModelAnswer?.trim()
    || fullSolution[fullSolution.length - 1]?.body
    || '');
  if (!modelAnswer) return null;
  return {
    modelAnswer,
    highLevelSteps: highLevelSteps.length ? highLevelSteps : fullSolution.map(step => step.title),
    fullSolution: fullSolution.length ? fullSolution : [{ title: 'Solution', body: modelAnswer }],
    gradingRubric: gradingRubric.length ? gradingRubric : [{ criterion: 'Correct method and final answer', points: 100 }],
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
        const title = typeof item.title === 'string' ? normalizeMathNotation(item.title.trim()) : '';
        const body = typeof item.body === 'string' ? normalizeMathNotation(item.body.trim()) : null;
        return title ? { title, body } : null;
      }).filter((entry): entry is { title: string; body: string | null } => entry !== null).slice(0, mode === 'hint' ? 1 : mode === 'steps' ? 5 : 10)
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
  async completeJson(system: string, user: unknown, maxTokens = 2400, modelOverride?: string): Promise<unknown | null> {
    const { apiKey, baseUrl, model } = getAiTutorProviderConfig();
    if (!apiKey) return null;
    const selectedModel = modelOverride?.trim() || model;
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
        model: selectedModel,
        temperature: 0.1,
        max_tokens: maxTokens,
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
      'For example: if the question is "595+236" and the student writes "831", compute 595+236 yourself: 5+6=11, 9+3+1=13, 5+2+1=8. Result=831. Student wrote 831. Therefore the student is CORRECT.',
      'Do NOT rely on pattern matching or memory for arithmetic — always compute fresh.',
      'Evaluate only the current step.',
      'If the student\'s answer is completely correct, set isCorrect to true, stepStatus to "correct", detectedMistake to null, annotations to [], and write a positive studentMessage.',
      'Only if there is a genuine error: for EACH wrong value the student wrote, create one annotation with type "circle", color "red", targetText set to EXACTLY the wrong string the student wrote (e.g. "-35" or "4"), and text set to a short correction label (e.g. "should be 35" or "should be -4"). Do not bundle multiple errors into one annotation. Do not create a single annotation covering everything. Create one annotation per distinct wrong value.',
      'Return strict JSON with keys: isCorrect, stepStatus ("correct"|"partially_correct"|"incorrect"|"unclear"), detectedMistake (one-sentence summary or null), studentMessage, hint, annotations, nextExpectedStep.',
      'annotations must be an array of objects with keys: type ("circle"|"underline"|"write_text"), targetText (exact substring the student wrote), text (short correction label shown above the circle), color ("red"|"green").',
    ].join(' ');
    const result = await this.completeJson(system, input, 1500, getTutorTaskModel('AI_TUTOR_EVALUATION_MODEL', 'openai/gpt-oss-120b'));
    return asEvaluation(result);
  }

  async chat(input: TutorChatInput): Promise<TutorChatResult | null> {
    const system = [
      'You are a friendly AI math tutor chatting with a student.',
      'Use the current question, current step, recognized work, and latest evaluation.',
      'Answer only questions that are about the supplied exercise or the mathematical topic needed to solve it. Politely refuse unrelated requests and invite the student back to the exercise.',
      'Be concise and guide the student without giving away too much unless asked.',
      'Return strict JSON with keys: reply and suggestedActions.',
    ].join(' ');
    const result = await this.completeJson(system, input, 1200, getTutorTaskModel('AI_TUTOR_CHAT_MODEL', 'llama-3.1-8b-instant'));
    return asChat(result);
  }

  async generateAnswer(questionPrompt: string): Promise<TutorAnswerPackage | null> {
    const system = [
      'You are an expert teacher creating the canonical answer package for one question.',
      'Solve the problem independently and verify every calculation.',
      'Use the same language as the question.',
      'Return strict JSON with: modelAnswer (concise final answer), highLevelSteps (2-5 short practical actions), fullSolution (array of {title,body}), and gradingRubric (array of {criterion,points}).',
      'Each high-level step must tell the student exactly what to do next using the actual expressions and values from this question. Combine routine operations; never split substitute, simplify, repeat, and calculate the result into redundant separate steps.',
      'Do not refer to multiple cases, values, or subquestions unless the supplied question actually contains them.',
      'Write every mathematical expression in Markdown LaTeX delimited by $...$. Use \\times or \\cdot for multiplication and never use the * character as a multiplication sign.',
      'Rubric points must add to exactly 100. Do not include markdown fences.',
    ].join(' ');
    const repairSystem = [
      system,
      'A previous response could not be parsed. You MUST include a non-empty string field named modelAnswer.',
      'Use exactly these top-level keys: modelAnswer, highLevelSteps, fullSolution, gradingRubric.',
      'fullSolution must be an array of {title,body}; gradingRubric must be an array of {criterion,points}.',
    ].join(' ');
    const generateWithModel = async (modelOverride?: string): Promise<TutorAnswerPackage | null> => {
      const firstAttempt = parseProviderAnswerPackage(await this.completeJson(system, { questionPrompt }, 3000, modelOverride));
      if (firstAttempt) return modelOverride ? { ...firstAttempt, model: modelOverride } : firstAttempt;
      const repaired = parseProviderAnswerPackage(await this.completeJson(repairSystem, { questionPrompt }, 3000, modelOverride));
      return repaired && modelOverride ? { ...repaired, model: modelOverride } : repaired;
    };
    try {
      return await generateWithModel();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!message.includes('(429)')) throw error;
      const fallbackModel = getTutorTaskModel('AI_TUTOR_ANSWER_FALLBACK_MODEL', 'openai/gpt-oss-120b');
      return generateWithModel(fallbackModel);
    }
  }

  async paperHelp(input: TutorPaperHelpRequest, answerPackage: TutorAnswerPackage): Promise<TutorPaperHelpResult | null> {
    const modeInstruction = input.mode === 'steps'
      ? 'Return one complete, ordered plan of practical steps, normally 2 to 4 and never more than 5, with an empty body. Each action must be specific enough to execute immediately. For an exercise that gives values for variables and asks to evaluate one or more expressions, combine all requested expressions in the same plan: first substitute the stated values everywhere (or simplify symbolically first only when that materially helps), then evaluate while respecting the order of operations. The substitution title must repeat the actual supplied values, such as $x=-1$, instead of saying only "the values". Never create separate generic steps such as "calculate A" and "calculate B". Do not reveal calculations or the final answer.'
      : input.mode === 'hint'
        ? 'Return exactly one concise, actionable hint for the next thing the student should write, based on recognizedWork. Do not state the final answer and do not merely repeat the question. Put the hint in title and leave body empty.'
        : 'Return every solving step with its complete worked calculation and final answer in body.';
    const system = [
      'You are placing tutoring guidance directly on a student worksheet.',
      modeInstruction,
      'Use the same language as the question.',
      'The subQuestionPrompt is the exact active problem. Focus only on it and ignore sibling cases or unrelated steps that may appear in the canonical answer package.',
      'Prefer meaningful mathematical actions such as simplify first, substitute the supplied values, then evaluate in the correct order. Merge redundant micro-steps and never say to repeat a process unless repetition is explicitly required by the active problem.',
      'Write every mathematical expression in Markdown LaTeX delimited by $...$. Use \\times or \\cdot for multiplication and never use the * character as a multiplication sign.',
      'Return strict JSON: {"steps":[{"title":"...","body":null or "..."}]}.',
    ].join(' ');
    const result = await this.completeJson(system, { ...input, answerPackage }, 2400, getTutorTaskModel('AI_TUTOR_HELP_MODEL', 'openai/gpt-oss-120b'));
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
    return asPaperGrade(await this.completeJson(system, { ...input, answerPackage }, 2400, getTutorTaskModel('AI_TUTOR_GRADING_MODEL', 'openai/gpt-oss-120b')), input);
  }
}

export function getExternalAiTutorProvider(): AiTutorExternalProvider | null {
  const { apiKey } = getAiTutorProviderConfig();
  if (!apiKey) return null;
  return new OpenAiCompatibleTutorProvider();
}
