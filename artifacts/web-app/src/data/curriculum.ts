export interface Objective {
  id: string;
  title: string;
  desc: string;
  xp: number;
  tags?: string[];
}

export interface Chapter {
  id: string;
  name: string;
  icon: string;
  color: string;
  boss?: boolean;
  objectives: Objective[];
}

export interface Curriculum {
  id: string;
  label: string;
  shortLabel: string;
  subject: string;
  icon: string;
  available: boolean;
  chapters: Chapter[];
}

const CAMBRIDGE_MATH_Y9: Curriculum = {
  id: 'cambridge_y9',
  label: 'Cambridge IGCSE Mathematics — Year 9',
  shortLabel: 'Cambridge IGCSE Y9',
  subject: 'math',
  icon: '📐',
  available: true,
  chapters: [
    {
      id: 'number',
      name: 'Number',
      icon: '🔢',
      color: '#0ea5e9',
      objectives: [
        { id: 'n1', title: 'Types of Numbers', desc: 'Classify integers, primes, factors and multiples. Find HCF and LCM using prime factorisation.', xp: 50 },
        { id: 'n2', title: 'Ordering & Comparing', desc: 'Order integers, decimals and fractions on a number line. Use inequality symbols correctly.', xp: 50 },
        { id: 'n3', title: 'Indices & Powers', desc: 'Apply the laws of indices. Evaluate negative and fractional powers.', xp: 60 },
        { id: 'n4', title: 'Standard Form', desc: 'Write and calculate with numbers in standard form (scientific notation).', xp: 60 },
        { id: 'n5', title: 'Fractions & Decimals', desc: 'Convert between fractions, decimals and percentages. Perform the four operations on fractions.', xp: 50 },
        { id: 'n6', title: 'Rounding & Estimation', desc: 'Round to decimal places and significant figures. Estimate results of calculations.', xp: 40 },
        { id: 'n7', title: 'Percentage Calculations', desc: 'Calculate percentage increase/decrease, reverse percentages, and compound interest.', xp: 60 },
        { id: 'n8', title: 'Ratio & Proportion', desc: 'Simplify ratios and divide quantities in given ratios. Solve proportion problems.', xp: 60 },
      ]
    },
    {
      id: 'algebra',
      name: 'Algebra',
      icon: '✖',
      color: '#8b5cf6',
      objectives: [
        { id: 'a1', title: 'Simplifying Expressions', desc: 'Collect like terms, simplify expressions with indices. Understand the rules of algebra.', xp: 50 },
        { id: 'a2', title: 'Expanding Brackets', desc: 'Expand single and double brackets. Expand and simplify compound expressions.', xp: 60 },
        { id: 'a3', title: 'Factorising', desc: 'Factorise expressions by taking out the HCF. Factorise quadratic expressions.', xp: 70 },
        { id: 'a4', title: 'Substitution', desc: 'Substitute values into algebraic expressions and formulae. Evaluate expressions.', xp: 50 },
        { id: 'a5', title: 'Linear Equations', desc: 'Solve linear equations including those with unknowns on both sides and with brackets.', xp: 60 },
        { id: 'a6', title: 'Forming Equations', desc: 'Translate word problems into equations and solve them. Check solutions in context.', xp: 70 },
        { id: 'a7', title: 'Inequalities', desc: 'Solve and represent linear inequalities on a number line. Understand inequality notation.', xp: 60 },
        { id: 'a8', title: 'Sequences & nth Term', desc: 'Find the nth term of arithmetic sequences. Recognise geometric sequences.', xp: 60 },
        { id: 'a9', title: 'Straight Line Graphs', desc: 'Plot and interpret y = mx + c. Find gradient and y-intercept from an equation or graph.', xp: 70 },
        { id: 'a10', title: 'Simultaneous Equations', desc: 'Solve pairs of simultaneous linear equations by elimination and substitution.', xp: 80 },
      ]
    },
    {
      id: 'geometry',
      name: 'Geometry & Measure',
      icon: '📐',
      color: '#10b981',
      objectives: [
        { id: 'g1', title: 'Angles & Parallel Lines', desc: 'Identify alternate, co-interior and corresponding angles. Solve angle problems with reasons.', xp: 50 },
        { id: 'g2', title: 'Triangles & Congruence', desc: 'Apply properties of triangles. Use congruence conditions (SSS, SAS, ASA, RHS).', xp: 60 },
        { id: 'g3', title: 'Quadrilaterals & Polygons', desc: 'Apply properties of quadrilaterals and regular polygons. Calculate interior and exterior angles.', xp: 60 },
        { id: 'g4', title: 'Circles', desc: 'Know parts of a circle. Apply circle theorems involving angles in semicircles and at the centre.', xp: 70 },
        { id: 'g5', title: 'Area & Perimeter', desc: 'Calculate area and perimeter of 2D shapes including composite shapes and sectors.', xp: 60 },
        { id: 'g6', title: 'Volume & Surface Area', desc: 'Calculate volume and surface area of prisms, cylinders, and compound 3D shapes.', xp: 70 },
        { id: 'g7', title: 'Transformations', desc: 'Perform and describe rotations, reflections, translations and enlargements on a grid.', xp: 70 },
        { id: 'g8', title: 'Pythagoras & Trigonometry', desc: 'Apply Pythagoras theorem and basic trigonometric ratios (sin, cos, tan) in right triangles.', xp: 80 },
      ]
    },
    {
      id: 'statistics',
      name: 'Statistics & Probability',
      icon: '📊',
      color: '#f97316',
      objectives: [
        { id: 's1', title: 'Averages & Spread', desc: 'Calculate mean, median, mode and range. Choose the most appropriate average for a dataset.', xp: 50 },
        { id: 's2', title: 'Charts & Diagrams', desc: 'Construct and interpret bar charts, histograms, pie charts and frequency polygons.', xp: 50 },
        { id: 's3', title: 'Scatter Diagrams', desc: 'Plot scatter diagrams, draw lines of best fit, describe correlation and make predictions.', xp: 60 },
        { id: 's4', title: 'Grouped Data', desc: 'Find mean from grouped frequency tables. Identify modal class and median class.', xp: 60 },
        { id: 's5', title: 'Probability Basics', desc: 'Assign probabilities using relative frequency and equally likely outcomes. Use sample spaces.', xp: 50 },
        { id: 's6', title: 'Combined Probability', desc: 'Use tree diagrams and Venn diagrams for combined events. Apply the addition and multiplication rules.', xp: 70 },
      ]
    },
    {
      id: 'boss_algebra',
      name: '⚔️ BOSS: Algebra Master',
      icon: '👹',
      color: '#ef4444',
      boss: true,
      objectives: [
        { id: 'b1', title: 'Advanced Equation Solving', desc: 'Solve complex multi-step equations. Rearrange formulae to change the subject.', xp: 100 },
        { id: 'b2', title: 'Quadratic Graphs', desc: 'Plot and interpret y = ax² + bx + c. Find roots graphically.', xp: 120 },
        { id: 'b3', title: 'Graphical Simultaneous Equations', desc: 'Solve simultaneous equations by finding the intersection of two graphs.', xp: 100 },
        { id: 'b4', title: 'Algebraic Fractions', desc: 'Simplify, add, subtract and multiply algebraic fractions.', xp: 120 },
        { id: 'b5', title: 'Problem Solving Mastery', desc: 'Apply algebra to complex real-world and geometric problems.', xp: 150 },
      ]
    }
  ]
};

