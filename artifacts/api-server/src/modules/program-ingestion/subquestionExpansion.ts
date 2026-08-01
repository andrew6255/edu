const instructionalTaskPattern = /\b(expand|simplify|factor(?:ize)?|solve|calculate|evaluate|differentiate|integrate|prove|find|complete|rewrite|express|développer|simplifier|factoriser|résoudre|calculer|évaluer|déterminer|démontrer|trouver)\b/i;
const sharedListPattern = /\b(?:(?:the\s+)?following\s+(?:questions?|expressions?|problems?|exercises?|items?|tasks?)|(?:les\s+)?(?:questions?|expressions?|problèmes?|exercices?|éléments?|tâches?)\s+suivant(?:e|es|s)?)\b/i;
const multipleChoiceLanguagePattern = /\b(which|choose|select|correct|option|answer|lequel|choisir|sélectionner|correcte?|réponse)\b/i;
const dependencyLanguagePattern = /\b(program(?:me)?|algorithm|proc(?:edure|édure)|result(?:s|at|ats|ado)?|résultat|previous|preceding|précédent|then|alors|on\s+appelle|let\s+[a-z]|defined?|défini|same\s+(?:diagram|table|figure)|montrer\s+que|show\s+that)\b/i;

const sharedSetupStartPattern = /^(?:on\s+pose|soit|soient|on\s+consid(?:e|\u00e8|\u00e9)re|consid(?:e|\u00e9)rons|let|define|given|consider)\b/i;
const taskBoundaryPattern = /\s+(?=(?:\d+\s*[).:\-]\s*)?(?:calculate|evaluate|find|solve|compare|determine|prove|show|calculer|\u00e9valuer|trouver|r\u00e9soudre|comparer|d\u00e9terminer|d\u00e9montrer|montrer)\b)/i;

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function sharedSetup(promptText: string): { text: string; symbols: string[] } | null {
  if (!sharedSetupStartPattern.test(promptText)) return null;
  const taskStart = promptText.search(taskBoundaryPattern);
  if (taskStart <= 0) return null;
  const text = promptText.slice(0, taskStart).trim();
  const symbols = [...text.matchAll(/\b([A-Za-z][A-Za-z0-9_]*)\s*=/g)].map(match => match[1]);
  return symbols.length > 0 ? { text, symbols: [...new Set(symbols)] } : null;
}

/**
 * Vision extraction can split parallel calculations correctly but forget to
 * repeat the definitions that make later parts understandable. Restore that
 * shared setup on adjacent questions from the same page. This makes every
 * emitted question standalone without forcing valid parallel tasks to merge.
 */
export function restoreSharedSetupContext(questions: any[]): any[] {
  let active: { pageNumber: unknown; text: string; symbols: string[] } | null = null;

  return questions.map((question: any) => {
    const promptText = typeof question.promptRawText === "string" ? question.promptRawText.trim() : "";
    const setup = sharedSetup(promptText);
    if (setup) {
      active = { pageNumber: question.pageNumber, ...setup };
      return question;
    }

    if (!active || active.pageNumber !== question.pageNumber || !instructionalTaskPattern.test(promptText)) {
      active = null;
      return question;
    }

    const referencedSymbols = active.symbols.filter(symbol => new RegExp(`\\b${escapeRegExp(symbol)}\\b`).test(promptText));
    const missingDefinitions = referencedSymbols.filter(symbol => !new RegExp(`\\b${escapeRegExp(symbol)}\\s*=`).test(promptText));
    if (referencedSymbols.length === 0 || missingDefinitions.length !== referencedSymbols.length) {
      active = null;
      return question;
    }

    return { ...question, promptRawText: `${active.text}\n${promptText}` };
  });
}

export function expandInstructionalSubquestions(questions: any[]): any[] {
  return questions.flatMap((question: any) => {
    const promptText = typeof question.promptRawText === "string" ? question.promptRawText.trim() : "";
    const possibleSubparts = Array.isArray(question.choices) ? question.choices : [];
    const textualSubparts = possibleSubparts.filter((choice: unknown) => typeof choice === "string" && !/IMG_\d+|^data:image/i.test(choice.trim()));
    const shouldSplit = textualSubparts.length >= 2
      && textualSubparts.length === possibleSubparts.length
      && instructionalTaskPattern.test(promptText)
      && sharedListPattern.test(promptText)
      && !multipleChoiceLanguagePattern.test(promptText)
      && !dependencyLanguagePattern.test(promptText);
    if (!shouldSplit) return [question];

    const instruction = promptText
      .replace(/^\s*(?:exercise|exercice)\s*\d*\s*[:.\-]?\s*/i, "")
      .replace(sharedListPattern, "")
      .replace(/\s*[:;,.]\s*$/, "")
      .replace(/\s{2,}/g, " ")
      .trim();

    return textualSubparts.map((subpart: string, subpartIndex: number) => ({
      ...question,
      questionNumber: `${question.questionNumber ?? ""}${String.fromCharCode(65 + subpartIndex)}`,
      promptRawText: `${instruction}: ${subpart.replace(/^\s*[\(\[]?[A-Za-z0-9]+[\)\].:\-]\s*/, "").trim()}`,
      interactionType: "free_response",
      choices: [],
      choiceHasImage: [],
    }));
  });
}
