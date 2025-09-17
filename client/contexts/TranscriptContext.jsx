import { createContext, useContext, useState } from "react";

const TranscriptContext = createContext(undefined);

function newTimestampPretty() {
  const now = new Date();
  // Format: HH:MM:SS AM/PM
  return now.toLocaleTimeString([], {
    hour12: true,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

export function TranscriptProvider({ children }) {
  const [transcriptItems, setTranscriptItems] = useState([]);

  const addTranscriptMessage = (itemId, role, text = "", isHidden = false) => {
    setTranscriptItems((prev) => {
      if (prev.some((log) => log.itemId === itemId && log.type === "MESSAGE")) {
        return prev;
      }

      const newItem = {
        itemId,
        type: "MESSAGE",
        role,
        title: text,
        expanded: false,
        timestamp: newTimestampPretty(),
        createdAtMs: Date.now(),
        status: "IN_PROGRESS",
        isHidden,
      };

      return [...prev, newItem];
    });
  };

  const updateTranscriptMessage = (itemId, newText, append = false) => {
    setTranscriptItems((prev) =>
      prev.map((item) => {
        if (item.itemId === itemId && item.type === "MESSAGE") {
          return {
            ...item,
            title: append ? (item.title || "") + newText : newText,
          };
        }
        return item;
      }),
    );
  };

  const addTranscriptBreadcrumb = (title, data) => {
    setTranscriptItems((prev) => [
      ...prev,
      {
        itemId: `breadcrumb-${crypto.randomUUID?.() || Math.random().toString(36).slice(2)}`,
        type: "BREADCRUMB",
        title,
        data,
        expanded: false,
        timestamp: newTimestampPretty(),
        createdAtMs: Date.now(),
        status: "DONE",
        isHidden: false,
      },
    ]);
  };

  const toggleTranscriptItemExpand = (itemId) => {
    setTranscriptItems((prev) =>
      prev.map((log) => (log.itemId === itemId ? { ...log, expanded: !log.expanded } : log)),
    );
  };

  const updateTranscriptItem = (itemId, updatedProperties) => {
    setTranscriptItems((prev) =>
      prev.map((item) => (item.itemId === itemId ? { ...item, ...updatedProperties } : item)),
    );
  };

  return (
    <TranscriptContext.Provider
      value={{
        transcriptItems,
        addTranscriptMessage,
        updateTranscriptMessage,
        addTranscriptBreadcrumb,
        toggleTranscriptItemExpand,
        updateTranscriptItem,
      }}
    >
      {children}
    </TranscriptContext.Provider>
  );
}

export function useTranscript() {
  const context = useContext(TranscriptContext);
  if (!context) {
    // SSR-safe fallback: provide no-op handlers and empty list
    return {
      transcriptItems: [],
      addTranscriptMessage: () => {},
      updateTranscriptMessage: () => {},
      addTranscriptBreadcrumb: () => {},
      toggleTranscriptItemExpand: () => {},
      updateTranscriptItem: () => {},
    };
  }
  return context;
}


