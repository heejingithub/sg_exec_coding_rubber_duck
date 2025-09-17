import { StrictMode } from "react";
import ReactDOM from "react-dom/client";
import App from "./components/App";
import "./base.css";
import { TranscriptProvider } from "./contexts/TranscriptContext";

ReactDOM.hydrateRoot(
  document.getElementById("root"),
  <StrictMode>
    <TranscriptProvider>
      <App />
    </TranscriptProvider>
  </StrictMode>,
);
