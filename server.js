import express from "express";
import fs from "fs";
import path from "path";
// Removed zod + legacy Agent imports used by deprecated /logs/analyze
// import z from "zod";
// import { Agent, run } from "@openai/agents";
import { createServer as createViteServer } from "vite";
import "dotenv/config";

const app = express();
const port = process.env.PORT || 3000;
const apiKey = process.env.OPENAI_API_KEY;

// Configure Vite middleware for React client
const vite = await createViteServer({
  server: { middlewareMode: true },
  appType: "custom",
});
app.use(vite.middlewares);
const sessionConfig = JSON.stringify({
  session: {
    type: "realtime",
    model: "gpt-realtime"
  },
});

// Serve the local rubber duck image explicitly so the client can use it
app.get("/rubber-duck.png", (req, res) => {
  const file = path.resolve(process.cwd(), "rubber-duck.png");
  res.sendFile(file);
});

// --- Log file utilities & endpoints ---
const LOGS_DIR = path.resolve(process.cwd(), "logs");

function isSafeLogFile(file) {
  if (!file) return false;
  const normalized = path.normalize(file);
  if (normalized.includes("..")) return false;
  const full = path.join(LOGS_DIR, normalized);
  return full.startsWith(LOGS_DIR);
}

app.get("/logs/list", async (req, res) => {
  try {
    if (!fs.existsSync(LOGS_DIR)) {
      return res.json({ files: [] });
    }
    const files = fs
      .readdirSync(LOGS_DIR, { withFileTypes: true })
      .filter((d) => d.isFile() && d.name.endsWith(".log"))
      .map((d) => d.name)
      .sort();
    res.json({ files });
  } catch (e) {
    console.error("/logs/list error", e);
    res.status(500).json({ error: "Failed to list log files" });
  }
});

app.get("/logs/read", async (req, res) => {
  try {
    const file = (req.query.file || "").toString();
    if (!isSafeLogFile(file)) {
      return res.status(400).json({ error: "Invalid file" });
    }
    const fullPath = path.join(LOGS_DIR, file);
    if (!fs.existsSync(fullPath)) {
      return res.status(404).json({ error: "File not found" });
    }
    const content = fs.readFileSync(fullPath, "utf-8");
    res.json({ file, content });
  } catch (e) {
    console.error("/logs/read error", e);
    res.status(500).json({ error: "Failed to read log file" });
  }
});

