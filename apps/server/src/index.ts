import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { Server } from 'socket.io';
import { z } from 'zod';
import { nanoid } from 'nanoid';
import { GameManager } from './game.js';

const port = Number(process.env.PORT ?? 3000);
const actionTimeoutSeconds = Number(process.env.ACTION_TIMEOUT_SECONDS ?? 25);
const persistPath = process.env.ROOM_PERSIST_PATH ?? './data/rooms.json';
const rateWindow = Number(process.env.RATE_LIMIT_WINDOW_MS ?? 60_000);
const rateMax = Number(process.env.RATE_LIMIT_MAX_EVENTS ?? 120);

const app = express();
app.set('trust proxy', 1);
app.use(express.json());
app.use(
  cors({
    origin: process.env.CORS_ORIGIN || true,
    credentials: true
  })
);

const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: { origin: process.env.CORS_ORIGIN || true, credentials: true }
});

const manager = new GameManager(actionTimeoutSeconds * 1000, persistPath);
const socketMeta = new Map<string, { playerId: string; roomId: string }>();
const rate = new Map<string, { count: number; resetAt: number }>();

const makeToken = () => nanoid();

io.use((socket, next) => {
  const key = socket.handshake.address;
  const now = Date.now();
  const item = rate.get(key) ?? { count: 0, resetAt: now + rateWindow };
  if (now > item.resetAt) {
    item.count = 0;
    item.resetAt = now + rateWindow;
  }
  item.count += 1;
  rate.set(key, item);
  if (item.count > rateMax) return next(new Error('rate_limited'));
  next();
});

const createSchema = z.object({ nickname: z.string().min(1).max(20) });
const joinSchema = z.object({ roomId: z.string().min(4), joinCode: z.string().min(4), nickname: z.string().min(1).max(20) });
const seatSchema = z.object({ seatIndex: z.number().int().min(0).max(7) });
const readySchema = z.object({ ready: z.boolean() });
const actionSchema = z.object({ type: z.enum(['fold', 'check', 'call', 'bet', 'raise', 'all-in']), amount: z.number().int().positive().optional() });

const emitSnapshots = (roomId: string) => {
  const room = manager.findRoom(roomId);
  if (!room) return;
  for (const p of room.players) {
    if (p.socketId) io.to(p.socketId).emit('game:snapshot', manager.snapshotFor(room, p.id));
  }
  io.to(roomId).emit('room:snapshot', {
    roomId: room.roomId,
    roomState: room.state,
    players: room.players,
    logs: room.logs.slice(-30),
    joinCode: room.joinCode,
    hostPlayerId: room.hostPlayerId
  });
};

