import { io } from 'socket.io-client';
import fs from 'fs';

const URL = process.env.SOCKET_URL || 'http://localhost:3001';
const ROLE = 'project';
const LOG = process.env.SPY_LOG || '/tmp/wire-spy.log';

const stream = fs.createWriteStream(LOG, { flags: 'a' });
function out(line) {
  const stamped = `[${new Date().toISOString()}] ${line}`;
  console.log(stamped);
  stream.write(stamped + '\n');
}

out(`--- wire-spy starting; URL=${URL} role=${ROLE} log=${LOG} ---`);

const socket = io(URL, { reconnection: true, reconnectionDelay: 500 });

socket.on('connect', () => {
  out(`connected id=${socket.id}`);
  socket.emit('register', ROLE, (res) => {
    out(`registered ${JSON.stringify(res)}`);
  });
});

socket.on('message', ({ type, payload, from }) => {
  out(`${from} -> ${ROLE} ${type} ${JSON.stringify(payload ?? {})}`);
});

socket.on('disconnect', (reason) => out(`disconnected: ${reason}`));
socket.on('connect_error', (err) => out(`connect_error: ${err.message}`));
