import React, { useState } from "react";
import PongMultiplayer from "./PongMultiplayer";

export default function App() {
  const [joined, setJoined] = useState(false);
  const [roomInfo, setRoomInfo] = useState(null);

  return (
    <div>
      {!joined ? (
        <div className="menu">
          <h1>Pong Multiplayer</h1>
          <p>First to 5 wins.</p>
          <button
            onClick={() => {
              setJoined(true);
            }}
            className="btn"
          >
            Join Match
          </button>
          <p className="small">Open in two windows to play 1 vs 2</p>
        </div>
      ) : (
        <PongMultiplayer onLeave={() => setJoined(false)} />
      )}
    </div>
  );
}
