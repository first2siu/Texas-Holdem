import React from 'react';
import { createRoot } from 'react-dom/client';
import { io, Socket } from 'socket.io-client';
import type { GameSnapshot } from '@poker/shared';
import './styles.css';

const serverUrl = import.meta.env.VITE_SERVER_URL || window.location.origin;
const socket: Socket = io(serverUrl, { withCredentials: true, autoConnect: true });

type RoomOverview = {
  roomId: string;
  roomState: string;
  players: any[];
  logs: string[];
  joinCode: string;
  hostPlayerId: string | null;
};

const App = () => {
  const [nickname, setNickname] = React.useState('');
  const [roomId, setRoomId] = React.useState('');
  const [joinCode, setJoinCode] = React.useState('');
  const [room, setRoom] = React.useState<RoomOverview | null>(null);
  const [game, setGame] = React.useState<GameSnapshot | null>(null);
  const [error, setError] = React.useState('');
  const [chat, setChat] = React.useState('');

  React.useEffect(() => {
    const tokenStored = localStorage.getItem('playerToken');
    if (tokenStored) socket.auth = { token: tokenStored };
    socket.on('auth:token', (token: string) => localStorage.setItem('playerToken', token));
    socket.on('room:snapshot', setRoom);
    socket.on('game:snapshot', setGame);
    socket.on('error', (e: any) => setError(e.message || 'error'));
    return () => {
      socket.off('room:snapshot', setRoom);
      socket.off('game:snapshot', setGame);
    };
  }, []);

  const me = game?.players.find((p) => p.holeCards?.length);

  if (!room) {
    return (
      <div className="container">
        <h1>Texas Hold'em (Play Money)</h1>
        <input placeholder="昵称" value={nickname} onChange={(e) => setNickname(e.target.value)} />
        <button onClick={() => socket.emit('room:create', { nickname })}>创建房间</button>
        <input placeholder="房间号" value={roomId} onChange={(e) => setRoomId(e.target.value.toUpperCase())} />
        <input placeholder="Join Code" value={joinCode} onChange={(e) => setJoinCode(e.target.value.toUpperCase())} />
        <button onClick={() => socket.emit('room:join', { roomId, joinCode, nickname })}>加入房间</button>
        <p className="error">{error}</p>
      </div>
    );
  }

  const seatCells = Array.from({ length: 8 }, (_, i) => room.players.find((p) => p.seatIndex === i));
  const canStart = game?.hostPlayerId && game.players.some((p) => p.id === game.hostPlayerId && p.holeCards);

  return (
    <div className="container">
      <h2>房间 {room.roomId} / Code {room.joinCode}</h2>
      <button onClick={() => navigator.clipboard.writeText(`${window.location.origin}?roomId=${room.roomId}&joinCode=${room.joinCode}`)}>复制房间链接</button>
      <div className="board">
        <div>公共牌: {game?.board.map((c) => `${c.rank}${c.suit}`).join(' ') || '-'}</div>
        <div>Pot: {game?.pot ?? 0}</div>
        <div>阶段: {game?.handState}</div>
        <div>当前行动座位: {(game?.currentActorSeat ?? -1) + 1 || '-'}</div>
      </div>
      <div className="seats">
        {seatCells.map((p, idx) => (
          <button key={idx} className="seat" onClick={() => !p && socket.emit('seat:take', { seatIndex: idx })}>
            {p ? `${idx + 1}. ${p.nickname} (${p.chips}) ${p.connected ? '' : '离线'}` : `座位 ${idx + 1}`}
          </button>
        ))}
      </div>
      <div className="actions">
        <button onClick={() => socket.emit('game:ready', { ready: true })}>准备</button>
        <button onClick={() => socket.emit('game:ready', { ready: false })}>取消准备</button>
        <button onClick={() => socket.emit('game:start')} disabled={!canStart}>开始</button>
        <button onClick={() => socket.emit('seat:leave')}>离座观战</button>
      </div>
      <div className="actions">
        <button onClick={() => socket.emit('game:action', { type: 'fold' })}>fold</button>
        <button onClick={() => socket.emit('game:action', { type: 'check' })}>check</button>
        <button onClick={() => socket.emit('game:action', { type: 'call' })}>call</button>
        <button onClick={() => socket.emit('game:action', { type: 'bet', amount: 20 })}>bet 20</button>
        <button onClick={() => socket.emit('game:action', { type: 'raise', amount: 40 })}>raise 40</button>
        <button onClick={() => socket.emit('game:action', { type: 'all-in' })}>all-in</button>
      </div>
      <div>我的手牌: {me?.holeCards?.map((c) => `${c.rank}${c.suit}`).join(' ') ?? '-'}</div>
      <div className="chat">
        <input value={chat} onChange={(e) => setChat(e.target.value)} placeholder="聊天" />
        <button onClick={() => { socket.emit('chat:send', { message: chat }); setChat(''); }}>发送</button>
      </div>
      <pre>{room.logs.slice(-12).join('\n')}</pre>
      <p className="error">{error}</p>
    </div>
  );
};

createRoot(document.getElementById('root')!).render(<App />);
