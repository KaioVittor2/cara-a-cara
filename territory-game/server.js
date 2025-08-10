const express = require("express");
const { WebSocketServer } = require("ws");
const http = require("http");

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

app.use(express.static("public"));

const BOARD_SIZE = 10;
let board = Array.from({ length: BOARD_SIZE }, () => Array(BOARD_SIZE).fill(null));
let players = {};
let nextPlayerId = 1;

function broadcast(data) {
  const msg = JSON.stringify(data);
  wss.clients.forEach(c => {
    if (c.readyState === 1) c.send(msg);
  });
}

wss.on("connection", ws => {
  const playerId = "P" + nextPlayerId++;
  const color = playerId === "P1" ? "red" : "blue";
  players[playerId] = { color, ws };
  
  ws.send(JSON.stringify({ type: "init", playerId, color, board }));
  broadcast({ type: "players", players: Object.fromEntries(Object.entries(players).map(([id, p]) => [id, { color: p.color }])) });

  ws.on("message", msg => {
    const data = JSON.parse(msg);

    if (data.type === "click") {
      const { x, y } = data;
      board[y][x] = players[playerId].color;
      broadcast({ type: "board", board });
    }
  });

  ws.on("close", () => {
    delete players[playerId];
    broadcast({ type: "players", players: Object.fromEntries(Object.entries(players).map(([id, p]) => [id, { color: p.color }])) });
  });
});

server.listen(3000, () => console.log("Server running on port 3000"));
