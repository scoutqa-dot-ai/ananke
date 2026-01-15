import { describe, it, expect } from 'vitest';
import { assertTiming } from './timing.js';
import type { ToolCall } from '../types/data.js';

const makeToolCall = (timestamp: number): ToolCall => ({
  name: 'tool',
  args: {},
  result: 'ok',
  timestamp,
});

describe('assertTiming', () => {
  it('passes when duration is within limit', () => {
    const results = assertTiming(
      { startTs: 1000, endTs: 2000, toolCalls: [] },
      { max_duration_ms: 5000 }
    );
    expect(results).toHaveLength(0);
  });

  it('fails when duration exceeds limit', () => {
    const results = assertTiming(
      { startTs: 1000, endTs: 10000, toolCalls: [] },
      { max_duration_ms: 5000 }
    );
    expect(results).toHaveLength(1);
    expect(results[0].passed).toBe(false);
    expect(results[0].actual).toBe('9000ms');
  });

  it('passes when gap is within limit', () => {
    const toolCalls = [makeToolCall(1000), makeToolCall(2000)];
    const results = assertTiming(
      { startTs: 1000, endTs: 3000, toolCalls },
      { max_gap_ms: 5000 }
    );
    expect(results).toHaveLength(0);
  });

  it('fails when gap exceeds limit', () => {
    const toolCalls = [makeToolCall(1000), makeToolCall(10000)];
    const results = assertTiming(
      { startTs: 1000, endTs: 11000, toolCalls },
      { max_gap_ms: 5000 }
    );
    expect(results).toHaveLength(1);
    expect(results[0].passed).toBe(false);
    expect(results[0].actual).toContain('9000ms');
  });

  it('ignores gap check with single tool call', () => {
    const toolCalls = [makeToolCall(1000)];
    const results = assertTiming(
      { startTs: 1000, endTs: 2000, toolCalls },
      { max_gap_ms: 100 }
    );
    expect(results).toHaveLength(0);
  });
});
