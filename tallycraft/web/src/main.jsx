import { createRoot } from "react-dom/client";
import App from "./App.jsx";
import "./styles.css";

const container = document.getElementById("root");
if (container === null) throw new Error("Missing #root");
createRoot(container).render(<App />);