// Supervisor endpoint using gpt-5 with free-form tools and text output
app.post("/supervisor/analyze", express.json(), async (req, res) => {
  try {
    const { file, language, content, context, history } = req.body || {};
    console.log("[supervisor] request", { file, hasContent: !!content, lang: language, hasHistory: Array.isArray(history) && history.length > 0 });

    let logContent = "";
    if (file) {
      // Try to resolve the file robustly (handle underscores vs hyphens and case)
      const available = fs
        .readdirSync(LOGS_DIR, { withFileTypes: true })
        .filter((d) => d.isFile() && d.name.endsWith(".log"))
        .map((d) => d.name);
      const wanted = String(file).trim();
      let resolved = null;
      const lower = wanted.toLowerCase();
      const hyphen = lower.replace(/_/g, "-");
      const underscore = lower.replace(/-/g, "_");
      resolved =
        available.find((f) => f.toLowerCase() === lower) ||
        available.find((f) => f.toLowerCase() === hyphen) ||
        available.find((f) => f.toLowerCase() === underscore) ||
        null;

      if (resolved) {
        const fullPath = path.join(LOGS_DIR, resolved);
        logContent = fs.readFileSync(fullPath, "utf-8");
        console.log("[supervisor] resolved file", { requested: wanted, resolved, bytes: logContent.length });
      } else {
        const msg = `Error: log file '${wanted}' not found. Available: ${available.join(", ")}`;
        console.warn("[supervisor] file not found", { requested: wanted });
        return res.json({ file: wanted, text: msg, supervisor: true });
      }
    } else if (typeof content === "string" && content.trim()) {
      logContent = content;
      console.log("[supervisor] using pasted content", { bytes: logContent.length });
    } else {
      // Graceful fallback so UI can render the message in the side panel
      console.warn("[supervisor] no content or file provided");
      return res.json({ file: null, text: "No log content provided. Please paste logs or specify a valid filename.", supervisor: true });
    }

    const defaultLang = language || "python";
    const systemText = [
      "You are the Supervisor for a rubber duck coding assistant (Quacky).",
      "Your job: analyze logs and produce clear, copy‑pasteable fixes and guidance.",
      "Follow these instructions exactly:",
      "- Be concise and conversational by default (80–150 words unless more is requested).",
      "- Keep the supportive, emotive, encouraging tone of Quacky when writing text.",
      "- Maintain the rubber-duck persona, but do not include quack sounds inside code or filenames.",
      "- Start with a labeled structure:",
      "  Summary: <1–2 sentences>",
      "  Likely Root Cause: <1–2 bullets>",
      "  Fix: <2–4 concrete steps and/or a minimal code snippet>",
      "  Next Checks: <1–2 bullets>",
      "- Provide an example code snippet showing the corrected code when helpful.",
      "- Use triple backticks with a language tag for code fences (e.g., ```js or ```python).",
      "- Prefer minimal diffs and pragmatically safe changes; avoid over‑refactors unless asked.",
      "- If a file name is specified, reference it once as context (do not invent filenames).",
      "- If information is missing, state assumptions briefly and tell the chat agent exactly what to ask the user for (e.g., file name, language).",
      "- Systematically scan code for bugs, anti‑patterns, maintainability, security, and performance risks.",
      "- Infer the programming language when not specified from code/logs; still honor an explicit 'language' parameter if provided.",
      "- For legacy/esoteric stacks (e.g., COBOL), include onboarding notes and common gotchas when relevant.",
      "- Optionally end with 1–3 future‑proofing or migration tips when appropriate.",
      defaultLang ? `- Use ${defaultLang} for any example code.` : "",
      "- You MUST call the code_exec tool exactly once before your final message to emit the corrected code (pass { language: '<lang>', code: '<corrected snippet>' }). After the tool call, repeat the same corrected code in your final message as a fenced code block with a multi-line comment header (Summary, Root Cause, Fix, Next Checks).",
    ]
      .filter(Boolean)
      .join("\n");

    const userText = [
      history ? `==== Conversation History ===\n${JSON.stringify(history, null, 2)}` : "",
      context ? `\nRelevant context from last user message: ${context}` : "",
      file ? `\nAnalyzing log file: ${file}` : "",
      `\nLog Content:\n\n${logContent}`,
    ]
      .filter(Boolean)
      .join("\n");

    const body = {
      model: "gpt-5-mini",
      input: [
        { type: "message", role: "system", content: systemText + "\n\nFinal output format: Return ONLY a single fenced code block in the requested language. At the very top of the code, include a multi-line comment header with: Summary, Root Cause, Fix (concise bullets), and Next Checks. No extra prose outside the code block." },
        { type: "message", role: "user", content: userText },
      ],
      text: { format: { type: "text" } },
      tools: [
        { type: "custom", name: "code_exec", description: "Executes arbitrary code in the specified language" },
      ],
      parallel_tool_calls: false,
      reasoning_effort: "minimal",
      verbosity: "low",
    };

    const r = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    let data = await r.json();
    let lastToolArgs = null;
    // Handle any function calls by iterating with appended outputs (like the reference pattern)
    while (true) {
      const items = data?.output || [];
      const calls = items.filter((i) => i.type === "function_call");
      if (!calls.length) break;
      for (const c of calls) {
        let args = {};
        try { args = JSON.parse(c.arguments || "{}"); } catch {}
        lastToolArgs = args || lastToolArgs; // capture the most recent tool arguments (may include code)
        const toolOutput = {
          executed: false,
          language: args?.language || defaultLang || null,
          note: "Execution disabled in this demo; return corrected code directly in your response.",
        };
        body.input.push(
          { type: "function_call", call_id: c.call_id, name: c.name, arguments: c.arguments },
          { type: "function_call_output", call_id: c.call_id, output: JSON.stringify(toolOutput) },
        );
      }
      const rr = await fetch("https://api.openai.com/v1/responses", {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      data = await rr.json();
    }
    // Final free-form text output (raw code with comment header)
    let text = data?.output_text;
    if (!text) {
      const msgs = (data?.output || []).filter((i) => i.type === "message");
      text = msgs
        .map((m) => (m.content || []).filter((c) => c.type === "output_text").map((c) => c.text).join(""))
        .join("\n");
    }
    // Heuristic fallback: synthesize a minimal fix if model returned no text
    if (!text || !text.trim()) {
      const lc = (logContent || "").toLowerCase();
      let snippet = null;
      if (lc.includes("has no attribute 'message'") || lc.includes('no attribute \"message\"')) {
        // Python 3: Exception.message removed
        snippet = `/*\nSummary: Fix Python 3 exception logging and validate user_id parsing.\nRoot Cause: Using e.message (removed in Python 3) and int() on non-numeric input raises ValueError.\nFix: Use str(e) for logging and guard int() conversion with try/except.\nNext Checks: Add input validation and unit tests for bad user_id values.\n*/\n\n\`\`\`python\nimport logging\nlog = logging.getLogger(__name__)\n\ndef process_request(request):\n    try:\n        raw = request.get("user_id")\n        try:\n            user_id = int(raw)\n        except (TypeError, ValueError):\n            raise ValueError(f"invalid user_id: {raw!r}")\n        # TODO: handle request['action']\n        return {"ok": True, "user_id": user_id}\n    except Exception as e:\n        # Python 3: use str(e), not e.message\n        log.error("Failed to process request: %s", str(e))\n        raise\n\n\`\`\``;
      } else if (lc.includes("invalid literal for int()")) {
        snippet = `/*\nSummary: Guard integer conversion and raise a clearer error when user_id is invalid.\nRoot Cause: int() called on non-numeric string (e.g., '42a').\nFix: Wrap int() in try/except and emit a helpful message.\nNext Checks: Validate inputs at boundaries and add tests.\n*/\n\n\`\`\`python\ndef parse_user_id(raw):\n    try:\n        return int(raw)\n    except (TypeError, ValueError):\n        raise ValueError(f"invalid user_id: {raw!r}")\n\n\`\`\``;
      }
      if (snippet) {
        console.warn("[supervisor] synthesized fallback snippet due to empty final text");
        text = snippet;
      }
    }
    // Fallback: if model failed to emit a final message, but provided code in the last tool call args, surface that
    if ((!text || !text.trim()) && lastToolArgs && lastToolArgs.code) {
      const lang = (lastToolArgs.language || defaultLang || "text").toString();
      const header = [
        "/*",
        "Summary: Supervisor returned no final message; using code from tool call.",
        "Root Cause: Missing final text after tool execution",
        "Fix: Apply the following corrected code",
        "Next Checks: Re-run and validate",
        "*/",
      ].join("\n");
      text = `${header}\n\n\
\`\`\`${lang}\n${lastToolArgs.code}\n\`\`\``;
    }
    console.log("[supervisor] final text", { len: (text || "").length, preview: (text || "").slice(0, 160) });
    res.json({ file: file || null, text: text || "", supervisor: true });
  } catch (e) {
    console.error("/supervisor/analyze error", e);
    res.status(500).json({ error: "Failed to run supervisor analysis" });
  }
});

// Removed deprecated /logs/analyze endpoint in favor of /supervisor/analyze

// Removed unused /session endpoint; client uses /token to create ephemeral keys.

// API route for ephemeral token generation
app.get("/token", async (req, res) => {
  try {
    const response = await fetch(
      "https://api.openai.com/v1/realtime/client_secrets",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: sessionConfig,
      },
    );

    const data = await response.json();
    res.json(data);
  } catch (error) {
    console.error("Token generation error:", error);
    res.status(500).json({ error: "Failed to generate token" });
  }
});

// Render the React client
app.use("*", async (req, res, next) => {
  const url = req.originalUrl;

  try {
    const template = await vite.transformIndexHtml(
      url,
      fs.readFileSync("./client/index.html", "utf-8"),
    );
    const { render } = await vite.ssrLoadModule("./client/entry-server.jsx");
    const appHtml = await render(url);
    const html = template.replace(`<!--ssr-outlet-->`, appHtml?.html);
    res.status(200).set({ "Content-Type": "text/html" }).end(html);
  } catch (e) {
    vite.ssrFixStacktrace(e);
    next(e);
  }
});

app.listen(port, () => {
  console.log(`Express server running on *:${port}`);
});
