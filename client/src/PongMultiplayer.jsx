import React, { useEffect, useRef, useState } from "react";
import { io } from "socket.io-client";
import "./PongGame.css";

/*
  PongGame.jsx
  - Single-file React component for Pong
  - No external image files required (SVG data-urls are embedded)
  - Multiplayer connects to SERVER_URL (default localhost:3001)
*/

const SERVER_URL = import.meta.env.VITE_SERVER_URL || "http://localhost:3001";
const WIDTH = 900; // canvas logical size
const HEIGHT = 520;
const PADDLE_WIDTH = 20;
const PADDLE_HEIGHT = 120;
const BALL_RADIUS = 10;
const WIN_SCORE = 5;

export default function PongMultiplayer({ onLeave }) {
  const canvasRef = useRef(null);
  const socketRef = useRef(null);
  const animationRef = useRef(null);

  const [mode, setMode] = useState("menu"); // menu | single | multi
  const [status, setStatus] = useState("idle"); // idle | waiting | playing | finished
  const [playerNumber, setPlayerNumber] = useState(null); // 1 or 2 in multiplayer
  const [roomId, setRoomId] = useState(null);
  const [scores, setScores] = useState({ 1: 0, 2: 0 });
  const [connected, setConnected] = useState(false);

  // Game state (authoritative for single-mode, mirrored from server for multi-mode)
  const stateRef = useRef({
    ball: { x: WIDTH / 2, y: HEIGHT / 2, dx: 5, dy: 3 },
    players: {
      left: { y: HEIGHT / 2, id: null, player: 1 },
      right: { y: HEIGHT / 2, id: null, player: 2 },
    },
    scores: { 1: 0, 2: 0 }
  });

  // embedded small SVG sprites (data URLs) — no external files needed
  const ASSETS = {
    bg: `data:image/svg+xml;utf8,${encodeURIComponent(`
      <svg xmlns='http://www.w3.org/2000/svg' width='900' height='520'>
        <defs>
          <linearGradient id='g' x1='0' x2='0' y1='0' y2='1'>
            <stop offset='0%' stop-color='#071027'/><stop offset='100%' stop-color='#001220'/>
          </linearGradient>
        </defs>
        <rect width='100%' height='100%' fill='url(#g)' />
        <g fill='none' stroke='#0ff' stroke-opacity='0.07'>
          <rect x='40' y='40' width='820' height='440' rx='12' />
        </g>
      </svg>`)}`,
    paddle: `data:image/svg+xml;utf8,${encodeURIComponent(`
      <svg xmlns='http://www.w3.org/2000/svg' width='32' height='160'>
        <defs>
          <linearGradient id='p' x1='0' x2='1'>
            <stop offset='0' stop-color='#00ffea'/><stop offset='1' stop-color='#0066ff'/>
          </linearGradient>
        </defs>
        <rect x='2' y='2' rx='8' ry='8' width='28' height='156' fill='url(#p)' stroke='#00ffea' stroke-opacity='0.35' />
        <rect x='6' y='24' width='20' height='112' rx='6' fill='#052' fill-opacity='0.1' />
      </svg>`)}`,
    ball: `data:image/svg+xml;utf8,${encodeURIComponent(`
      <svg xmlns='http://www.w3.org/2000/svg' width='40' height='40'>
        <defs>
          <radialGradient id='b' cx='30%' cy='30%'>
            <stop offset='0%' stop-color='#ffffff' stop-opacity='1'/>
            <stop offset='100%' stop-color='#00aaff' stop-opacity='0.8'/>
          </radialGradient>
        </defs>
        <circle cx='20' cy='20' r='14' fill='url(#b)' />
        <circle cx='14' cy='14' r='4' fill='#fff' opacity='0.9'/>
      </svg>`)}`,
  };

  // --- Utility: init socket for multiplayer ---
  function initSocket() {
    if (socketRef.current) return socketRef.current;
    const sock = io(SERVER_URL, { transports: ["websocket"] });
    socketRef.current = sock;

    sock.on("connect", () => {
      setConnected(true);
    });

    sock.on("joined", ({ roomId, player }) => {
      setRoomId(roomId);
      setPlayerNumber(player);
      setStatus("waiting");
      // server will emit startGame when ready
    });

    sock.on("startGame", ({ scores }) => {
      setScores(scores);
      setStatus("playing");
    });

    sock.on("rematch", () => {
      setScores({1:0,2:0});
      setStatus("playing");
      // server will start sending gameState again
    });

    sock.on("gameOver", ({ winner, scores }) => {
      setScores(scores);
      setStatus("finished");
    });

    sock.on("playersUpdate", ({ count }) => {
      if (count < 2) setStatus("waiting");
    });

    sock.on("gameState", (serverState) => {
      // server sends { ball:{x,y,...}, players: { socketId: {player, y}, ... }, scores }
      // map to our rendering state
      const players = Object.values(serverState.players);
      // update left/right based on player id numbers
      players.forEach(p => {
        if (p.player === 1) stateRef.current.players.left.y = p.y;
        if (p.player === 2) stateRef.current.players.right.y = p.y;
      });
      stateRef.current.ball.x = serverState.ball.x;
      stateRef.current.ball.y = serverState.ball.y;
      stateRef.current.scores = serverState.scores;
      setScores(serverState.scores);
      // draw will pick it up on next animation frame
    });

    return sock;
  }

  // --- Join queue (multiplayer) ---
  const joinQueue = () => {
    const sock = initSocket();
    sock.emit("joinQueue");
    setMode("multi");
    setStatus("waiting");
  };

  // --- Leave room / stop multiplayer ---
  const leaveMultiplayer = () => {
    if (socketRef.current && roomId) {
      socketRef.current.emit("leaveRoom", { roomId });
    }
    setMode("menu");
    setStatus("idle");
    setPlayerNumber(null);
    setRoomId(null);
    setScores({ 1: 0, 2: 0 });
    // keep socket connected for future; you can also disconnect if desired
  };

  // --- Request rematch ---
  const requestRematch = () => {
    if (socketRef.current && roomId) {
      socketRef.current.emit("requestRematch", { roomId });
    }
  };

  // --- Paddle move emit for multiplayer ---
  function emitPaddleMove(y) {
    if (socketRef.current && roomId) {
      socketRef.current.emit("paddleMove", { roomId, y });
    }
  }

  // --- Single-player local physics loop ---
  useEffect(() => {
    if (mode !== "single") return;
    // initialize single state
    stateRef.current.ball = { x: WIDTH/2, y: HEIGHT/2, dx: 5 * (Math.random() < 0.5 ? 1 : -1), dy: 3 * (Math.random() < 0.5 ? 1 : -1) };
    stateRef.current.players.left.y = HEIGHT/2;
    stateRef.current.players.right.y = HEIGHT/2;
    stateRef.current.scores = {1:0,2:0};
    setScores({1:0,2:0});
    setStatus("playing");
  }, [mode]);

  // --- Main render loop for canvas (both modes) ---
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d", { alpha: false });

    // HiDPI scale
    const dpr = window.devicePixelRatio || 1;
    canvas.width = WIDTH * dpr;
    canvas.height = HEIGHT * dpr;
    canvas.style.width = "100%";
    canvas.style.maxWidth = "920px";
    canvas.style.height = `${(HEIGHT / WIDTH) * 100}vw`;
    ctx.scale(dpr, dpr);

    // Preload image objects
    const bgImg = new Image(); bgImg.src = ASSETS.bg;
    const paddleImg = new Image(); paddleImg.src = ASSETS.paddle;
    const ballImg = new Image(); ballImg.src = ASSETS.ball;

    // keep track of user touch/mouse pointer for single-mode local paddles and multi-mode local paddle
    let pointerState = { active: false, x: 0, y: 0 };

    // event handlers for touch/mouse
    function onPointerMove(e) {
      e.preventDefault();
      let clientX, clientY;
      if (e.touches && e.touches.length) {
        clientX = e.touches[0].clientX;
        clientY = e.touches[0].clientY;
      } else {
        clientX = e.clientX;
        clientY = e.clientY;
      }
      const rect = canvas.getBoundingClientRect();
      const x = (clientX - rect.left) * (canvas.width / rect.width) / (window.devicePixelRatio || 1);
      const y = (clientY - rect.top) * (canvas.height / rect.height) / (window.devicePixelRatio || 1);
      pointerState = { active: true, x, y };

      // Mode-specific handling:
      if (mode === "single") {
        // split screen: left half controls left paddle, right half controls right paddle
        if (x < WIDTH / 2) {
          stateRef.current.players.left.y = clamp(y, PADDLE_HEIGHT/2, HEIGHT - PADDLE_HEIGHT/2);
        } else {
          stateRef.current.players.right.y = clamp(y, PADDLE_HEIGHT/2, HEIGHT - PADDLE_HEIGHT/2);
        }
      } else if (mode === "multi" && playerNumber) {
        // in multiplayer each client controls its own paddle only and emits to server
        const localY = clamp(y, PADDLE_HEIGHT/2, HEIGHT - PADDLE_HEIGHT/2);
        if (playerNumber === 1) stateRef.current.players.left.y = localY;
        else stateRef.current.players.right.y = localY;

        emitPaddleMove(localY);
      }
    }

    function onPointerEnd(e) {
      pointerState.active = false;
    }

    canvas.addEventListener("mousemove", onPointerMove, { passive: false });
    canvas.addEventListener("touchmove", onPointerMove, { passive: false });
    canvas.addEventListener("touchstart", onPointerMove, { passive: false });
    window.addEventListener("mouseup", onPointerEnd);
    window.addEventListener("touchend", onPointerEnd);

    // keyboard controls fallback
    const keys = {};
    function onKeyDown(e) {
      keys[e.key.toLowerCase()] = true;
    }
    function onKeyUp(e) {
      keys[e.key.toLowerCase()] = false;
    }
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);

    // core animation + physics tick (client-side for single-mode; rendering-only for multiplayer)
    function tick() {
      // single mode do local physics & scoring
      if (mode === "single" && status === "playing") {
        const ball = stateRef.current.ball;
        // keyboard support for two players
        if (keys["w"]) stateRef.current.players.left.y -= 8;
        if (keys["s"]) stateRef.current.players.left.y += 8;
        if (keys["arrowup"]) stateRef.current.players.right.y -= 8;
        if (keys["arrowdown"]) stateRef.current.players.right.y += 8;
        // clamp paddles
        stateRef.current.players.left.y = clamp(stateRef.current.players.left.y, PADDLE_HEIGHT/2, HEIGHT - PADDLE_HEIGHT/2);
        stateRef.current.players.right.y = clamp(stateRef.current.players.right.y, PADDLE_HEIGHT/2, HEIGHT - PADDLE_HEIGHT/2);

        // update ball
        ball.x += ball.dx;
        ball.y += ball.dy;

        // bounce top/bottom
        if (ball.y - BALL_RADIUS <= 0) {
          ball.y = BALL_RADIUS; ball.dy *= -1;
        } else if (ball.y + BALL_RADIUS >= HEIGHT) {
          ball.y = HEIGHT - BALL_RADIUS; ball.dy *= -1;
        }

        // paddle collisions (simple AABB vs circle check)
        // left paddle
        const lp = { x: 20, y: stateRef.current.players.left.y, w: PADDLE_WIDTH, h: PADDLE_HEIGHT };
        if (circleRectCollide(ball.x, ball.y, BALL_RADIUS, lp.x, lp.y - lp.h/2, lp.w, lp.h)) {
          ball.x = lp.x + lp.w + BALL_RADIUS;
          ball.dx = Math.abs(ball.dx) + 0.3;
          // tweak dy with hit position
          const rel = (ball.y - lp.y) / (lp.h/2);
          ball.dy = 5 * rel;
        }
        // right paddle
        const rp = { x: WIDTH - 20 - PADDLE_WIDTH, y: stateRef.current.players.right.y, w: PADDLE_WIDTH, h: PADDLE_HEIGHT };
        if (circleRectCollide(ball.x, ball.y, BALL_RADIUS, rp.x, rp.y - rp.h/2, rp.w, rp.h)) {
          ball.x = rp.x - BALL_RADIUS;
          ball.dx = -Math.abs(ball.dx) - 0.3;
          const rel = (ball.y - rp.y) / (rp.h/2);
          ball.dy = 5 * rel;
        }

        // scoring
        if (ball.x < -50) {
          stateRef.current.scores[2] += 1;
          setScores({ ...stateRef.current.scores });
          resetBallLocal(stateRef.current, 1);
        } else if (ball.x > WIDTH + 50) {
          stateRef.current.scores[1] += 1;
          setScores({ ...stateRef.current.scores });
          resetBallLocal(stateRef.current, -1);
        }

        // win check
        if (stateRef.current.scores[1] >= WIN_SCORE || stateRef.current.scores[2] >= WIN_SCORE) {
          setStatus("finished");
        }
      }

      // for multi mode we rely on server state; stateRef.current updated by socket events
      render(ctx, bgImg, paddleImg, ballImg);

      animationRef.current = requestAnimationFrame(tick);
    }

    animationRef.current = requestAnimationFrame(tick);

    // cleanup
    return () => {
      cancelAnimationFrame(animationRef.current);
      canvas.removeEventListener("mousemove", onPointerMove);
      canvas.removeEventListener("touchmove", onPointerMove);
      canvas.removeEventListener("touchstart", onPointerMove);
      window.removeEventListener("mouseup", onPointerEnd);
      window.removeEventListener("touchend", onPointerEnd);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, [mode, status, playerNumber, roomId]); // reattach when mode changes

  // helper: render current state
  function render(ctx, bgImg, paddleImg, ballImg) {
    // background
    if (bgImg && bgImg.complete) ctx.drawImage(bgImg, 0, 0, WIDTH, HEIGHT);
    else {
      ctx.fillStyle = "#001218";
      ctx.fillRect(0, 0, WIDTH, HEIGHT);
    }

    // center net
    ctx.strokeStyle = "rgba(255,255,255,0.06)";
    ctx.lineWidth = 2;
    for (let y = 30; y < HEIGHT - 30; y += 24) {
      ctx.beginPath();
      ctx.moveTo(WIDTH / 2 - 2, y);
      ctx.lineTo(WIDTH / 2 + 2, y + 12);
      ctx.stroke();
    }

    // paddles (use image)
    const left = stateRef.current.players.left;
    const right = stateRef.current.players.right;
    if (paddleImg && paddleImg.complete) {
      // left
      ctx.drawImage(paddleImg, 0, 0, 32, 160,
        10, left.y - PADDLE_HEIGHT / 2, PADDLE_WIDTH, PADDLE_HEIGHT);
      // right
      ctx.save();
      ctx.translate(WIDTH - 10 - PADDLE_WIDTH, 0);
      ctx.drawImage(paddleImg, 0, 0, 32, 160,
        0, right.y - PADDLE_HEIGHT / 2, PADDLE_WIDTH, PADDLE_HEIGHT);
      ctx.restore();
    } else {
      ctx.fillStyle = "#00ffea";
      ctx.fillRect(10, left.y - PADDLE_HEIGHT / 2, PADDLE_WIDTH, PADDLE_HEIGHT);
      ctx.fillStyle = "#ff6b6b";
      ctx.fillRect(WIDTH - 10 - PADDLE_WIDTH, right.y - PADDLE_HEIGHT / 2, PADDLE_WIDTH, PADDLE_HEIGHT);
    }

    // ball
    if (ballImg && ballImg.complete) {
      ctx.drawImage(ballImg, stateRef.current.ball.x - 14, stateRef.current.ball.y - 14, 28, 28);
    } else {
      ctx.fillStyle = "#fff";
      ctx.beginPath();
      ctx.arc(stateRef.current.ball.x, stateRef.current.ball.y, BALL_RADIUS, 0, Math.PI * 2);
      ctx.fill();
    }

    // scores UI
    ctx.fillStyle = "rgba(255,255,255,0.95)";
    ctx.font = "28px Inter, Arial";
    ctx.textAlign = "center";
    ctx.fillText(stateRef.current.scores[1] ?? 0, WIDTH / 2 - 60, 44);
    ctx.fillText(stateRef.current.scores[2] ?? 0, WIDTH / 2 + 60, 44);

    // small label for mode and player
    ctx.font = "13px Inter, Arial";
    ctx.fillStyle = "rgba(255,255,255,0.6)";
    if (mode === "multi") {
      ctx.fillText(playerNumber ? `You: P${playerNumber}` : "You: waiting", WIDTH - 90, HEIGHT - 14);
    } else {
      ctx.fillText("Local single-device match", WIDTH - 160, HEIGHT - 14);
    }
  }

  // small helpers
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }

  function circleRectCollide(cx, cy, r, rx, ry, rw, rh) {
    // rx,ry is rect top-left
    const closestX = clamp(cx, rx, rx + rw);
    const closestY = clamp(cy, ry, ry + rh);
    const dx = cx - closestX;
    const dy = cy - closestY;
    return (dx * dx + dy * dy) <= (r * r);
  }

  function resetBallLocal(state, direction = 1) {
    state.ball.x = WIDTH / 2;
    state.ball.y = HEIGHT / 2;
    state.ball.dx = 5 * direction;
    state.ball.dy = 3 * (Math.random() < 0.5 ? 1 : -1);
  }

  // --- UI Handlers ---
  function startSingle() {
    setMode("single");
    setStatus("playing");
    // reset local state
    stateRef.current.players.left.y = HEIGHT / 2;
    stateRef.current.players.right.y = HEIGHT / 2;
    stateRef.current.scores = {1:0,2:0};
    setScores({1:0,2:0});
    resetBallLocal(stateRef.current, Math.random() < 0.5 ? 1 : -1);
  }

  function startMulti() {
    // initialize socket and join queue
    initSocket();
    joinQueue();
  }

  // Leave everything and return to menu
  function goMenu() {
    // if multiplayer, notify server
    if (socketRef.current && roomId) {
      socketRef.current.emit("leaveRoom", { roomId });
    }
    // optionally disconnect socket completely if you want:
    // if (socketRef.current) { socketRef.current.disconnect(); socketRef.current = null; setConnected(false); }
    setMode("menu");
    setStatus("idle");
    setPlayerNumber(null);
    setRoomId(null);
    stateRef.current.scores = {1:0,2:0};
    setScores({1:0,2:0});
  }

  // Render React UI
  return (
    <div className="pong-shell">
      <div className="header">
        <h2 className="brand">REAL PONG</h2>
        <div className="controls-row">
          {mode !== "menu" && <button className="small-btn" onClick={goMenu}>Menu</button>}
          {mode === "multi" && status === "finished" && <button className="small-btn" onClick={requestRematch}>Rematch</button>}
          {mode === "multi" && <button className="small-btn" onClick={leaveMultiplayer}>Leave</button>}
        </div>
      </div>

      <div className="game-area">
        {mode === "menu" && (
          <div className="menu">
            <button className="big-btn" onClick={startSingle}>Play on this device (2 players)</button>
            <button className="big-btn outline" onClick={startMulti}>Play online (multiplayer)</button>
            <p className="hint">Touch to drag paddle • W/S and ↑/↓ work on keyboard</p>
          </div>
        )}

        {(mode === "single" || mode === "multi") && (
          <div className="canvas-wrap">
            <canvas ref={canvasRef} width={WIDTH} height={HEIGHT} className="pong-canvas" />
            <div className="meta">
              <div>Mode: <strong>{mode === "single" ? "Local (same device)" : "Multiplayer"}</strong></div>
              <div>Status: <strong>{status}</strong></div>
              <div>Score: <strong>{scores[1] ?? 0} — {scores[2] ?? 0}</strong></div>
            </div>
          </div>
        )}

        {mode === "multi" && status === "waiting" && (
          <div className="waiting">Connected. Waiting for another player to join...</div>
        )}

        {mode === "multi" && status === "finished" && (
          <div className="overlay">
            <div className="overlay-box">
              <h3>Game Over</h3>
              <p>Final score: {scores[1]} — {scores[2]}</p>
              <button className="big-btn" onClick={requestRematch}>Request Rematch</button>
              <button className="big-btn outline" onClick={leaveMultiplayer}>Leave</button>
            </div>
          </div>
        )}

        {mode === "single" && status === "finished" && (
          <div className="overlay">
            <div className="overlay-box">
              <h3>Game Over</h3>
              <p>Final score: {stateRef.current.scores[1]} — {stateRef.current.scores[2]}</p>
              <button className="big-btn" onClick={startSingle}>Play Again</button>
              <button className="big-btn outline" onClick={goMenu}>Menu</button>
            </div>
          </div>
        )}
      </div>

      <div className="footer">
        <small>Backend: {SERVER_URL} • Built for mobile & desktop</small>
      </div>
    </div>
  );
}
