// server.js
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const port = process.env.PORT || 3000;
const server = http.createServer(app);
const io = new Server(server);

// serve static client
app.use(express.static('public'));

// --- Game state & constants
const TICK = 1000/60; // 60Hz
const WIN_SCORE = 10;
const PADDLE_HEIGHT = 110;
const CANVAS_W = 900;
const CANVAS_H = 520;

function emptyRoomState() {
  return {
    players: {}, // socketId -> { side:'A'|'B', y:... }
    order: [], // socketId order joined
    ball: { x: CANVAS_W/2, y: CANVAS_H/2, vx: 0, vy: 0, speed: 360, r:9 },
    scoreA: 0,
    scoreB: 0,
    servingSide: 'A',
    running: false
  };
}

// We'll keep a single room "main" for simplicity. Can expand later.
const rooms = { main: emptyRoomState() };

// helper: spawn ball served from side
function serveBall(roomState) {
  const angle = (Math.random()*0.6 - 0.3); // -0.3..0.3 radians
  const dir = roomState.servingSide === 'A' ? 1 : -1;
  const speed = roomState.ball.speed;
  roomState.ball.vx = dir * speed * Math.cos(angle);
  roomState.ball.vy = speed * Math.sin(angle);
  roomState.ball.x = CANVAS_W/2;
  roomState.ball.y = CANVAS_H/2;
}

// physics loop per room
setInterval(() => {
  for (const [roomName, room] of Object.entries(rooms)) {
    if (!room.running) continue;

    const dt = TICK/1000;
    const b = room.ball;

    // move ball
    b.x += b.vx * dt;
    b.y += b.vy * dt;

    // top/bottom bounce
    if (b.y - b.r <= 4) { b.y = b.r + 4; b.vy *= -1; }
    if (b.y + b.r >= CANVAS_H - 4) { b.y = CANVAS_H - b.r - 4; b.vy *= -1; }

    // find paddles (by side)
    const players = room.players;
    const leftPlayer = Object.values(players).find(p => p.side === 'A');
    const rightPlayer = Object.values(players).find(p => p.side === 'B');

    // paddle Xs (same as client)
    const leftX = 30 + 0; // paddle width offset
    const rightX = CANVAS_W - 30 - 14;

    // collisions with paddles
    if (leftPlayer) {
      const px = leftX + 14;
      if (b.x - b.r <= px) {
        if (b.y >= leftPlayer.y && b.y <= leftPlayer.y + PADDLE_HEIGHT) {
          // reflect
          const relative = (b.y - (leftPlayer.y + PADDLE_HEIGHT/2)) / (PADDLE_HEIGHT/2);
          const bounce = relative * (Math.PI/3);
          const speed = Math.hypot(b.vx, b.vy) * 1.04;
          b.vx = 1 * speed * Math.cos(bounce);
          b.vy = speed * Math.sin(bounce);
          b.x = px + b.r + 0.5;
        } else if (b.x < leftX - 30) {
          // missed -> point for right
          room.scoreB++;
          room.servingSide = 'A';
          room.running = room.scoreA < WIN_SCORE && room.scoreB < WIN_SCORE;
          b.x = CANVAS_W/2; b.y = CANVAS_H/2; b.vx = 0; b.vy = 0;
          if (room.running) serveBall(room);
        }
      }
    } else {
      // if no left player, allow ball to pass -> score
      if (b.x - b.r <= 0) {
        room.scoreB++;
        room.servingSide = 'A';
        room.running = room.scoreA < WIN_SCORE && room.scoreB < WIN_SCORE;
        b.x = CANVAS_W/2; b.y = CANVAS_H/2; b.vx = 0; b.vy = 0;
        if (room.running) serveBall(room);
      }
    }

    if (rightPlayer) {
      const px = rightX;
      if (b.x + b.r >= px) {
        if (b.y >= rightPlayer.y && b.y <= rightPlayer.y + PADDLE_HEIGHT) {
          const relative = (b.y - (rightPlayer.y + PADDLE_HEIGHT/2)) / (PADDLE_HEIGHT/2);
          const bounce = relative * (Math.PI/3);
          const speed = Math.hypot(b.vx, b.vy) * 1.04;
          b.vx = -1 * speed * Math.cos(bounce);
          b.vy = speed * Math.sin(bounce);
          b.x = px - b.r - 0.5;
        } else if (b.x > px + 40) {
          // missed -> point for left
          room.scoreA++;
          room.servingSide = 'B';
          room.running = room.scoreA < WIN_SCORE && room.scoreB < WIN_SCORE;
          b.x = CANVAS_W/2; b.y = CANVAS_H/2; b.vx = 0; b.vy = 0;
          if (room.running) serveBall(room);
        }
      }
    } else {
      if (b.x + b.r >= CANVAS_W) {
        room.scoreA++;
        room.servingSide = 'B';
        room.running = room.scoreA < WIN_SCORE && room.scoreB < WIN_SCORE;
        b.x = CANVAS_W/2; b.y = CANVAS_H/2; b.vx = 0; b.vy = 0;
        if (room.running) serveBall(room);
      }
    }

    // win check
    if (room.scoreA >= WIN_SCORE || room.scoreB >= WIN_SCORE) {
      room.running = false;
    }

    // broadcast state to room
    io.to(roomName).emit('state', {
      ball: { x: b.x, y: b.y, r: b.r },
      scoreA: room.scoreA, scoreB: room.scoreB,
      players: Object.entries(room.players).map(([id,p])=>({ id, side: p.side, y: p.y })),
      running: room.running,
      servingSide: room.servingSide
    });
  }
}, TICK);

