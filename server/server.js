const express = require("express");
const http = require("http");
const cors = require("cors");
const { Server } = require("socket.io");

const app = express();
app.use(cors());
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*" },
  pingInterval: 10000,
  pingTimeout: 5000
});

// Game constants
const WIDTH = 800;
const HEIGHT = 500;
const PADDLE_HEIGHT = 100;
const PADDLE_SPEED = 6;
const BALL_SPEED = 5;
const WIN_SCORE = 5;
const TICK_RATE = 1000 / 60; // 60fps

// Rooms state
const rooms = {}; // roomId -> { players: { socketId: {player:1/2, y} }, ball, scores, status }

function createRoom(roomId) {
  rooms[roomId] = {
    players: {}, // socketId -> { player, y }
    ball: { x: WIDTH / 2, y: HEIGHT / 2, dx: BALL_SPEED * (Math.random() < 0.5 ? 1 : -1), dy: BALL_SPEED * (Math.random() < 0.5 ? 1 : -1) },
    scores: { 1: 0, 2: 0 },
    status: "waiting", // waiting, playing, finished
    lastUpdate: Date.now()
  };
}

// Simple helper to find room with only 1 player to join
function findAvailableRoom() {
  for (const id in rooms) {
    const r = rooms[id];
    if (Object.keys(r.players).length === 1 && r.status === "waiting") return id;
  }
  return null;
}

// Game loop per room
function tickRoom(roomId) {
  const r = rooms[roomId];
  if (!r || r.status !== "playing") return;

  const ball = r.ball;

  // Update ball position
  ball.x += ball.dx;
  ball.y += ball.dy;

  // Top/bottom bounce
  if (ball.y < 0) {
    ball.y = 0;
    ball.dy *= -1;
  } else if (ball.y > HEIGHT) {
    ball.y = HEIGHT;
    ball.dy *= -1;
  }

  // Determine paddles positions
  const players = Object.values(r.players); // array of {player, y, id}
  let p1 = null, p2 = null;
  for (const [sid, p] of Object.entries(r.players)) {
    if (p.player === 1) p1 = p;
    if (p.player === 2) p2 = p;
  }
  // If either missing, skip paddle collision
  if (p1) {
    const paddleX = 0 + 10; // left paddle x (approx)
    if (ball.x - 10 < paddleX + 10) {
      // check vertical overlap
      if (ball.y > p1.y - PADDLE_HEIGHT/2 && ball.y < p1.y + PADDLE_HEIGHT/2) {
        ball.x = paddleX + 10 + 10; // push out
        ball.dx = Math.abs(ball.dx) * 1.05; // speed up slightly
        // tweak dy based on where it hit the paddle
        const delta = (ball.y - p1.y) / (PADDLE_HEIGHT/2);
        ball.dy = BALL_SPEED * delta;
      }
    }
  }
  if (p2) {
    const paddleX = WIDTH - 10 - 10; // right paddle x
    if (ball.x + 10 > paddleX) {
      if (ball.y > p2.y - PADDLE_HEIGHT/2 && ball.y < p2.y + PADDLE_HEIGHT/2) {
        ball.x = paddleX - 10;
        ball.dx = -Math.abs(ball.dx) * 1.05;
        const delta = (ball.y - p2.y) / (PADDLE_HEIGHT/2);
        ball.dy = BALL_SPEED * delta;
      }
    }
  }

  // Score conditions
  if (ball.x < 0) {
    // player 2 scores
    r.scores[2]++;
    if (r.scores[2] >= WIN_SCORE) {
      r.status = "finished";
      io.to(roomId).emit("gameOver", { winner: 2, scores: r.scores });
      return;
    } else {
      resetBall(r, -1);
    }
  } else if (ball.x > WIDTH) {
    r.scores[1]++;
    if (r.scores[1] >= WIN_SCORE) {
      r.status = "finished";
      io.to(roomId).emit("gameOver", { winner: 1, scores: r.scores });
      return;
    } else {
      resetBall(r, 1);
    }
  }

  // Broadcast state
  io.to(roomId).emit("gameState", {
    ball: { x: Math.round(ball.x), y: Math.round(ball.y), dx: ball.dx, dy: ball.dy },
    players: Object.fromEntries(Object.entries(r.players).map(([sid, p]) => [sid, { player: p.player, y: Math.round(p.y) }])),
    scores: r.scores
  });
}

