export type Difficulty = 'easy' | 'medium' | 'hard' | 'boss';

export interface Question {
  text: string;
  options: string[];
  correctIndex: number;
  timeLimit: number;
  damage: number;
}

function rand(min: number, max: number) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function shuffleWithCorrect(correct: number, distractors: number[]): [string[], number] {
  const all = [correct, ...distractors.slice(0, 3)];
  const shuffled = all.sort(() => Math.random() - 0.5);
  return [shuffled.map(String), shuffled.indexOf(correct)];
}

function makeDistractors(answer: number, count = 3): number[] {
  const set = new Set<number>();
  while (set.size < count) {
    const offset = rand(-5, 5);
    if (offset !== 0) set.add(answer + offset);
  }
  return Array.from(set);
}

function easyQuestion(): Question {
  const ops = ['+', '-', '×'];
  const op = ops[rand(0, 2)];
  let a = rand(1, 12), b = rand(1, 12), answer: number;

  if (op === '+') { answer = a + b; }
  else if (op === '-') { if (a < b) [a, b] = [b, a]; answer = a - b; }
  else { a = rand(1, 9); b = rand(1, 9); answer = a * b; }

  const [options, correctIndex] = shuffleWithCorrect(answer, makeDistractors(answer));
  return { text: `${a} ${op} ${b} = ?`, options, correctIndex, timeLimit: 12, damage: 15 };
}

function mediumQuestion(): Question {
  const type = rand(0, 3);

  if (type === 0) {
    const a = rand(10, 99), b = rand(10, 99);
    const answer = a + b;
    const [options, correctIndex] = shuffleWithCorrect(answer, makeDistractors(answer, 3));
    return { text: `${a} + ${b} = ?`, options, correctIndex, timeLimit: 10, damage: 20 };
  }
  if (type === 1) {
    const a = rand(2, 12), b = rand(2, 12);
    const answer = a * b;
    const [options, correctIndex] = shuffleWithCorrect(answer, makeDistractors(answer, 3));
    return { text: `${a} × ${b} = ?`, options, correctIndex, timeLimit: 10, damage: 20 };
  }
  if (type === 2) {
    const a = rand(10, 99), b = rand(1, a);
    const answer = a - b;
    const [options, correctIndex] = shuffleWithCorrect(answer, makeDistractors(answer, 3));
    return { text: `${a} − ${b} = ?`, options, correctIndex, timeLimit: 10, damage: 20 };
  }
  const b = rand(2, 9), answer2 = rand(1, 12);
  const a2 = b * answer2;
  const [options, correctIndex] = shuffleWithCorrect(answer2, makeDistractors(answer2, 3));
  return { text: `${a2} ÷ ${b} = ?`, options, correctIndex, timeLimit: 10, damage: 20 };
}

function hardQuestion(): Question {
  const type = rand(0, 3);

  if (type === 0) {
    const x = rand(1, 20), b = rand(1, 30);
    const result = x + b;
    const [options, correctIndex] = shuffleWithCorrect(x, makeDistractors(x, 3));
    return { text: `x + ${b} = ${result}\nSolve for x`, options, correctIndex, timeLimit: 8, damage: 28 };
  }
  if (type === 1) {
    const x = rand(2, 12), m = rand(2, 9);
    const result = m * x;
    const [options, correctIndex] = shuffleWithCorrect(x, makeDistractors(x, 3));
    return { text: `${m}x = ${result}\nSolve for x`, options, correctIndex, timeLimit: 8, damage: 28 };
  }
  if (type === 2) {
    const a = rand(2, 9), b = rand(1, 9), c = rand(1, 15);
    const x = rand(1, 10);
    const result = a * x + b;
    const [options, correctIndex] = shuffleWithCorrect(x, makeDistractors(x, 3));
    return { text: `${a}x + ${b} = ${result}\nFind x`, options, correctIndex, timeLimit: 8, damage: 28 };
  }
  const base = rand(2, 12), exp = rand(2, 3);
  const answer = Math.pow(base, exp);
  const distractors = [answer + rand(1, 5), answer - rand(1, 5), answer + rand(6, 15)];
  const [options, correctIndex] = shuffleWithCorrect(answer, distractors);
  return { text: `${base}${exp === 2 ? '²' : '³'} = ?`, options, correctIndex, timeLimit: 8, damage: 28 };
}

function bossQuestion(): Question {
  const type = rand(0, 3);

  if (type === 0) {
    const a = rand(2, 9), b = rand(2, 9), c = rand(2, 9);
    const answer = a * b + c;
    const [options, correctIndex] = shuffleWithCorrect(answer, makeDistractors(answer, 3));
    return { text: `${a} × ${b} + ${c} = ?`, options, correctIndex, timeLimit: 6, damage: 35 };
  }
  if (type === 1) {
    const x = rand(1, 10), a = rand(2, 9), b = rand(2, 9);
    const result = a * x - b;
    const [options, correctIndex] = shuffleWithCorrect(x, makeDistractors(x, 3));
    return { text: `${a}x − ${b} = ${result}\nSolve x`, options, correctIndex, timeLimit: 6, damage: 35 };
  }
  if (type === 2) {
    const sequences = [
      { seq: [2, 4, 8, 16, '?'], answer: 32, diff: [28, 30, 34, 36] },
      { seq: [1, 3, 6, 10, '?'], answer: 15, diff: [12, 13, 14, 16] },
      { seq: [100, 90, 81, 73, '?'], answer: 66, diff: [64, 65, 67, 68] },
      { seq: [3, 9, 27, 81, '?'], answer: 243, diff: [162, 216, 270, 324] },
    ];
    const s = sequences[rand(0, sequences.length - 1)];
    const [options, correctIndex] = shuffleWithCorrect(s.answer, s.diff);
    return { text: `${s.seq.join(', ')}`, options, correctIndex, timeLimit: 6, damage: 35 };
  }
  const n = rand(5, 15);
  const sumVal = (n * (n + 1)) / 2;
  const [options, correctIndex] = shuffleWithCorrect(sumVal, [sumVal - 3, sumVal + 3, sumVal - 7].map(Math.abs));
  return { text: `Sum of 1 to ${n} = ?`, options, correctIndex, timeLimit: 6, damage: 35 };
}

export function generateQuestion(difficulty: Difficulty): Question {
  switch (difficulty) {
    case 'easy': return easyQuestion();
    case 'medium': return mediumQuestion();
    case 'hard': return hardQuestion();
    case 'boss': return bossQuestion();
  }
}

export function generateBattle(difficulty: Difficulty, count = 10): Question[] {
  return Array.from({ length: count }, () => generateQuestion(difficulty));
}
