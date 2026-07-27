import { initSentry } from "./lib/sentry";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";

// Initialise Sentry before the React tree mounts so all render errors are captured
initSentry();

createRoot(document.getElementById("root")!).render(<App />);

