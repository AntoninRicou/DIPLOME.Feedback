import { io } from 'socket.io-client';

const SERVER_URL = import.meta.env.VITE_SOCKET_URL || 'http://localhost:3001';
const ROLE = 'project';

let socket = null;
const listeners = new Map();

export function connect() {
  if (socket) return socket;

  socket = io(SERVER_URL, {
    autoConnect: true,
    reconnection: true,
    reconnectionDelay: 500,
  });

  socket.on('connect', () => {
    socket.emit('register', ROLE, (res) => {
      console.log('[api] registered', res);
    });
  });

  socket.on('message', ({ type, payload, from }) => {
    const cbs = listeners.get(type);
    if (cbs) cbs.forEach((cb) => cb(payload, from));
  });

  socket.on('connect_error', (err) => console.warn('[api] connect_error', err.message));
  socket.on('disconnect', (reason) => console.log('[api] disconnected', reason));

  return socket;
}

export function on(type, callback) {
  if (!listeners.has(type)) listeners.set(type, new Set());
  listeners.get(type).add(callback);
  return () => listeners.get(type)?.delete(callback);
}

export function send(type, payload) {
  if (!socket || !socket.connected) {
    console.warn('[api] not connected; dropping', type);
    return false;
  }
  socket.emit('message', { type, payload });
  return true;
}

export function isConnected() {
  return Boolean(socket && socket.connected);
}

export function disconnect() {
  if (!socket) return;
  socket.disconnect();
  socket = null;
}
