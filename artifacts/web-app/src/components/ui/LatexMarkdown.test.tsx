import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import * as React from 'react';
import LatexMarkdown from './LatexMarkdown';

describe('LatexMarkdown — KaTeX Error Boundary & Math Rendering Tests', () => {
  it('renders normal markdown text without errors', () => {
    render(<LatexMarkdown content="Hello world, this is a test question." />);
    expect(screen.getByText('Hello world, this is a test question.')).toBeInTheDocument();
  });

  it('renders inline and block mathematical formulas without throwing exceptions', () => {
    const mathContent = 'Given the formula $y = mx + b$, calculate the slope when $x = 2$.';
    render(<LatexMarkdown content={mathContent} />);
    expect(screen.getByText(/Given the formula/i)).toBeInTheDocument();
  });

  it('handles malformed or incomplete LaTeX syntax gracefully without crashing React tree', () => {
    // Malformed syntax: unclosed brace in fraction and undefined command
    const brokenLatex = 'Calculate $\\frac{1}{2$ and $\\unknowncmd{123}$ for this problem.';
    expect(() => {
      render(<LatexMarkdown content={brokenLatex} />);
    }).not.toThrow();

    // Verify container rendered
    expect(screen.getByText(/Calculate/i)).toBeInTheDocument();
  });
});
