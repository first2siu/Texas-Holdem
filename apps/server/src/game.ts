import { writeFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { nanoid } from 'nanoid';
import {
  buildDeck,
  evaluateBestOfSeven,
  shuffleDeck,
  compareHandRank,
  type ActionType,
  type Card,
  type GameAction,
  type GameSnapshot,
  type HandState,
  type PlayerState,
  type PlayerSnapshot,
  type RoomState
} from '@poker/shared';

export type ServerPlayer = PlayerSnapshot & {
  socketId: string | null;
  hasActed: boolean;
  totalContribution: number;
};

export type Room = {
  roomId: string;
  joinCode: string;
  state: RoomState;
  players: ServerPlayer[];
  board: Card[];
  deck: Card[];
  pot: number;
  sidePots: { amount: number; eligiblePlayerIds: string[] }[];
  handState: HandState;
  dealerSeat: number;
  smallBlindSeat: number;
  bigBlindSeat: number;
  currentActorSeat: number | null;
  currentBet: number;
  minRaise: number;
  actionDeadline: number | null;
  logs: string[];
  hostPlayerId: string | null;
  lastAggressorSeat: number | null;
};

export class GameManager {
  rooms = new Map<string, Room>();
  constructor(
    private actionTimeoutMs: number,
    private persistPath: string
  ) {
    this.loadPersistence();
  }

  persistMinimal() {
    const obj = [...this.rooms.values()].map((r) => ({
      roomId: r.roomId,
      joinCode: r.joinCode,
      hostPlayerId: r.hostPlayerId,
      players: r.players.map((p) => ({
        id: p.id,
        token: p.token,
        nickname: p.nickname,
        chips: p.chips,
        seatIndex: p.seatIndex,
        isSpectator: p.isSpectator
      }))
    }));
    mkdirSync(dirname(this.persistPath), { recursive: true });
    writeFileSync(this.persistPath, JSON.stringify(obj, null, 2), 'utf-8');
  }

  loadPersistence() {
    if (!existsSync(this.persistPath)) return;
    const raw = JSON.parse(readFileSync(this.persistPath, 'utf-8')) as any[];
    for (const saved of raw) {
      const room: Room = {
        roomId: saved.roomId,
        joinCode: saved.joinCode,
        state: 'lobby',
        players: (saved.players ?? []).map((p: any) => ({
          ...p,
          bet: 0,
          state: 'active',
          isReady: false,
          connected: false,
          holeCards: [],
          socketId: null,
          hasActed: false,
          totalContribution: 0,
          revealedCards: []
        })),
        board: [],
        deck: [],
        pot: 0,
        sidePots: [],
        handState: 'hand_end',
        dealerSeat: 0,
        smallBlindSeat: 0,
        bigBlindSeat: 0,
        currentActorSeat: null,
        currentBet: 0,
        minRaise: 20,
        actionDeadline: null,
        logs: ['Recovered room from persistence. Start a new hand.'],
        hostPlayerId: saved.hostPlayerId,
        lastAggressorSeat: null
      };
      this.rooms.set(room.roomId, room);
    }
  }

  createRoom(nickname: string, token: string, socketId: string) {
    const roomId = nanoid(6).toUpperCase();
    const joinCode = nanoid(8).toUpperCase();
    const player = this.newPlayer(nickname, token, socketId);
    player.seatIndex = 0;
    player.isSpectator = false;
    const room: Room = {
      roomId,
      joinCode,
      state: 'lobby',
      players: [player],
      board: [],
      deck: [],
      pot: 0,
      sidePots: [],
      handState: 'hand_end',
      dealerSeat: 0,
      smallBlindSeat: 0,
      bigBlindSeat: 0,
      currentActorSeat: null,
      currentBet: 0,
      minRaise: 20,
      actionDeadline: null,
      logs: [`${nickname} created room.`],
      hostPlayerId: player.id,
      lastAggressorSeat: null
    };
    this.rooms.set(roomId, room);
    this.persistMinimal();
    return { room, player };
  }

  newPlayer(nickname: string, token: string, socketId: string): ServerPlayer {
    return {
      id: nanoid(),
      token,
      nickname,
      seatIndex: null,
      chips: 1000,
      bet: 0,
      state: 'active',
      isReady: false,
      connected: true,
      isSpectator: true,
      holeCards: [],
      revealedCards: [],
      socketId,
      hasActed: false,
      totalContribution: 0
    };
  }

  findRoom(roomId: string) {
    return this.rooms.get(roomId);
  }

  joinRoom(room: Room, nickname: string, token: string, socketId: string) {
    const existing = room.players.find((p) => p.token === token);
    if (existing) {
      existing.socketId = socketId;
      existing.connected = true;
      existing.nickname = nickname || existing.nickname;
      return existing;
    }
    const player = this.newPlayer(nickname, token, socketId);
    room.players.push(player);
    room.logs.push(`${nickname} joined as spectator.`);
    this.persistMinimal();
    return player;
  }

  takeSeat(room: Room, playerId: string, seatIndex: number) {
    if (seatIndex < 0 || seatIndex > 7) throw new Error('Invalid seat');
    if (room.players.some((p) => p.seatIndex === seatIndex)) throw new Error('Seat occupied');
    const player = room.players.find((p) => p.id === playerId);
    if (!player) throw new Error('Player not found');
    if (room.players.some((p) => p.token === player.token && p.seatIndex !== null && p.id !== player.id)) {
      throw new Error('Token already seated');
    }
    player.seatIndex = seatIndex;
    player.isSpectator = false;
    room.logs.push(`${player.nickname} took seat ${seatIndex + 1}.`);
    this.persistMinimal();
  }

  leaveSeat(room: Room, playerId: string) {
    const player = room.players.find((p) => p.id === playerId);
    if (!player) return;
    player.seatIndex = null;
    player.isSpectator = true;
    player.isReady = false;
    room.logs.push(`${player.nickname} moved to spectator.`);
    this.persistMinimal();
  }

  toggleReady(room: Room, playerId: string, ready: boolean) {
    const player = room.players.find((p) => p.id === playerId);
    if (!player) throw new Error('Player not found');
    if (player.isSpectator) throw new Error('Spectator cannot ready');
    player.isReady = ready;
    room.logs.push(`${player.nickname} is ${ready ? 'ready' : 'not ready'}.`);
  }

  activeSeated(room: Room) {
    return room.players
      .filter((p) => p.seatIndex !== null && !p.isSpectator && p.connected)
      .sort((a, b) => (a.seatIndex ?? 99) - (b.seatIndex ?? 99));
  }

  startGame(room: Room) {
    const seated = room.players.filter((p) => p.seatIndex !== null && !p.isSpectator);
    if (seated.length < 2) throw new Error('Need at least 2 seated players');
    if (!seated.every((p) => p.isReady)) throw new Error('All seated players must be ready');
    room.state = 'playing';
    this.startHand(room);
  }

  private nextOccupiedSeat(room: Room, fromSeat: number): number {
    for (let i = 1; i <= 8; i++) {
      const candidate = (fromSeat + i) % 8;
      const player = room.players.find((p) => p.seatIndex === candidate && !p.isSpectator && p.chips > 0);
      if (player) return candidate;
    }
    return fromSeat;
  }

  private playerAtSeat(room: Room, seat: number) {
    return room.players.find((p) => p.seatIndex === seat && !p.isSpectator);
  }

  startHand(room: Room) {
    room.handState = 'preflop';
    room.board = [];
    room.pot = 0;
    room.sidePots = [];
    room.currentBet = 0;
    room.minRaise = 20;
    room.lastAggressorSeat = null;
    room.deck = shuffleDeck(buildDeck());
    for (const p of room.players) {
      p.bet = 0;
      p.totalContribution = 0;
      p.hasActed = false;
      p.state = p.seatIndex === null || p.isSpectator || p.chips <= 0 ? 'folded' : p.connected ? 'active' : 'disconnected';
      p.holeCards = [];
      p.revealedCards = [];
    }
    room.dealerSeat = this.nextOccupiedSeat(room, room.dealerSeat);
    room.smallBlindSeat = this.nextOccupiedSeat(room, room.dealerSeat);
    room.bigBlindSeat = this.nextOccupiedSeat(room, room.smallBlindSeat);

    this.postBlind(room, room.smallBlindSeat, 10);
    this.postBlind(room, room.bigBlindSeat, 20);
    room.currentBet = 20;
    room.minRaise = 20;

    const seated = room.players.filter((p) => p.seatIndex !== null && !p.isSpectator && p.chips > 0);
    for (let round = 0; round < 2; round++) {
      for (const p of seated.sort((a, b) => (a.seatIndex ?? 99) - (b.seatIndex ?? 99))) {
        if (p.state === 'folded') continue;
        p.holeCards = [...(p.holeCards ?? []), room.deck.pop()!];
      }
    }
    room.currentActorSeat = this.nextActorFrom(room, room.bigBlindSeat);
    this.bumpDeadline(room);
    room.logs.push('New hand started.');
  }

  private postBlind(room: Room, seat: number, amount: number) {
    const player = this.playerAtSeat(room, seat);
    if (!player) return;
    const paid = Math.min(player.chips, amount);
    player.chips -= paid;
    player.bet += paid;
    player.totalContribution += paid;
    room.pot += paid;
    if (player.chips === 0) player.state = 'allin';
  }

  private nextActorFrom(room: Room, fromSeat: number): number | null {
    for (let i = 1; i <= 8; i++) {
      const seat = (fromSeat + i) % 8;
      const p = this.playerAtSeat(room, seat);
      if (p && p.state === 'active') return seat;
    }
    return null;
  }

  private livingPlayers(room: Room) {
    return room.players.filter((p) => p.seatIndex !== null && !p.isSpectator && p.state !== 'folded');
  }

  private roundComplete(room: Room) {
    const actives = room.players.filter((p) => p.seatIndex !== null && !p.isSpectator && p.state === 'active');
    if (actives.length === 0) return true;
    return actives.every((p) => p.hasActed && p.bet === room.currentBet);
  }

  action(room: Room, playerId: string, action: GameAction) {
    const player = room.players.find((p) => p.id === playerId);
    if (!player || player.seatIndex === null) throw new Error('Invalid player');
    if (room.currentActorSeat !== player.seatIndex) throw new Error('Not your turn');
    if (player.state !== 'active') throw new Error('Player not active');

    const toCall = Math.max(0, room.currentBet - player.bet);
    const commit = (amount: number) => {
      const paid = Math.min(player.chips, amount);
      player.chips -= paid;
      player.bet += paid;
      player.totalContribution += paid;
      room.pot += paid;
      if (player.chips === 0) player.state = 'allin';
      return paid;
    };

    switch (action.type as ActionType) {
      case 'fold':
        player.state = 'folded';
        break;
      case 'check':
        if (toCall > 0) throw new Error('Cannot check');
        break;
      case 'call':
        if (toCall <= 0) throw new Error('Nothing to call');
        commit(toCall);
        break;
      case 'bet': {
        if (room.currentBet > 0 && toCall > 0) throw new Error('Use raise/call');
        const amount = action.amount ?? 0;
        if (amount <= 0 || amount > player.chips) throw new Error('Invalid bet amount');
        commit(amount);
        room.currentBet = player.bet;
        room.minRaise = amount;
        room.lastAggressorSeat = player.seatIndex;
        for (const p of room.players) if (p.id !== player.id) p.hasActed = false;
        break;
      }
      case 'raise': {
        const amount = action.amount ?? 0;
        const raiseBy = amount - toCall;
        if (amount <= toCall) throw new Error('Raise too small');
        if (raiseBy < room.minRaise && amount < player.chips) throw new Error('Below min raise');
        commit(amount);
        room.minRaise = Math.max(room.minRaise, raiseBy);
        room.currentBet = Math.max(room.currentBet, player.bet);
        room.lastAggressorSeat = player.seatIndex;
        for (const p of room.players) if (p.id !== player.id) p.hasActed = false;
        break;
      }
      case 'all-in': {
        const amount = player.chips;
        const paid = commit(amount);
        if (player.bet > room.currentBet) {
          const raiseBy = player.bet - room.currentBet;
          room.currentBet = player.bet;
          if (raiseBy >= room.minRaise) {
            room.minRaise = raiseBy;
            room.lastAggressorSeat = player.seatIndex;
            for (const p of room.players) if (p.id !== player.id) p.hasActed = false;
          }
        }
        if (paid <= 0) throw new Error('No chips left');
        break;
      }
      default:
        throw new Error('Unknown action');
    }

    player.hasActed = true;
    this.advance(room);
  }

  private advance(room: Room) {
    const alive = this.livingPlayers(room);
    if (alive.length <= 1) {
      this.finishWithoutShowdown(room);
      return;
    }
    if (this.roundComplete(room)) {
      this.nextStreet(room);
      return;
    }
    room.currentActorSeat = this.nextActorFrom(room, room.currentActorSeat ?? room.dealerSeat);
    this.bumpDeadline(room);
  }

  private resetBetsForStreet(room: Room) {
    room.currentBet = 0;
    room.minRaise = 20;
    for (const p of room.players) {
      p.bet = 0;
      p.hasActed = p.state !== 'active';
    }
  }

  private nextStreet(room: Room) {
    this.resetBetsForStreet(room);
    if (room.handState === 'preflop') {
      room.handState = 'flop';
      room.board.push(room.deck.pop()!, room.deck.pop()!, room.deck.pop()!);
    } else if (room.handState === 'flop') {
      room.handState = 'turn';
      room.board.push(room.deck.pop()!);
    } else if (room.handState === 'turn') {
      room.handState = 'river';
      room.board.push(room.deck.pop()!);
    } else if (room.handState === 'river') {
      room.handState = 'showdown';
      this.resolveShowdown(room);
      return;
    }
    room.currentActorSeat = this.nextActorFrom(room, room.dealerSeat);
    this.bumpDeadline(room);
    room.logs.push(`Moved to ${room.handState}.`);
  }

  private buildSidePots(room: Room) {
    const contenders = room.players.filter((p) => p.totalContribution > 0);
    const levels = [...new Set(contenders.map((p) => p.totalContribution))].sort((a, b) => a - b);
    const sidePots: { amount: number; eligiblePlayerIds: string[] }[] = [];
    let prev = 0;
    for (const level of levels) {
      const involved = contenders.filter((p) => p.totalContribution >= level);
      const delta = level - prev;
      const amount = delta * involved.length;
      const eligiblePlayerIds = involved.filter((p) => p.state !== 'folded').map((p) => p.id);
      sidePots.push({ amount, eligiblePlayerIds });
      prev = level;
    }
    room.sidePots = sidePots;
  }

  private resolveShowdown(room: Room) {
    this.buildSidePots(room);
    const active = room.players.filter((p) => p.state !== 'folded' && p.seatIndex !== null && !p.isSpectator);
    for (const p of active) p.revealedCards = [...(p.holeCards ?? [])];

    for (const pot of room.sidePots) {
      const eligible = active.filter((p) => pot.eligiblePlayerIds.includes(p.id));
      if (eligible.length === 0) continue;
      let best = eligible[0];
      let bestRank = evaluateBestOfSeven([...(best.holeCards ?? []), ...room.board]);
      let winners = [best];
      for (let i = 1; i < eligible.length; i++) {
        const contender = eligible[i];
        const rank = evaluateBestOfSeven([...(contender.holeCards ?? []), ...room.board]);
        const cmp = compareHandRank(rank, bestRank);
        if (cmp > 0) {
          best = contender;
          bestRank = rank;
          winners = [contender];
        } else if (cmp === 0) {
          winners.push(contender);
        }
      }
      const each = Math.floor(pot.amount / winners.length);
      let rem = pot.amount % winners.length;
      for (const w of winners) {
        w.chips += each + (rem > 0 ? 1 : 0);
        if (rem > 0) rem--;
      }
      room.logs.push(`Pot ${pot.amount} won by ${winners.map((w) => w.nickname).join(', ')}.`);
    }
    room.handState = 'hand_end';
    room.currentActorSeat = null;
    room.actionDeadline = null;
    for (const p of room.players) p.isReady = false;
    room.state = 'lobby';
  }

  private finishWithoutShowdown(room: Room) {
    const winner = this.livingPlayers(room)[0];
    if (winner) winner.chips += room.pot;
    if (winner) room.logs.push(`${winner.nickname} wins ${room.pot} uncontested.`);
    room.handState = 'hand_end';
    room.currentActorSeat = null;
    room.actionDeadline = null;
    room.state = 'lobby';
    for (const p of room.players) p.isReady = false;
  }

  timeoutAct(room: Room) {
    if (room.currentActorSeat === null) return;
    const player = this.playerAtSeat(room, room.currentActorSeat);
    if (!player || player.state !== 'active') return;
    const toCall = Math.max(0, room.currentBet - player.bet);
    if (toCall === 0) this.action(room, player.id, { type: 'check' });
    else this.action(room, player.id, { type: 'fold' });
  }

  bumpDeadline(room: Room) {
    room.actionDeadline = Date.now() + this.actionTimeoutMs;
  }

  snapshotFor(room: Room, viewerId: string): GameSnapshot {
    const players = room.players.map((p) => {
      const own = p.id === viewerId;
      const showdown = room.handState === 'showdown' || room.handState === 'hand_end';
      return {
        ...p,
        holeCards: own || showdown ? p.holeCards : undefined
      };
    });
    const viewer = room.players.find((p) => p.id === viewerId);
    const toCall = viewer ? Math.max(0, room.currentBet - viewer.bet) : 0;
    return {
      roomId: room.roomId,
      roomState: room.state,
      handState: room.handState,
      players,
      board: room.board,
      pot: room.pot,
      sidePots: room.sidePots,
      dealerSeat: room.dealerSeat,
      smallBlindSeat: room.smallBlindSeat,
      bigBlindSeat: room.bigBlindSeat,
      currentActorSeat: room.currentActorSeat,
      currentBet: room.currentBet,
      minRaise: room.minRaise,
      toCall,
      actionDeadline: room.actionDeadline,
      logs: room.logs.slice(-30),
      joinCode: room.joinCode,
      hostPlayerId: room.hostPlayerId
    };
  }
}
