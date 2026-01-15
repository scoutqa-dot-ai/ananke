import { describe, it, expect } from 'vitest';
import { assertText } from './text.js';

describe('assertText', () => {
  it('passes when must_match pattern matches', () => {
    const results = assertText('Hello, how can I help you?', {
      must_match: 'help',
    });
    expect(results).toHaveLength(0);
  });

  it('fails when must_match pattern does not match', () => {
    const results = assertText('Hello, goodbye!', {
      must_match: 'help',
    });
    expect(results).toHaveLength(1);
    expect(results[0].passed).toBe(false);
  });

  it('passes when must_not_match pattern does not match', () => {
    const results = assertText('Everything is fine', {
      must_not_match: 'error',
    });
    expect(results).toHaveLength(0);
  });

  it('fails when must_not_match pattern matches', () => {
    const results = assertText('An error occurred', {
      must_not_match: 'error',
    });
    expect(results).toHaveLength(1);
    expect(results[0].passed).toBe(false);
  });

  it('supports regex patterns', () => {
    const results = assertText('The answer is 42', {
      must_match: '\\d+',
    });
    expect(results).toHaveLength(0);
  });

  it('truncates long text in output', () => {
    const longText = 'x'.repeat(200);
    const results = assertText(longText, {
      must_match: 'not found',
    });
    expect(results).toHaveLength(1);
    expect(results[0].actual?.length).toBeLessThan(150);
    expect(results[0].actual).toContain('...');
  });
});
