const canvas = document.getElementById("board");
const ctx = canvas.getContext("2d");
const size = 10;
const cellSize = canvas.width / size;
let playerId, playerColor, board;

const ws = new WebSocket(`ws://${window.location.host}`);

ws.onmessage = msg => {
  const data = JSON.parse(msg.data);

  if (data.type === "init") {
    playerId = data.playerId;
    playerColor = data.color;
    board = data.board;
    document.getElementById("info").textContent = `Você é ${playerId} (${playerColor})`;
    drawBoard();
  }
  
  if (data.type === "board") {
    board = data.board;
    drawBoard();
  }

  if (data.type === "players") {
    console.log("Jogadores conectados:", data.players);
  }
};

canvas.addEventListener("click", e => {
  const rect = canvas.getBoundingClientRect();
  const x = Math.floor((e.clientX - rect.left) / cellSize);
  const y = Math.floor((e.clientY - rect.top) / cellSize);
  ws.send(JSON.stringify({ type: "click", x, y }));
});

function drawBoard() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      ctx.fillStyle = board[y][x] || "#ccc";
      ctx.fillRect(x * cellSize, y * cellSize, cellSize, cellSize);
      ctx.strokeStyle = "black";
      ctx.strokeRect(x * cellSize, y * cellSize, cellSize, cellSize);
    }
  }
}
