import type { ToolRuntime } from './types.js';

type Operator = '+' | '-' | '*' | '/';

interface ParsedExpression {
  a: number;
  b: number;
  operator: Operator;
}

function optionalNumberArg(args: Record<string, unknown>, key: string): number | undefined {
  const value = args[key];
  if (value === undefined || value === null) return undefined;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`${key} must be a finite number`);
  }
  return parsed;
}

function optionalStringArg(args: Record<string, unknown>, key: string): string | undefined {
  const value = args[key];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${key} must be a non-empty string when provided`);
  }
  return value.trim();
}

function parseOperator(value: string | undefined): Operator {
  if (value === '+' || value === '-' || value === '*' || value === '/') return value;
  return '+';
}

function expressionArg(args: Record<string, unknown>): ParsedExpression {
  const expression = optionalStringArg(args, 'expression');
  if (!expression) {
    const a = optionalNumberArg(args, 'a');
    const b = optionalNumberArg(args, 'b');
    if (a === undefined || b === undefined) throw new Error('expression or both a and b are required');
    return { a, b, operator: parseOperator(optionalStringArg(args, 'operator')) };
  }

  const match = expression.match(/^\s*(-?\d+(?:\.\d+)?)\s*([+*/-])\s*(-?\d+(?:\.\d+)?)\s*$/);
  if (!match) {
    throw new Error('expression must be a simple binary expression, for example 44 + 888');
  }
  return { a: Number(match[1]), operator: match[2] as Operator, b: Number(match[3]) };
}

function calculate({ a, b, operator }: ParsedExpression): number {
  if (operator === '+') return a + b;
  if (operator === '-') return a - b;
  if (operator === '*') return a * b;
  if (b === 0) throw new Error('division by zero is not allowed');
  return a / b;
}

function formatNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(10)));
}

export function createCalcTool(): ToolRuntime {
  return {
    definition: {
      type: 'function',
      function: {
        name: 'calc',
        description: 'Evaluate a simple arithmetic expression. Always use this tool for messages that start with calc or ask for arithmetic instead of calculating mentally.',
        parameters: {
          type: 'object',
          required: [],
          properties: {
            expression: { type: 'string', description: 'Simple binary expression, for example 44 + 888, 99 * 77, or 10 / 2.' },
            a: { type: 'number', description: 'First number, when expression is not provided.' },
            b: { type: 'number', description: 'Second number, when expression is not provided.' },
            operator: { type: 'string', enum: ['+', '-', '*', '/'], description: 'Operator when expression is not provided. Defaults to +.' },
          },
        },
      },
    },
    resultMode: 'direct',
    async run(args) {
      const parsed = expressionArg(args);
      const result = calculate(parsed);
      return `${formatNumber(parsed.a)} ${parsed.operator} ${formatNumber(parsed.b)} = ${formatNumber(result)}`;
    },
  };
}