const CAMBRIDGE_PHYSICS_Y9: Curriculum = {
  id: 'cambridge_physics_y9',
  label: 'Cambridge IGCSE Physics — Year 9',
  shortLabel: 'Cambridge Physics Y9',
  subject: 'physics',
  icon: '⚛',
  available: false,
  chapters: [
    {
      id: 'motion', name: 'Motion & Forces', icon: '🚀', color: '#7e22ce',
      objectives: [
        { id: 'p1', title: 'Speed & Velocity', desc: 'Calculate speed and velocity. Interpret distance-time graphs.', xp: 50 },
        { id: 'p2', title: 'Acceleration', desc: 'Calculate acceleration from velocity-time graphs. Apply SUVAT equations.', xp: 60 },
        { id: 'p3', title: "Newton's Laws", desc: "Apply Newton's three laws of motion. Understand F=ma.", xp: 70 },
        { id: 'p4', title: 'Resultant Forces', desc: 'Find resultant of multiple forces. Understand equilibrium.', xp: 60 },
      ]
    }
  ]
};

const CAMBRIDGE_CHEM_Y9: Curriculum = {
  id: 'cambridge_chem_y9',
  label: 'Cambridge IGCSE Chemistry — Year 9',
  shortLabel: 'Cambridge Chemistry Y9',
  subject: 'chemistry',
  icon: '⚗',
  available: false,
  chapters: []
};

const CAMBRIDGE_BIO_Y9: Curriculum = {
  id: 'cambridge_bio_y9',
  label: 'Cambridge IGCSE Biology — Year 9',
  shortLabel: 'Cambridge Biology Y9',
  subject: 'biology',
  icon: '🧬',
  available: false,
  chapters: []
};

export const ALL_CURRICULA: Curriculum[] = [
  CAMBRIDGE_MATH_Y9,
  CAMBRIDGE_PHYSICS_Y9,
  CAMBRIDGE_CHEM_Y9,
  CAMBRIDGE_BIO_Y9,
];

export function getCurriculaForSubject(subject: string): Curriculum[] {
  return ALL_CURRICULA.filter(c => c.subject === subject);
}

export function getCurriculumById(id: string): Curriculum | undefined {
  return ALL_CURRICULA.find(c => c.id === id);
}

export function getTotalObjectives(curriculum: Curriculum): number {
  return curriculum.chapters.reduce((sum, ch) => sum + ch.objectives.length, 0);
}

export function getTotalXP(curriculum: Curriculum): number {
  return curriculum.chapters.reduce((sum, ch) =>
    sum + ch.objectives.reduce((s, o) => s + o.xp, 0), 0);
}
