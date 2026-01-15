import { describe, it, expect } from 'vitest';
import {
  assertForbiddenTools,
  assertRequiredTools,
  assertForbiddenCalls,
} from './tools.js';
import type { ToolCall } from '../types/data.js';

const makeToolCall = (
  name: string,
  args: Record<string, unknown> = {},
  result: unknown = 'ok'
): ToolCall => ({
  name,
  args,
  result,
  timestamp: Date.now(),
});

describe('assertForbiddenTools', () => {
  it('passes when forbidden tools are not called', () => {
    const toolCalls = [makeToolCall('safe_tool')];
    const results = assertForbiddenTools(toolCalls, ['dangerous_tool']);
    expect(results).toHaveLength(0);
  });

  it('fails when forbidden tool is called', () => {
    const toolCalls = [makeToolCall('dangerous_tool', { x: 1 })];
    const results = assertForbiddenTools(toolCalls, ['dangerous_tool']);
    expect(results).toHaveLength(1);
    expect(results[0].passed).toBe(false);
    expect(results[0].assertion).toContain('dangerous_tool');
  });
});

describe('assertRequiredTools', () => {
  it('passes when required tool is called', () => {
    const toolCalls = [makeToolCall('required_tool')];
    const results = assertRequiredTools(toolCalls, [{ name: 'required_tool' }]);
    expect(results).toHaveLength(0);
  });

  it('fails when required tool is not called', () => {
    const toolCalls = [makeToolCall('other_tool')];
    const results = assertRequiredTools(toolCalls, [{ name: 'required_tool' }]);
    expect(results).toHaveLength(1);
    expect(results[0].passed).toBe(false);
  });

  it('checks exact count', () => {
    const toolCalls = [makeToolCall('tool'), makeToolCall('tool')];
    const results = assertRequiredTools(toolCalls, [
      { name: 'tool', count: { exact: 1 } },
    ]);
    expect(results).toHaveLength(1);
    expect(results[0].actual).toBe('2');
  });

  it('checks min/max count', () => {
    const toolCalls = [makeToolCall('tool')];
    const results = assertRequiredTools(toolCalls, [
      { name: 'tool', count: { min: 2 } },
    ]);
    expect(results).toHaveLength(1);
    expect(results[0].expected).toContain('at least 2');
  });

  it('checks args_match', () => {
    const toolCalls = [makeToolCall('tool', { query: 'hello world' })];
    const results = assertRequiredTools(toolCalls, [
      { name: 'tool', args_match: { query: 'hello' } },
    ]);
    expect(results).toHaveLength(0);
  });

  it('passes args_match when at least one call matches among multiple', () => {
    const toolCalls = [
      makeToolCall('tool', { query: 'hello world' }),
      makeToolCall('tool', { query: 'goodbye world' }),
    ];
    const results = assertRequiredTools(toolCalls, [
      { name: 'tool', args_match: { query: 'hello' } },
    ]);
    expect(results).toHaveLength(0);
  });

  it('checks count with args_match filters matching calls only', () => {
    const toolCalls = [
      makeToolCall('tool', { query: 'hello 1' }),
      makeToolCall('tool', { query: 'hello 2' }),
      makeToolCall('tool', { query: 'goodbye' }),
    ];
    // Require exactly 2 calls matching 'hello'
    const results = assertRequiredTools(toolCalls, [
      { name: 'tool', args_match: { query: 'hello' }, count: { exact: 2 } },
    ]);
    expect(results).toHaveLength(0);
  });

  it('fails args_match when pattern does not match', () => {
    const toolCalls = [makeToolCall('tool', { query: 'goodbye' })];
    const results = assertRequiredTools(toolCalls, [
      { name: 'tool', args_match: { query: 'hello' } },
    ]);
    expect(results).toHaveLength(1);
    expect(results[0].passed).toBe(false);
    expect(results[0].assertion).toContain('matching args');
    expect(results[0].actual).toBe('0');
  });

  it('checks args_match with nested dot notation', () => {
    const toolCalls = [
      makeToolCall('tool', {
        user: { name: 'John', address: { city: 'Paris' } },
      }),
    ];
    const results = assertRequiredTools(toolCalls, [
      { name: 'tool', args_match: { 'user.name': 'John', 'user.address.city': 'Paris' } },
    ]);
    expect(results).toHaveLength(0);
  });

  it('fails args_match with nested dot notation when not matching', () => {
    const toolCalls = [
      makeToolCall('tool', {
        user: { name: 'Jane', address: { city: 'London' } },
      }),
    ];
    const results = assertRequiredTools(toolCalls, [
      { name: 'tool', args_match: { 'user.name': 'John' } },
    ]);
    expect(results).toHaveLength(1);
    expect(results[0].passed).toBe(false);
    expect(results[0].assertion).toContain('matching args');
    expect(results[0].actual).toBe('0');
  });

  it('fails args_match when nested path does not exist', () => {
    const toolCalls = [makeToolCall('tool', { user: { name: 'John' } })];
    const results = assertRequiredTools(toolCalls, [
      { name: 'tool', args_match: { 'user.address.city': 'Paris' } },
    ]);
    expect(results).toHaveLength(1);
    expect(results[0].passed).toBe(false);
    expect(results[0].assertion).toContain('matching args');
    expect(results[0].actual).toBe('0');
  });

  it('checks result_match', () => {
    const toolCalls = [makeToolCall('tool', {}, 'success: done')];
    const results = assertRequiredTools(toolCalls, [
      { name: 'tool', result_match: 'success' },
    ]);
    expect(results).toHaveLength(0);
  });

  it('checks result_not_match', () => {
    const toolCalls = [makeToolCall('tool', {}, 'error: failed')];
    const results = assertRequiredTools(toolCalls, [
      { name: 'tool', result_not_match: 'error' },
    ]);
    expect(results).toHaveLength(1);
    expect(results[0].passed).toBe(false);
  });

  it('checks ordering with after', () => {
    const toolCalls = [makeToolCall('first'), makeToolCall('second')];
    const results = assertRequiredTools(toolCalls, [
      { name: 'second', after: 'first' },
    ]);
    expect(results).toHaveLength(0);
  });

  it('fails ordering when after constraint violated', () => {
    const toolCalls = [makeToolCall('second'), makeToolCall('first')];
    const results = assertRequiredTools(toolCalls, [
      { name: 'second', after: 'first' },
    ]);
    expect(results).toHaveLength(1);
    expect(results[0].passed).toBe(false);
  });
});

