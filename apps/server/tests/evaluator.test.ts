import { describe, expect, it } from 'vitest';
import { evaluateBestOfSeven } from '@poker/shared';

const c = (s: string) => ({ rank: s[0] as any, suit: s[1] as any });

describe('evaluator', () => {
  it('detects royal flush', () => {
    const rank = evaluateBestOfSeven(['AS', 'KS', 'QS', 'JS', 'TS', '2D', '3C'].map(c));
    expect(rank.name).toBe('Royal Flush');
  });

  it('supports wheel straight A2345', () => {
    const rank = evaluateBestOfSeven(['AS', '2D', '3H', '4C', '5S', 'KD', 'QH'].map(c));
    expect(rank.name).toBe('Straight');
    expect(rank.kickers[0]).toBe(5);
  });
});
