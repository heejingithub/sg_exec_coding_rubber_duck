import { StrictMode } from "react";
import { renderToString } from "react-dom/server";
import App from "./components/App";
import { TranscriptProvider } from "./contexts/TranscriptContext";

export function render() {
  const html = renderToString(
    <StrictMode>
      <TranscriptProvider>
        <App />
      </TranscriptProvider>
    </StrictMode>,
  );
  return { html };
}