// --- Socket.IO handlers
io.on('connection', socket => {
  console.log('socket connected:', socket.id);
  const roomName = 'main';
  const room = rooms[roomName];

  // join socket to room
  socket.join(roomName);

  // assign side
  if (room.order.length < 2) {
    room.order.push(socket.id);
    const side = room.order.length === 1 ? 'A' : 'B';
    room.players[socket.id] = { side, y: CANVAS_H/2 - PADDLE_HEIGHT/2 };
    socket.emit('assigned', { side });
    pushLog(roomName, `Player ${side} joined (${socket.id})`);
  } else {
    // spectator mode: allow joining, but not control
    room.players[socket.id] = { side: 'S', y: CANVAS_H/2 - PADDLE_HEIGHT/2 };
    socket.emit('assigned', { side: 'S' });
    pushLog(roomName, `Spectator joined (${socket.id})`);
  }

  // if 2 players present and not running, start
  const activePlayers = Object.values(room.players).filter(p => p.side === 'A' || p.side === 'B');
  if (activePlayers.length === 2 && !room.running) {
    room.running = true;
    serveBall(room);
    io.to(roomName).emit('gameStart', { servingSide: room.servingSide });
    pushLog(roomName, 'Game started');
  }

  socket.on('paddle', data => {
    // data: { y: normalizedY } or pixel y - we accept pixel y
    const p = room.players[socket.id];
    if (!p) return;
    if (p.side === 'S') return; // spectator no control
    // clamp
    const newY = Math.max(6, Math.min(CANVAS_H - PADDLE_HEIGHT - 6, data.y));
    p.y = newY;
  });

  socket.on('serve', () => {
    if (room.running) return;
    if (room.servingSide) {
      serveBall(room);
      room.running = true;
      io.to(roomName).emit('gameStart', { servingSide: room.servingSide });
    }
  });

  socket.on('requestState', () => {
    // immediate state push
    const b = room.ball;
    socket.emit('state', {
      ball: { x: b.x, y: b.y, r: b.r },
      scoreA: room.scoreA, scoreB: room.scoreB,
      players: Object.entries(room.players).map(([id,p])=>({ id, side: p.side, y: p.y })),
      running: room.running,
      servingSide: room.servingSide
    });
  });

  socket.on('disconnect', () => {
    console.log('disconnect', socket.id);
    // remove player
    const wasIndex = room.order.indexOf(socket.id);
    if (wasIndex !== -1) room.order.splice(wasIndex,1);
    delete room.players[socket.id];

    // if a player left, stop game
    room.running = false;
    room.ball.x = CANVAS_W/2; room.ball.y = CANVAS_H/2; room.ball.vx = 0; room.ball.vy = 0;
    io.to(roomName).emit('playerLeft', { id: socket.id });
    pushLog(roomName, `Player disconnected (${socket.id})`);
  });
});

function pushLog(roomName, text) {
  console.log(`[room:${roomName}] ${text}`);
}

server.listen(port, () => console.log('listening on', port));
