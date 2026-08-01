import { describe, expect, it } from "vitest";
import { expandInstructionalSubquestions, restoreSharedSetupContext } from "./subquestionExpansion";

describe("expandInstructionalSubquestions", () => {
  it("turns labeled exercise tasks into standalone free-response questions", () => {
    const result = expandInstructionalSubquestions([{
      questionNumber: 1,
      promptRawText: "Exercice 1: Expand and simplify the following questions:",
      choices: ["A) 2(x+3)", "B) 3(s+34)", "C) x(x+1)"],
    }]);

    expect(result.map(question => question.promptRawText)).toEqual([
      "Expand and simplify: 2(x+3)",
      "Expand and simplify: 3(s+34)",
      "Expand and simplify: x(x+1)",
    ]);
    expect(result.every(question => question.interactionType === "free_response" && question.choices.length === 0)).toBe(true);
  });

  it("does not split an actual multiple-choice prompt", () => {
    const question = {
      promptRawText: "Which of the following expressions is the correct expansion?",
      choices: ["2x+6", "2x+3", "x+6"],
    };
    expect(expandInstructionalSubquestions([question])).toEqual([question]);
  });

  it("keeps dependent parts that share a procedure and variable as one question", () => {
    const question = {
      promptRawText: "Voici un programme de calcul. Effectuer les tâches suivantes puis on appelle x le nombre choisi et montrer que le résultat vaut 12x + 15.",
      choices: ["Appliquer le programme à 4 et -3", "Montrer que le résultat vaut 12x + 15", "Déterminer x pour obtenir 51"],
    };
    expect(expandInstructionalSubquestions([question])).toEqual([question]);
  });

  it("splits independent French expression tasks", () => {
    const result = expandInstructionalSubquestions([{
      promptRawText: "Exercice 2 : Développer et simplifier les expressions suivantes :",
      choices: ["A) 2(x+3)", "B) x(x+1)"],
    }]);
    expect(result.map(question => question.promptRawText)).toEqual([
      "Développer et simplifier: 2(x+3)",
      "Développer et simplifier: x(x+1)",
    ]);
  });
});

describe("restoreSharedSetupContext", () => {
  it("copies shared algebra definitions into every split calculation", () => {
    const setup = "On pose A = (7x - 3y + 4z) - (-3x + 4y - 5z) et B = (x + y - z)(z - y - x).";
    const result = restoreSharedSetupContext([
      { pageNumber: 1, promptRawText: `${setup}\nCalculer A et B pour x = -1, y = 1 et z = -2.` },
      { pageNumber: 1, promptRawText: "Calculer A et B pour x = 2, y = -1 et z = 1." },
    ]);

    expect(result.map(question => question.promptRawText)).toEqual([
      `${setup}\nCalculer A et B pour x = -1, y = 1 et z = -2.`,
      `${setup}\nCalculer A et B pour x = 2, y = -1 et z = 1.`,
    ]);
  });

  it("does not leak setup context into an unrelated following question", () => {
    const result = restoreSharedSetupContext([
      { pageNumber: 1, promptRawText: "On pose A = 2x + 1. Calculer A pour x = 2." },
      { pageNumber: 1, promptRawText: "Calculer le p\u00e9rim\u00e8tre du triangle." },
      { pageNumber: 1, promptRawText: "Calculer A pour x = 4." },
    ]);

    expect(result[1].promptRawText).toBe("Calculer le p\u00e9rim\u00e8tre du triangle.");
    expect(result[2].promptRawText).toBe("Calculer A pour x = 4.");
  });
});
