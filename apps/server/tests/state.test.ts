import { describe, expect, it } from 'vitest';
import { GameManager } from '../src/game.js';

const create2pRoom = () => {
  const gm = new GameManager(25000, './tmp/test-rooms.json');
  const { room, player } = gm.createRoom('A', 'ta', 'sa');
  const b = gm.joinRoom(room, 'B', 'tb', 'sb');
  gm.takeSeat(room, b.id, 1);
  gm.toggleReady(room, player.id, true);
  gm.toggleReady(room, b.id, true);
  gm.startGame(room);
  return { gm, room, a: player, b };
};

describe('state machine', () => {
  it('moves preflop to flop after matched actions', () => {
    const { gm, room } = create2pRoom();
    while (room.handState === 'preflop') {
      const actor = room.players.find((p) => p.seatIndex === room.currentActorSeat)!;
      const toCall = Math.max(0, room.currentBet - actor.bet);
      gm.action(room, actor.id, { type: toCall > 0 ? 'call' : 'check' });
    }
    expect(room.handState).toBe('flop');
  });

  it('raise updates current bet and minRaise', () => {
    const { gm, room } = create2pRoom();
    const actor = room.players.find((p) => p.seatIndex === room.currentActorSeat)!;
    const toCall = Math.max(0, room.currentBet - actor.bet);
    gm.action(room, actor.id, { type: 'raise', amount: toCall + 40 });
    expect(room.currentBet).toBeGreaterThanOrEqual(40);
    expect(room.minRaise).toBeGreaterThan(0);
  });

  it('showdown resolves and returns to lobby', () => {
    const { gm, room } = create2pRoom();
    for (let guard = 0; guard < 30 && room.state === 'playing'; guard++) {
      if (room.currentActorSeat === null) break;
      const actor = room.players.find((p) => p.seatIndex === room.currentActorSeat)!;
      const toCall = Math.max(0, room.currentBet - actor.bet);
      gm.action(room, actor.id, { type: toCall > 0 ? 'call' : 'check' });
    }
    expect(room.state).toBe('lobby');
    expect(room.handState).toBe('hand_end');
  });
});
