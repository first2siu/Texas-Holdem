import { randomInt } from 'node:crypto';
import type { Card, Rank, Suit } from './types.js';

export const RANK_VALUES: Rank[] = ['2', '3', '4', '5', '6', '7', '8', '9', 'T', 'J', 'Q', 'K', 'A'];
export const SUITS: Suit[] = ['S', 'H', 'D', 'C'];

export const rankToValue = (rank: Rank): number => RANK_VALUES.indexOf(rank) + 2;

export const buildDeck = (): Card[] =>
  SUITS.flatMap((suit) => RANK_VALUES.map((rank) => ({ suit, rank })));

export const shuffleDeck = (cards: Card[]): Card[] => {
  const deck = [...cards];
  for (let i = deck.length - 1; i > 0; i--) {
    const j = randomInt(0, i + 1);
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
};

export const cardLabel = (card: Card): string => `${card.rank}${card.suit}`;
