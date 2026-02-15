import type { Card } from './types.js';
import { rankToValue } from './cards.js';

export type HandRank = {
  category: number;
  kickers: number[];
  name: string;
};

const combinations = <T>(arr: T[], pick: number): T[][] => {
  const result: T[][] = [];
  const go = (start: number, path: T[]) => {
    if (path.length === pick) {
      result.push([...path]);
      return;
    }
    for (let i = start; i < arr.length; i++) {
      path.push(arr[i]);
      go(i + 1, path);
      path.pop();
    }
  };
  go(0, []);
  return result;
};

const detectStraight = (values: number[]): number | null => {
  const unique = [...new Set(values)].sort((a, b) => b - a);
  if (unique.includes(14)) unique.push(1);
  let streak = 1;
  for (let i = 1; i < unique.length; i++) {
    if (unique[i - 1] - unique[i] === 1) {
      streak++;
      if (streak >= 5) return unique[i - 4];
    } else {
      streak = 1;
    }
  }
  return null;
};

const evaluateFive = (cards: Card[]): HandRank => {
  const values = cards.map((c) => rankToValue(c.rank)).sort((a, b) => b - a);
  const byCount = new Map<number, number>();
  for (const v of values) byCount.set(v, (byCount.get(v) ?? 0) + 1);
  const grouped = [...byCount.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0]);
  const flush = cards.every((c) => c.suit === cards[0].suit);
  const straightHigh = detectStraight(values);

  if (flush && straightHigh) {
    return {
      category: 8,
      kickers: [straightHigh],
      name: straightHigh === 14 ? 'Royal Flush' : 'Straight Flush'
    };
  }
  if (grouped[0][1] === 4) {
    return { category: 7, kickers: [grouped[0][0], grouped[1][0]], name: 'Four of a Kind' };
  }
  if (grouped[0][1] === 3 && grouped[1][1] === 2) {
    return { category: 6, kickers: [grouped[0][0], grouped[1][0]], name: 'Full House' };
  }
  if (flush) return { category: 5, kickers: values, name: 'Flush' };
  if (straightHigh) return { category: 4, kickers: [straightHigh], name: 'Straight' };
  if (grouped[0][1] === 3) {
    const kickers = grouped.slice(1).map(([v]) => v).sort((a, b) => b - a);
    return { category: 3, kickers: [grouped[0][0], ...kickers], name: 'Three of a Kind' };
  }
  if (grouped[0][1] === 2 && grouped[1][1] === 2) {
    const pairs = grouped.slice(0, 2).map(([v]) => v).sort((a, b) => b - a);
    const kicker = grouped.find(([, c]) => c === 1)?.[0] ?? 0;
    return { category: 2, kickers: [...pairs, kicker], name: 'Two Pair' };
  }
  if (grouped[0][1] === 2) {
    const kickers = grouped.slice(1).map(([v]) => v).sort((a, b) => b - a);
    return { category: 1, kickers: [grouped[0][0], ...kickers], name: 'One Pair' };
  }
  return { category: 0, kickers: values, name: 'High Card' };
};

export const compareHandRank = (a: HandRank, b: HandRank): number => {
  if (a.category !== b.category) return a.category - b.category;
  for (let i = 0; i < Math.max(a.kickers.length, b.kickers.length); i++) {
    const av = a.kickers[i] ?? 0;
    const bv = b.kickers[i] ?? 0;
    if (av !== bv) return av - bv;
  }
  return 0;
};

export const evaluateBestOfSeven = (cards: Card[]): HandRank => {
  if (cards.length !== 7) throw new Error('Expected 7 cards');
  let best = evaluateFive(cards.slice(0, 5));
  for (const c of combinations(cards, 5)) {
    const rank = evaluateFive(c);
    if (compareHandRank(rank, best) > 0) best = rank;
  }
  return best;
};
