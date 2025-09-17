import { useEffect, useRef, useState, useMemo } from "react";
import logo from "/assets/openai-logomark.svg";
import EventLog from "./EventLog";
import Transcript from "./Transcript";
import { useTranscript } from "../contexts/TranscriptContext";
import SessionControls from "./SessionControls";
import ToolPanel from "./ToolPanel";
import { RealtimeAgent, RealtimeSession, tool } from "@openai/agents/realtime";
import z from "zod";

export default function App() {
  const [isSessionActive, setIsSessionActive] = useState(false);
  const [events, setEvents] = useState([]);
  const [supervisorOutput, setSupervisorOutput] = useState("");
  const [openLogFilename, setOpenLogFilename] = useState("");
  const sessionRef = useRef(null);
  const lastTextByItemIdRef = useRef({});
  const { transcriptItems, addTranscriptMessage, updateTranscriptMessage, addTranscriptBreadcrumb } = useTranscript();

  // ChatSupervisor pattern: ask Supervisor (gpt-5) for complex tasks.
  const getNextResponseFromSupervisor = useMemo(() => {
    const schema = z.object({
      relevantContextFromLastUserMessage: z.string().nullable(),
      filename: z.string().nullable(),
      language: z.string().nullable(),
      // Required: either the pasted log text, or the sentinel string "__FILE__" when using a filename
      logs: z.string().describe(
        "Required. Set to the user's pasted log text, or the exact string __FILE__ when a filename is provided (indicating logs should be read from server).",
      ),
    });
    return tool({
      name: "getNextResponseFromSupervisor",
      description:
        "Ask the Supervisor model (gpt-5) for the next response. You must supply 'logs': either the pasted text or the sentinel __FILE__ when providing a filename. Final output is a raw code block with a comment header.",
      parameters: schema,
      async execute({ relevantContextFromLastUserMessage, filename, language, logs }, details) {
        try {
          addTranscriptBreadcrumb("Supervisor requested", {
            relevantContextFromLastUserMessage,
            filename,
            language,
          });
        } catch {}

        // Prepare realtime history for supervisor
        let historyPayload = [];
        try {
          const rtHistory = (details?.context?.history || []);
          historyPayload = rtHistory.filter((i) => i.type === "message");
        } catch {}

        // Derive pasted logs when no filename
        let userLogText = "";
        if (!filename) {
          try {
            const rtHistory = (details?.context?.history || []);
            const msgs = rtHistory.filter((i) => i.type === "message" && i.role === "user");
            const last = msgs[msgs.length - 1];
            if (last && Array.isArray(last.content)) {
              const piece = last.content.find(
                (c) => (c.type === "input_text" && c.text) || (c.type === "input_audio" && c.transcript),
              );
              userLogText = piece?.text || piece?.transcript || "";
            }
          } catch {}
          if (!userLogText.trim()) {
            const lastUser = [...(transcriptItems || [])]
              .filter((it) => it.type === "MESSAGE" && it.role === "user" && !!it.title)
              .slice(-1)[0];
            userLogText = lastUser?.title || "";
          }
        }

        // Enforce required logs param: either pasted content or __FILE__ with a filename
        const usingServerFile = logs === "__FILE__";
        if (usingServerFile && !filename) {
          return "I need the exact log filename before analyzing. Please specify the file (e.g., app-error.log).";
        }
        if (!usingServerFile) {
          // If model supplied pasted logs in 'logs', prefer that over history-derived text
          if (typeof logs === "string" && logs.trim()) {
            userLogText = logs;
          }
        }
        if (!usingServerFile && !userLogText.trim()) {
          return "Please paste the log content you'd like me to analyze, or specify a filename.";
        }

        // Tool call events suppressed in session log (breadcrumbs already shown)

        // If analyzing a server file, auto-open it in the Log Viewer panel
        if (usingServerFile && filename) {
          try { setOpenLogFilename(filename); } catch {}
        }

        let text = "";
        try {
          const payload = {
            file: usingServerFile ? filename : null,
            content: usingServerFile ? null : userLogText,
            language: language || null,
            context: relevantContextFromLastUserMessage || null,
            history: historyPayload,
          };
          console.debug("[Supervisor] request", payload);
          const r = await fetch("/supervisor/analyze", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          });
          const data = await r.json();
          text = data?.text || data?.analysis || "";
          console.debug("[Supervisor] response", { len: text?.length || 0, preview: (text || "").slice(0, 160) });
          setSupervisorOutput(text || "");
        } catch (e) {
          console.error("[Supervisor] error", e);
        }
        try {
          addTranscriptBreadcrumb("Supervisor result", {
            filename: filename || "(pasted)",
            preview: (text || "").slice(0, 220),
          });
        } catch {}
        // Tool result events suppressed; side panel shows outputs
        // Also return a grounded, concise summary parsed from the supervisor text so Realtime speaks accurately
        try {
          const raw = text || "";
          let header = "";
          const m = raw.match(/\/\*([\s\S]*?)\*\//);
          if (m) header = m[1] || "";
          const grab = (label) => {
            const re = new RegExp(label + ":\\s*([\\s\\S]*?)(?:\n|$)");
            const mm = header.match(re);
            return (mm && mm[1] ? mm[1].trim() : "").replace(/\s+/g, " ");
          };
          const parts = [];
          const s = grab("Summary");
          if (s) parts.push(`Summary: ${s}`);
          const rc = grab("Root Cause");
          if (rc) parts.push(`Root Cause: ${rc}`);
          const fix = grab("Fix");
          if (fix) parts.push(`Fix: ${fix}`);
          const joined = parts.join(" \u2192 ");
          if (joined) return joined.slice(0, 360);
        } catch {}
        return filename
          ? `Supervisor analyzed ${filename}. See side panel for the exact fix.`
          : `Supervisor analyzed your pasted logs. See side panel for the exact fix.`;
      },
    });
  }, [transcriptItems]);

  async function startSession() {
    if (sessionRef.current) {
      await stopSession();
      await new Promise((r) => setTimeout(r, 150));
    }
    // Get a session token for OpenAI Realtime API
    const tokenResponse = await fetch(`/token`);
    const data = await tokenResponse.json();
    const EPHEMERAL_KEY = data.value;

    const VOICE = "marin";
    const agent = new RealtimeAgent({
      name: "Quacky",
      voice: VOICE,
      instructions:
        `You are Quacky, a concise, friendly and fast-speaking rubber-duck coding assistant. Keep replies short and conversational unless asked to expand.
        Start with a friendly greeting e.g. "Hey I'm Quacky! Are you feeling Ducky today? What Can I help you with?" or "I'm feeling duckin' fantastic! Ready to debug?"
        Your goal is to help developers identify and solve coding issues, improve code quality, and onramp users onto both modern and legacy codebases.

        ChatSupervisor pattern: You handle greetings, small talk, clarifying questions and simple guidance.
        For anything that analyzes logs or produces code-level recommendations, call 'getNextResponseFromSupervisor' and then give a brief summary.
        The Supervisor returns a single raw code block with a comment header (Summary, Root Cause, Fix, Next Checks).
        Mention the summary and key fixes in 1–2 sentences.
        Do not read the entire code aloud unless asked.

        Duck persona:
        - Speak warmly and keep energy high.
        - Always keep your tone supportive, emotive, and conversational
        - Speak quickly, with responses broken into short, natural-sounding sentences. Each turn in conversation should be brief—default to 5–20 words per sentence, and only offer longer replies if the user asks for more detail.
        - Occasionally add a natural duck quack sound effect (once per turn at most). Do not literally say the word "quack", but make a quacking sound effect.
        - Never insert quacks inside code blocks or variable names.

        Tool calling (strict):
        - Only call the tool when you already have logs: either a pasted log in the latest user message, or a specific filename.
        - When calling, you MUST pass a required parameter 'logs':
          * If using a filename, set logs="__FILE__" and include the filename.
          * The filename MUST be one of the following: app-error.log, db-connection.log, worker-crash.log, python-traceback.log
          * If using pasted logs, set logs to the pasted text verbatim and omit filename.
        - Include 'language' if the user specified one; otherwise set it to null and ask a quick follow-up.
        - Always include a one-sentence 'relevantContextFromLastUserMessage'.
        - Say a short filler (e.g., "One moment.") before calling the tool, then wait for the tool result before continuing.

        Pronouncing code in voice:
        - Read SUBSTR as "substring"; LEN as "length"; idx as "index", str as "string" etc...
        - Read (2:4) as "start two, length four" (COBOL start:length). Or read it as "two to four inclusive" depending on the language.
        - Read ranges like [0..4] as "zero through four inclusive".
        - Symbols: ':' = "colon", '::' = "double-colon", '->' = "arrow", '=>' = "fat arrow".
        - For long code blocks, summarize then read only the changed or relevant lines.

        For legacy onramping, always:
        - Always include onboarding notes and common gotchas when relevant
        - Translate code quirks and behaviors in simple terms.
        - Call out why the bug or trap exists in that system (e.g., COBOL’s substring params).
        - Toss in modernization tips or hooks to tools/interfaces that could help every time.
        - Encourage curiosity, and keep the developer’s learning journey positive.

        Keep heavy analysis instructions minimal here; delegate deep log/code reasoning to the Supervisor.
        `,
      tools: [getNextResponseFromSupervisor],
    });

    const session = new RealtimeSession(agent, {
      model: "gpt-realtime",
      config: {
        inputAudioFormat: "pcm16",
        outputAudioFormat: "pcm16",
        inputAudioTranscription: { model: "gpt-4o-mini-transcribe" },
        turnDetection: {
          type: "semantic_vad",
          eagerness: "medium",
          createResponse: true,
          interruptResponse: true,
        },
      },
    });

    // No custom audio element; transport manages audio automatically
    await session.connect({ apiKey: EPHEMERAL_KEY });
    sessionRef.current = session;
    
    setIsSessionActive(true);
    setEvents([]);
    setEvents((prev) => [
      { type: "session.connected", timestamp: new Date().toLocaleTimeString() },
      ...prev,
    ]);
    addTranscriptBreadcrumb("Session connected");
  }

  // Stop current session, clean up peer connection and data channel
  async function stopSession() {
    setEvents((prev) => [
      { type: "session.disconnect.requested", timestamp: new Date().toLocaleTimeString() },
      ...prev,
    ]);
    try {
      // Disable automatic turn detection to stop new responses
      await sessionRef.current?.sendEvent?.({
        type: "session.update",
        session: { turn_detection: null },
      });
    } catch {}
    try {
      // Also disable audio input VAD explicitly
      await sessionRef.current?.sendEvent?.({
        type: "session.update",
        session: { audio: { input: { turn_detection: null } } },
      });
    } catch {}
    try {
      // Mute upstream to stop mic streaming
      await sessionRef.current?.mute?.(true);
    } catch {}
    try {
      // Cancel any queued/ongoing response on the server
      await sessionRef.current?.sendEvent?.({ type: "response.cancel" });
    } catch {}
    try {
      // Clear any buffered input audio to avoid late commits
      await sessionRef.current?.sendEvent?.({ type: "input_audio_buffer.clear" });
    } catch {}
    try {
      // Immediately halt any in-flight generation/audio
      await sessionRef.current?.interrupt?.();
    } catch {}
    try {
      await sessionRef.current?.disconnect?.();
    } catch {}
    sessionRef.current = null;
    
    setIsSessionActive(false);
    setEvents((prev) => [
      { type: "session.disconnected", timestamp: new Date().toLocaleTimeString() },
      ...prev,
    ]);
  }

  // Send a message to the model (text only for now)

  // Send a text message to the model
  function sendTextMessage(message) {
    try {
      if (!isSessionActive || !sessionRef.current) return;
      sessionRef.current?.sendMessage?.(message);
    } catch (e) {
      console.error("Failed to send message", e);
    }
  }

  // Bind session history updates: stream transcripts into UI
  useEffect(() => {
    if (!sessionRef.current) return;
    const session = sessionRef.current;
    const handler = (history) => {
      try {
        const items = Array.isArray(history) ? history : [];
        const last = items.length ? items[items.length - 1] : null;
        if (!last) return;
        // Mark tool calls in transcript as breadcrumbs only (no session events)
        if (last.type === "function_call" && last.name) {
          addTranscriptBreadcrumb(`Tool called: ${last.name}`, {
            arguments: last.arguments || last.function_call_arguments || null,
          });
          // Do not return; also try to render the latest message content
        }

        let msg = last;
        if (!msg || msg.type !== "message" || !Array.isArray(msg.content)) {
          for (let i = items.length - 1; i >= 0; i--) {
            const it = items[i];
            if (it.type === "message" && Array.isArray(it.content)) { msg = it; break; }
          }
        }
        if (!msg || msg.type !== "message" || !Array.isArray(msg.content)) return;
        const itemId = msg.itemId || msg.id || "unknown";
        const role = msg.role || "assistant";
        const piece = msg.content.find(
          (c) =>
            (c.type === "input_audio" && c.transcript) ||
            (c.type === "output_audio" && c.transcript) ||
            (c.type === "input_text" && c.text) ||
            (c.type === "output_text" && c.text),
        );
        const text = piece?.transcript || piece?.text || "";
        if (text === "") return;

        const prevText = lastTextByItemIdRef.current[itemId] || "";
        if (prevText === "") {
          addTranscriptMessage(itemId, role, text);
          lastTextByItemIdRef.current[itemId] = text;
        } else if (text.length > prevText.length) {
          const delta = text.slice(prevText.length);
          updateTranscriptMessage(itemId, delta, true);
          lastTextByItemIdRef.current[itemId] = text;
        }
      } catch {}
    };
    session.on?.("history_updated", handler);
    return () => {
      session.off?.("history_updated", handler);
    };
  }, [isSessionActive]);

  return (
    <>
      {/* Top nav */}
      <nav className="absolute top-0 left-0 right-0 h-16 flex items-center">
          <div className="flex items-center justify-between w-full px-4 py-3">
          <div className="flex items-center gap-2">
            <div className="leading-tight">
              <div className="text-sm text-[var(--muted)] uppercase tracking-[0.18em]">Rubber Duck</div>
              <h1 className="text-xl font-semibold">
                <span className="neon-text">Coding Assistant</span>
              </h1>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="badge" title="Session state">
              <span
                className={`inline-block h-2.5 w-2.5 rounded-full ${
                  isSessionActive ? "bg-emerald-400" : "bg-rose-400"
                }`}
              />
              {isSessionActive ? "Ready" : "Disconnected"}
            </span>
            <img style={{ width: "18px", opacity: 0.6 }} src={logo} />
          </div>
        </div>
      </nav>

      {/* Content */}
      <main className="absolute top-16 left-0 right-0 bottom-0">
        {/* Left column: transcript + event log + controls */}
        <section className="absolute top-0 left-0 right-[560px] bottom-0 flex">
          {/* Scroll area */}
          <section className="absolute top-0 left-0 right-0 bottom-36 px-4 overflow-y-auto scroll-smoothy space-y-4">
            {/* Duck intro card */}
            <div className="neon-border glass-panel duck-holo p-5 rounded-2xl">
              <div className="flex items-center gap-5">
                <div className="avatar-duck" aria-hidden="true">
                  <img src="/rubber-duck.png" alt="Rubber duck" />
                </div>
                <div>
                  <div className="text-sm text-[var(--muted)]">Quacky, your debugging companion</div>
                  <div className="text-base">Talk through code problems and log analysis with a friendly duck.</div>
                </div>
              </div>
            </div>

            <Transcript />
            <EventLog events={events} />
          </section>

          {/* Controls */}
          <section className="absolute h-36 left-0 right-0 bottom-0 p-4">
            <div className="glass-panel neon-border h-full rounded-2xl p-2">
              <SessionControls
                startSession={startSession}
                stopSession={stopSession}
                sendTextMessage={sendTextMessage}
                isSessionActive={isSessionActive}
              />
            </div>
          </section>
        </section>

        {/* Right column: tools */}
        <section className="absolute top-0 w-[560px] right-0 bottom-0 p-4 pt-0 overflow-y-auto scroll-smoothy space-y-4">
          <div className="glass-panel neon-border rounded-2xl p-4">
            <ToolPanel isSessionActive={isSessionActive} supervisorOutput={supervisorOutput} openLogFilename={openLogFilename} />
          </div>
        </section>
      </main>
    </>
  );
}
