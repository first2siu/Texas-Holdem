export type Suit = 'S' | 'H' | 'D' | 'C';
export type Rank =
  | '2'
  | '3'
  | '4'
  | '5'
  | '6'
  | '7'
  | '8'
  | '9'
  | 'T'
  | 'J'
  | 'Q'
  | 'K'
  | 'A';

export type Card = { rank: Rank; suit: Suit };

export type RoomState = 'lobby' | 'playing';
export type HandState = 'preflop' | 'flop' | 'turn' | 'river' | 'showdown' | 'hand_end';
export type PlayerState = 'active' | 'folded' | 'allin' | 'disconnected';

export type ActionType = 'fold' | 'check' | 'call' | 'bet' | 'raise' | 'all-in';

export type PlayerSnapshot = {
  id: string;
  token: string;
  nickname: string;
  seatIndex: number | null;
  chips: number;
  bet: number;
  state: PlayerState;
  isReady: boolean;
  connected: boolean;
  isSpectator: boolean;
  holeCards?: Card[];
  revealedCards?: Card[];
};

export type GameSnapshot = {
  roomId: string;
  roomState: RoomState;
  handState: HandState;
  players: PlayerSnapshot[];
  board: Card[];
  pot: number;
  sidePots: { amount: number; eligiblePlayerIds: string[] }[];
  dealerSeat: number;
  smallBlindSeat: number;
  bigBlindSeat: number;
  currentActorSeat: number | null;
  currentBet: number;
  minRaise: number;
  toCall: number;
  actionDeadline: number | null;
  logs: string[];
  joinCode: string;
  hostPlayerId: string | null;
};

export type GameAction = { type: ActionType; amount?: number };

export type SocketError = { code: string; message: string };