io.on('connection', (socket) => {
  const cookies = cookieParser.parse(socket.handshake.headers.cookie || '');
  const token = cookies.playerToken || socket.handshake.auth?.token || makeToken();
  socket.emit('auth:token', token);

  socket.on('room:create', (payload) => {
    const parsed = createSchema.safeParse(payload);
    if (!parsed.success) return socket.emit('error', { code: 'bad_request', message: 'Invalid payload' });
    const { room, player } = manager.createRoom(parsed.data.nickname.trim(), token, socket.id);
    socketMeta.set(socket.id, { roomId: room.roomId, playerId: player.id });
    socket.join(room.roomId);
    emitSnapshots(room.roomId);
  });

  socket.on('room:join', (payload) => {
    const parsed = joinSchema.safeParse(payload);
    if (!parsed.success) return socket.emit('error', { code: 'bad_request', message: 'Invalid payload' });
    const room = manager.findRoom(parsed.data.roomId.toUpperCase());
    if (!room) return socket.emit('error', { code: 'not_found', message: 'Room not found' });
    if (room.joinCode !== parsed.data.joinCode.toUpperCase()) return socket.emit('error', { code: 'forbidden', message: 'Invalid join code' });
    const player = manager.joinRoom(room, parsed.data.nickname.trim(), token, socket.id);
    socketMeta.set(socket.id, { roomId: room.roomId, playerId: player.id });
    socket.join(room.roomId);
    emitSnapshots(room.roomId);
  });

  socket.on('seat:take', (payload) => {
    const parsed = seatSchema.safeParse(payload);
    if (!parsed.success) return;
    const meta = socketMeta.get(socket.id);
    if (!meta) return;
    const room = manager.findRoom(meta.roomId);
    if (!room) return;
    try {
      manager.takeSeat(room, meta.playerId, parsed.data.seatIndex);
      emitSnapshots(room.roomId);
    } catch (e: any) {
      socket.emit('error', { code: 'seat_error', message: e.message });
    }
  });

  socket.on('seat:leave', () => {
    const meta = socketMeta.get(socket.id);
    if (!meta) return;
    const room = manager.findRoom(meta.roomId);
    if (!room) return;
    manager.leaveSeat(room, meta.playerId);
    emitSnapshots(room.roomId);
  });

  socket.on('game:ready', (payload) => {
    const parsed = readySchema.safeParse(payload);
    if (!parsed.success) return;
    const meta = socketMeta.get(socket.id);
    if (!meta) return;
    const room = manager.findRoom(meta.roomId);
    if (!room) return;
    try {
      manager.toggleReady(room, meta.playerId, parsed.data.ready);
      emitSnapshots(room.roomId);
    } catch (e: any) {
      socket.emit('error', { code: 'ready_error', message: e.message });
    }
  });

  socket.on('game:start', () => {
    const meta = socketMeta.get(socket.id);
    if (!meta) return;
    const room = manager.findRoom(meta.roomId);
    if (!room) return;
    const me = room.players.find((p) => p.id === meta.playerId);
    if (!me || me.id !== room.hostPlayerId) return socket.emit('error', { code: 'forbidden', message: 'Only host can start' });
    try {
      manager.startGame(room);
      emitSnapshots(room.roomId);
    } catch (e: any) {
      socket.emit('error', { code: 'start_error', message: e.message });
    }
  });

  socket.on('game:action', (payload) => {
    const parsed = actionSchema.safeParse(payload);
    if (!parsed.success) return;
    const meta = socketMeta.get(socket.id);
    if (!meta) return;
    const room = manager.findRoom(meta.roomId);
    if (!room) return;
    try {
      manager.action(room, meta.playerId, parsed.data);
      emitSnapshots(room.roomId);
    } catch (e: any) {
      socket.emit('error', { code: 'action_error', message: e.message });
    }
  });

  socket.on('chat:send', (payload) => {
    const message = typeof payload?.message === 'string' ? payload.message.slice(0, 200) : '';
    const meta = socketMeta.get(socket.id);
    if (!meta || !message) return;
    const room = manager.findRoom(meta.roomId);
    if (!room) return;
    const player = room.players.find((p) => p.id === meta.playerId);
    room.logs.push(`[CHAT] ${player?.nickname ?? 'Unknown'}: ${message}`);
    emitSnapshots(room.roomId);
  });

  socket.on('disconnect', () => {
    const meta = socketMeta.get(socket.id);
    if (!meta) return;
    const room = manager.findRoom(meta.roomId);
    if (!room) return;
    const player = room.players.find((p) => p.id === meta.playerId);
    if (player) {
      player.connected = false;
      player.socketId = null;
      if (room.state === 'playing' && player.state === 'active') player.state = 'disconnected';
      room.logs.push(`${player.nickname} disconnected.`);
    }
    emitSnapshots(room.roomId);
  });
});

setInterval(() => {
  for (const room of manager.rooms.values()) {
    if (room.actionDeadline && room.actionDeadline < Date.now() && room.currentActorSeat !== null) {
      manager.timeoutAct(room);
      emitSnapshots(room.roomId);
    }
  }
}, 1000);

const publicDir = join(process.cwd(), 'public');
if (existsSync(publicDir)) {
  app.use(express.static(publicDir));
  app.get('*', (_, res) => res.sendFile(join(publicDir, 'index.html')));
} else {
  app.get('/', (_, res) => res.json({ ok: true, message: 'Poker server running' }));
}

httpServer.listen(port, () => {
  console.log(`Poker server listening on http://localhost:${port}`);
});
