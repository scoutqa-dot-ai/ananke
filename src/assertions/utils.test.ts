import { describe, it, expect } from 'vitest';
import { stringify, parsePattern, matchesPattern } from './utils.js';

describe('stringify', () => {
  it('returns string as-is', () => {
    expect(stringify('hello')).toBe('hello');
  });

  it('returns "null" for null', () => {
    expect(stringify(null)).toBe('null');
  });

  it('returns "undefined" for undefined', () => {
    expect(stringify(undefined)).toBe('undefined');
  });

  it('JSON stringifies objects', () => {
    expect(stringify({ a: 1 })).toBe('{"a":1}');
  });

  it('JSON stringifies arrays', () => {
    expect(stringify([1, 2, 3])).toBe('[1,2,3]');
  });

  it('JSON stringifies numbers', () => {
    expect(stringify(42)).toBe('42');
  });

  it('JSON stringifies booleans', () => {
    expect(stringify(true)).toBe('true');
    expect(stringify(false)).toBe('false');
  });
});

describe('matchesPattern', () => {
  it('matches string values', () => {
    expect(matchesPattern('hello world', 'hello')).toBe(true);
    expect(matchesPattern('hello world', 'goodbye')).toBe(false);
  });

  it('matches stringified objects', () => {
    expect(matchesPattern({ name: 'John' }, 'John')).toBe(true);
    expect(matchesPattern({ name: 'John' }, 'Jane')).toBe(false);
  });

  it('matches stringified arrays', () => {
    expect(matchesPattern(['a', 'b', 'c'], '"b"')).toBe(true);
  });

  it('matches numbers', () => {
    expect(matchesPattern(42, '42')).toBe(true);
    expect(matchesPattern(42, '\\d+')).toBe(true);
  });

  it('matches null and undefined', () => {
    expect(matchesPattern(null, 'null')).toBe(true);
    expect(matchesPattern(undefined, 'undefined')).toBe(true);
  });

  it('supports regex patterns', () => {
    expect(matchesPattern('test@example.com', '\\w+@\\w+\\.com')).toBe(true);
    expect(matchesPattern('hello123', '^hello\\d+$')).toBe(true);
  });

  it('supports /pattern/flags syntax for case insensitive', () => {
    expect(matchesPattern('Hello World', '/hello/i')).toBe(true);
    expect(matchesPattern('Hello World', 'hello')).toBe(false);
  });

  it('supports /pattern/flags syntax with multiple flags', () => {
    expect(matchesPattern('Hello\nWorld', '/hello.*world/is')).toBe(true);
  });

  it('treats pattern without slashes as plain regex', () => {
    expect(matchesPattern('hello', 'hello')).toBe(true);
    expect(matchesPattern('/path/to/file', '/path/')).toBe(true);
  });
});

describe('parsePattern', () => {
  it('parses plain pattern without flags', () => {
    const regex = parsePattern('hello');
    expect(regex.source).toBe('hello');
    expect(regex.flags).toBe('');
  });

  it('parses /pattern/i for case insensitive', () => {
    const regex = parsePattern('/hello/i');
    expect(regex.source).toBe('hello');
    expect(regex.flags).toBe('i');
  });

  it('parses /pattern/gi for global case insensitive', () => {
    const regex = parsePattern('/hello/gi');
    expect(regex.source).toBe('hello');
    expect(regex.flags).toBe('gi');
  });

  it('handles pattern with slashes inside', () => {
    const regex = parsePattern('/path\\/to\\/file/i');
    expect(regex.source).toBe('path\\/to\\/file');
    expect(regex.flags).toBe('i');
  });

  it('treats incomplete /pattern as plain regex', () => {
    const regex = parsePattern('/incomplete');
    expect(regex.source).toBe('\\/incomplete');
  });
});
