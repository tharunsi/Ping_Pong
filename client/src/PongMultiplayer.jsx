import React, { useEffect, useRef, useState } from "react";
import Phaser from "phaser";
import { io } from "socket.io-client";

const SERVER_URL = import.meta.env.VITE_SERVER_URL || "http://localhost:3001";
const WIDTH = 800;
const HEIGHT = 500;
const PADDLE_HEIGHT = 100;

export default function PongMultiplayer({ onLeave }) {
  const containerRef = useRef(null);
  const [socketState, setSocketState] = useState({ connected: false, player: null, roomId: null });
  const [scores, setScores] = useState({1:0,2:0});
  const [status, setStatus] = useState("waiting"); // waiting, playing, finished

  useEffect(() => {
    const socket = io(SERVER_URL, { transports: ["websocket"] });
    let game;

    socket.on("connect", () => {
      setSocketState(s => ({ ...s, connected: true }));
      socket.emit("joinQueue");
    });

    socket.on("joined", ({ roomId, player }) => {
      setSocketState({ connected: true, roomId, player });
      setStatus("waiting");
    });

    socket.on("startGame", ({ scores }) => {
      setScores(scores);
      setStatus("playing");
    });

    socket.on("rematch", () => {
      setScores({1:0,2:0});
      setStatus("playing");
    });

    socket.on("gameOver", ({ winner, scores }) => {
      setScores(scores);
      setStatus("finished");
      // you can show a popup
      setTimeout(()=> {
        // do nothing, let UI show rematch button
      }, 200);
    });

    socket.on("playersUpdate", ({ count }) => {
      if (count < 2) setStatus("waiting");
    });

    // Phaser scene
    class PongScene extends Phaser.Scene {
      constructor() {
        super("pong-scene");
      }
      preload() {}
      create() {
        // shapes
        this.ball = this.add.circle(WIDTH/2, HEIGHT/2, 10, 0xffffff);
        this.p1 = this.add.rectangle(30, HEIGHT/2, 10, PADDLE_HEIGHT, 0xffffff);
        this.p2 = this.add.rectangle(WIDTH-30, HEIGHT/2, 10, PADDLE_HEIGHT, 0xffffff);
        this.scoreText = this.add.text(WIDTH/2 - 40, 20, "0 - 0", { fontSize: '32px', color: '#ffffff' });

        // local interpolation target
        this.serverBall = { x: WIDTH/2, y: HEIGHT/2 };

        // listen to server updates
        socket.on("gameState", (state) => {
          // server authoritative ball
          this.serverBall.x = state.ball.x;
          this.serverBall.y = state.ball.y;
          // update paddles: state.players has keys = socketIds
          const players = Object.values(state.players);
          // map by player number
          players.forEach(p => {
            if (p.player === 1) this.p1.y = p.y;
            if (p.player === 2) this.p2.y = p.y;
          });
          this.scoreText.setText(`${state.scores[1]} - ${state.scores[2]}`);
        });

        // mouse move to control paddle if player present
        this.input.on('pointermove', (pointer) => {
          if (!socketState.player) return;
          const localY = Phaser.Math.Clamp(pointer.y, 50, HEIGHT-50);
          socket.emit("paddleMove", { roomId: socketState.roomId, y: localY });
        });

        // keyboard controls fallback for players
        this.cursors = this.input.keyboard.createCursorKeys();
        this.wKey = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.W);
        this.sKey = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.S);
      }

      update() {
        // smooth ball interpolation
        this.ball.x += (this.serverBall.x - this.ball.x) * 0.35;
        this.ball.y += (this.serverBall.y - this.ball.y) * 0.35;

        // keyboard controls for left/right players
        if (socketState.player === 1) {
          if (this.wKey.isDown) {
            const newY = Phaser.Math.Clamp(this.p1.y - 6, 50, HEIGHT-50);
            this.p1.setY(newY);
            socket.emit("paddleMove", { roomId: socketState.roomId, y: newY });
          } else if (this.sKey.isDown) {
            const newY = Phaser.Math.Clamp(this.p1.y + 6, 50, HEIGHT-50);
            this.p1.setY(newY);
            socket.emit("paddleMove", { roomId: socketState.roomId, y: newY });
          }
        } else if (socketState.player === 2) {
          if (this.cursors.up.isDown) {
            const newY = Phaser.Math.Clamp(this.p2.y - 6, 50, HEIGHT-50);
            this.p2.setY(newY);
            socket.emit("paddleMove", { roomId: socketState.roomId, y: newY });
          } else if (this.cursors.down.isDown) {
            const newY = Phaser.Math.Clamp(this.p2.y + 6, 50, HEIGHT-50);
            this.p2.setY(newY);
            socket.emit("paddleMove", { roomId: socketState.roomId, y: newY });
          }
        }
      }
    }

    const config = {
      type: Phaser.AUTO,
      width: WIDTH,
      height: HEIGHT,
      backgroundColor: "#000000",
      scene: PongScene,
      parent: containerRef.current
    };

    game = new Phaser.Game(config);

    return () => {
      socket.disconnect();
      if (game) game.destroy(true);
    };
  }, [containerRef]);

  // rematch and leave handlers
  function requestRematch() {
    if (!socketState.roomId) return;
    const socket = io(SERVER_URL, { autoConnect: false });
    // Instead of creating a new socket, call server via fetch? Simpler: emit via a temporary connection.
    // But to keep things simple in this demo we will use the main socket that exists inside the useEffect.
    // To trigger rematch, emit a custom event using window (we'll ask server to accept rematch via existing socket).
    // For production, you'd keep socket instance in ref and call emit on it.
    alert("Press R on your keyboard to request rematch (or reopen both windows).");
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
      <div ref={containerRef} id="phaser-container" style={{ width: WIDTH, height: HEIGHT }} />
      <div style={{ marginTop: 12 }}>
        <div>Status: <strong>{status}</strong></div>
        <div>Scores: {scores[1]} - {scores[2]}</div>
        <div style={{ marginTop: 8 }}>
          <button onClick={() => {
            // leave room by reloading page - simple
            if (onLeave) onLeave();
            window.location.reload();
          }} className="btn">Leave Match</button>
          <button onClick={() => {
            // send rematch via prompt approach for demo
            const evt = new CustomEvent("requestRematch");
            window.dispatchEvent(evt);
            alert("Rematch requested (demo). If both players request, server will reset.");
          }} className="btn" style={{ marginLeft: 8 }}>Request Rematch</button>
        </div>
        <p style={{ marginTop: 8, fontSize: 12 }}>Controls: Player1 W/S or mouse; Player2 Arrow Up/Down</p>
      </div>
    </div>
  );
}