function resetBall(room, direction = (Math.random() < 0.5 ? -1 : 1)) {
  room.ball.x = WIDTH / 2;
  room.ball.y = HEIGHT / 2;
  room.ball.dx = BALL_SPEED * direction;
  room.ball.dy = BALL_SPEED * (Math.random() < 0.5 ? -1 : 1);
}

// Start game loop timer for a room
function startRoomLoop(roomId) {
  if (!rooms[roomId]) return;
  if (rooms[roomId].loopHandle) return;
  rooms[roomId].loopHandle = setInterval(() => tickRoom(roomId), TICK_RATE);
}

// Stop and cleanup room loop
function stopRoomLoop(roomId) {
  if (rooms[roomId] && rooms[roomId].loopHandle) {
    clearInterval(rooms[roomId].loopHandle);
    delete rooms[roomId].loopHandle;
  }
}

io.on("connection", (socket) => {
  console.log("connect", socket.id);

  // When a client requests to join a match
  socket.on("joinQueue", () => {
    // check if this socket already in a room
    let myRoom = Object.keys(rooms).find(rid => rooms[rid].players[socket.id]);
    if (myRoom) {
      socket.emit("joined", { roomId: myRoom, player: rooms[myRoom].players[socket.id].player });
      return;
    }

    let roomId = findAvailableRoom();
    if (!roomId) {
      // create a new room with random id
      roomId = `room-${Math.random().toString(36).slice(2,9)}`;
      createRoom(roomId);
    }
    const room = rooms[roomId];

    // assign player number
    const assigned = Object.values(room.players).some(p => p.player === 1) ? 2 : 1;
    room.players[socket.id] = { player: assigned, y: HEIGHT/2 };

    socket.join(roomId);
    socket.emit("joined", { roomId, player: assigned });
    io.to(roomId).emit("playersUpdate", { count: Object.keys(room.players).length });

    // if two players present -> start game
    if (Object.keys(room.players).length === 2) {
      room.status = "playing";
      room.scores = {1:0,2:0};
      resetBall(room);
      io.to(roomId).emit("startGame", { scores: room.scores });
      startRoomLoop(roomId);
    }
  });

  socket.on("paddleMove", (data) => {
    // data: { roomId, y }
    const { roomId, y } = data || {};
    const room = rooms[roomId];
    if (!room || !room.players[socket.id]) return;
    room.players[socket.id].y = Math.max(50, Math.min(HEIGHT - 50, y)); // clamp
  });

  socket.on("requestRematch", ({ roomId }) => {
    const room = rooms[roomId];
    if (!room) return;
    room.scores = {1:0,2:0};
    room.status = "playing";
    resetBall(room);
    io.to(roomId).emit("rematch");
    startRoomLoop(roomId);
  });

  socket.on("leaveRoom", ({ roomId }) => {
    if (rooms[roomId] && rooms[roomId].players[socket.id]) {
      delete rooms[roomId].players[socket.id];
      socket.leave(roomId);
      io.to(roomId).emit("playersUpdate", { count: Object.keys(rooms[roomId].players).length });
      // stop loop if no players
      if (Object.keys(rooms[roomId].players).length === 0) {
        stopRoomLoop(roomId);
        delete rooms[roomId];
      } else {
        // mark waiting if only one left
        rooms[roomId].status = "waiting";
      }
    }
  });

  socket.on("disconnect", () => {
    console.log("disconnect", socket.id);
    // remove from any room
    for (const roomId in rooms) {
      if (rooms[roomId].players[socket.id]) {
        delete rooms[roomId].players[socket.id];
        io.to(roomId).emit("playersUpdate", { count: Object.keys(rooms[roomId].players).length });
        rooms[roomId].status = "waiting";
        // if empty cleanup
        if (Object.keys(rooms[roomId].players).length === 0) {
          stopRoomLoop(roomId);
          delete rooms[roomId];
        }
      }
    }
  });
});

app.get("/", (req, res) => res.send("Pong server running"));

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => console.log(`Server listening on ${PORT}`));
