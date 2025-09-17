import { useState } from "react";
import { CloudLightning, CloudOff, MessageSquare } from "react-feather";
import Button from "./Button";

function SessionStopped({ startSession }) {
  const [isActivating, setIsActivating] = useState(false);

  function handleStartSession() {
    if (isActivating) return;

    setIsActivating(true);
    startSession();
  }

  return (
    <div className="flex items-center justify-center w-full h-full">
      <Button
        onClick={handleStartSession}
        className={isActivating ? "btn-muted" : "btn-neon"}
        icon={<CloudLightning height={16} />}
      >
        {isActivating ? "starting session..." : "start session"}
      </Button>
    </div>
  );
}

function SessionActive({ stopSession, sendTextMessage }) {
  const [message, setMessage] = useState("");

  function handleSendClientEvent() {
    sendTextMessage(message);
    setMessage("");
  }

  return (
    <div className="flex items-center justify-center w-full h-full gap-3">
      <input
        onKeyDown={(e) => {
          if (e.key === "Enter" && message.trim()) {
            handleSendClientEvent();
          }
        }}
        type="text"
        placeholder="Ask the duck anything about your code…"
        className="rounded-full p-4 flex-1 glass-panel border border-white/10 focus:outline-none focus:ring-2 focus:ring-emerald-400/40"
        value={message}
        onChange={(e) => setMessage(e.target.value)}
      />
      <Button
        onClick={() => {
          if (message.trim()) {
            handleSendClientEvent();
          }
        }}
        icon={<MessageSquare height={16} />}
        className="btn-neon"
      >
        send text
      </Button>
      <Button onClick={stopSession} icon={<CloudOff height={16} />} className="btn-muted">
        disconnect
      </Button>
    </div>
  );
}

export default function SessionControls({ startSession, stopSession, sendTextMessage, isSessionActive }) {
  return (
    <div className="flex gap-4 h-full rounded-xl">
      {isSessionActive ? (
        <SessionActive stopSession={stopSession} sendTextMessage={sendTextMessage} />
      ) : (
        <SessionStopped startSession={startSession} />
      )}
    </div>
  );
}
