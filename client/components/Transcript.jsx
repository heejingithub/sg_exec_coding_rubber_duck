import { useEffect, useRef, useState } from "react";
import { useTranscript } from "../contexts/TranscriptContext";

export default function Transcript() {
  const { transcriptItems, toggleTranscriptItemExpand } = useTranscript();
  const transcriptRef = useRef(null);
  const [prevItems, setPrevItems] = useState([]);

  function scrollToBottom() {
    if (transcriptRef.current) {
      transcriptRef.current.scrollTop = transcriptRef.current.scrollHeight;
    }
  }

  useEffect(() => {
    const hasNew = transcriptItems.length > prevItems.length;
    const hasUpdated = transcriptItems.some((it, idx) => {
      const prev = prevItems[idx];
      return prev && (it.title !== prev.title || it.data !== prev.data);
    });
    if (hasNew || hasUpdated) scrollToBottom();
    setPrevItems(transcriptItems);
  }, [transcriptItems]);

  return (
    <div className="flex flex-col flex-1 glass-panel neon-border min-h-0 rounded-2xl">
      <div className="flex items-center justify-between px-4 py-2 sticky top-0 z-10 text-sm border-b border-white/10 bg-transparent rounded-t-2xl">
        <span className="font-semibold tracking-wide">
          <span className="neon-text">Conversation</span>
        </span>
      </div>
      <div ref={transcriptRef} className="overflow-auto p-4 flex flex-col gap-y-3 max-h-[38vh] scroll-smoothy">
        {[...transcriptItems]
          .sort((a, b) => a.createdAtMs - b.createdAtMs)
          .map((item) => {
            const { itemId, type, role, data, expanded, timestamp, title = "", isHidden } = item;
            if (isHidden) return null;

            if (type === "MESSAGE") {
              const isUser = role === "user";
              const isBracketed = title.startsWith("[") && title.endsWith("]");
              const messageStyle = isBracketed ? "italic text-[var(--muted)]" : "";
              const displayTitle = isBracketed ? title.slice(1, -1) : title;

              return (
                <div
                  key={itemId}
                  className={`flex gap-3 ${isUser ? "flex-row-reverse" : "flex-row"}`}
                >
                  {isUser ? (
                    <div className="avatar-duck duck-avatar-sm">👤</div>
                  ) : (
                    <div className="avatar-duck duck-avatar-sm" aria-hidden="true">
                      <img src="/rubber-duck.png" alt="Rubber duck" />
                    </div>
                  )}
                  <div
                    className={`max-w-[70%] rounded-2xl px-4 py-3 whitespace-pre-wrap break-words ${
                      isUser ? "chat-bubble-user" : "chat-bubble-assistant"
                    }`}
                  >
                    <div className={`text-[11px] mono ${isUser ? "text-[var(--muted)]" : "text-emerald-200/90"}`}>
                      {timestamp}
                    </div>
                    <div className={`${messageStyle}`}>{displayTitle}</div>
                  </div>
                </div>
              );
            }

            if (type === "BREADCRUMB") {
              return (
                <div key={itemId} className="flex flex-col justify-start items-start text-[var(--muted)] text-sm">
                  <span className="text-xs mono">{timestamp}</span>
                  <div
                    className={`whitespace-pre-wrap flex items-center mono text-xs text-[var(--text)] ${
                      data ? "cursor-pointer" : ""
                    }`}
                    onClick={() => data && toggleTranscriptItemExpand(itemId)}
                  >
                    {data && (
                      <span
                        className={`text-[var(--muted)] mr-1 select-none mono ${expanded ? "rotate-90" : "rotate-0"}`}
                      >
                        ▶
                      </span>
                    )}
                    {title}
                  </div>
                  {expanded && data && (
                    <div className="text-left w-full">
                      <pre className="border-l-2 ml-1 border-white/15 whitespace-pre-wrap break-words mono text-[11px] mb-2 mt-2 pl-2">
                        {JSON.stringify(data, null, 2)}
                      </pre>
                    </div>
                  )}
                </div>
              );
            }

            return (
              <div key={itemId} className="flex justify-center text-[var(--muted)] text-sm italic mono">
                Unknown item type: {type} <span className="ml-2 text-xs">{timestamp}</span>
              </div>
            );
          })}
      </div>
    </div>
  );
}

