import { useEffect, useState } from "react";

// Tools are defined via RealtimeAgent in App.jsx

export default function ToolPanel({ isSessionActive, supervisorOutput, openLogFilename }) {
  const [logFilename, setLogFilename] = useState("");
  const [logContent, setLogContent] = useState("");
  const [logFiles, setLogFiles] = useState([]);
  

  useEffect(() => {
    if (!isSessionActive) return;
    fetch("/logs/list")
      .then((r) => r.json())
      .then((data) => setLogFiles(Array.isArray(data.files) ? data.files : []))
      .catch(() => setLogFiles([]));
  }, [isSessionActive]);

  // No function_call interception needed; SDK executes tool and continues turn

  useEffect(() => {
    if (!isSessionActive) {
      setLogFilename("");
      setLogContent("");
    }
  }, [isSessionActive]);

  // Auto-open a requested log file from the tool call
  useEffect(() => {
    if (!isSessionActive || !openLogFilename) return;
    const want = String(openLogFilename || '').trim();
    if (!want) return;
    const resolve = (list) => {
      const lower = want.toLowerCase();
      const hyphen = lower.replace(/_/g, '-');
      const underscore = lower.replace(/-/g, '_');
      return (
        list.find((f) => f.toLowerCase() === lower) ||
        list.find((f) => f.toLowerCase() === hyphen) ||
        list.find((f) => f.toLowerCase() === underscore) ||
        null
      );
    };
    const tryOpen = (name) => {
      setLogFilename(name);
      fetch(`/logs/read?file=${encodeURIComponent(name)}`)
        .then((r) => r.json())
        .then((data) => setLogContent(data.content || ""))
        .catch(() => setLogContent(""));
    };
    const found = resolve(logFiles);
    if (found) tryOpen(found);
    // If the list isn't loaded yet, re-run when logFiles updates
  }, [openLogFilename, logFiles, isSessionActive]);

  return (
    <section className="h-full w-full flex flex-col gap-4">
      <div className="h-full rounded-xl">
        <h2 className="text-lg font-bold mb-1">
          <span className="neon-text">Log Viewer</span>
        </h2>
        {/* Supervisor results panel */}
        {supervisorOutput ? (
          <div className="mt-2 mb-3 glass-panel border border-white/10 rounded-lg p-3">
            <div className="flex items-center justify-between mb-2">
              <p className="text-sm text-[var(--muted)]">Supervisor Output</p>
              <button
                className="text-xs btn-muted rounded-full px-2 py-1"
                onClick={() => navigator.clipboard?.writeText(supervisorOutput)}
              >
                Copy
              </button>
            </div>
            <pre className="mono whitespace-pre-wrap break-words text-sm">{supervisorOutput}</pre>
          </div>
        ) : (
          <div className="mt-2 mb-3 glass-panel border border-white/10 rounded-lg p-3 text-[var(--muted)] text-sm">
            <div className="font-semibold mb-1">Supervisor Output</div>
            <div>No output yet. Start a session, then paste logs or select a log filename and ask for analysis.</div>
          </div>
        )}
        {isSessionActive && logFiles.length > 0 && (
          <div className="mt-2 flex gap-3">
            <div className="w-1/3 glass-panel border border-white/10 rounded-lg p-2 max-h-[70vh] overflow-y-auto scroll-smoothy">
              <p className="text-xs font-semibold text-[var(--muted)] mb-2">Available Logs</p>
              <ul className="flex flex-col gap-1">
                {logFiles.map((f) => (
                  <li key={f}>
                    <button
                      className={`w-full text-left text-xs px-2 py-2 rounded-md border transition-colors ${
                        logFilename === f
                          ? "bg-emerald-400/10 border-emerald-400/40 text-emerald-200"
                          : "bg-white/5 border-white/10 hover:bg-white/10 text-[var(--text)]"
                      }`}
                      onClick={() => {
                        setLogFilename(f);
                        fetch(`/logs/read?file=${encodeURIComponent(f)}`)
                          .then((r) => r.json())
                          .then((data) => setLogContent(data.content || ""))
                          .catch(() => setLogContent(""));
                      }}
                    >
                      {f}
                    </button>
                  </li>
                ))}
              </ul>
              {/* No analyze buttons needed — the chat agent escalates automatically based on user messages. */}
            </div>
            <div className="w-2/3">
              <p className="text-sm text-[var(--muted)] mb-2">{logFilename}</p>
              {isSessionActive ? (
                logContent ? (
                  <pre className="text-xs glass-panel rounded-lg p-3 border border-white/10 overflow-y-auto max-h-[70vh] whitespace-pre-wrap break-words scroll-smoothy mono">
                    {logContent}
                  </pre>
                ) : (
                  <p className="text-sm text-[var(--muted)]">Select a log from the left to view it.</p>
                )
              ) : (
                <p>Start the session to use this tool...</p>
              )}
              
            </div>
          </div>
        )}
        {isSessionActive ? (
          !logFiles.length && (
            <p className="text-sm text-[var(--muted)] mt-2">No logs found in /logs</p>
          )
        ) : (
          <p>Start the session to use this tool...</p>
        )}
      </div>
    </section>
  );
}