describe('assertForbiddenCalls', () => {
  it('passes when no matching forbidden calls', () => {
    const toolCalls = [makeToolCall('tool', { safe: true })];
    const results = assertForbiddenCalls(toolCalls, [
      { name: 'tool', args_match: { dangerous: 'true' } },
    ]);
    expect(results).toHaveLength(0);
  });

  it('fails when args match forbidden pattern', () => {
    const toolCalls = [makeToolCall('tool', { dangerous: 'true' })];
    const results = assertForbiddenCalls(toolCalls, [
      { name: 'tool', args_match: { dangerous: 'true' } },
    ]);
    expect(results).toHaveLength(1);
    expect(results[0].passed).toBe(false);
  });

  it('fails when result matches forbidden pattern', () => {
    const toolCalls = [makeToolCall('tool', {}, 'declined')];
    const results = assertForbiddenCalls(toolCalls, [
      { name: 'tool', result_match: 'declined' },
    ]);
    expect(results).toHaveLength(1);
    expect(results[0].passed).toBe(false);
  });

  it('checks nested args_match with dot notation', () => {
    const toolCalls = [
      makeToolCall('tool', { config: { dangerous: true } }),
    ];
    const results = assertForbiddenCalls(toolCalls, [
      { name: 'tool', args_match: { 'config.dangerous': 'true' } },
    ]);
    expect(results).toHaveLength(1);
    expect(results[0].passed).toBe(false);
  });

  it('passes nested args_match when path does not exist', () => {
    const toolCalls = [makeToolCall('tool', { config: { safe: true } })];
    const results = assertForbiddenCalls(toolCalls, [
      { name: 'tool', args_match: { 'config.dangerous': 'true' } },
    ]);
    expect(results).toHaveLength(0);
  });
});
