import { startShell } from "./shell.js";

/**
 * Shell entry point. Any boot failure is shown in the boot overlay instead of a
 * blank desktop, so a broken platform cannot be mistaken for a working one.
 */
try {
  await startShell();
} catch (cause) {
  const overlay = document.getElementById("boot-overlay");
  const message = document.getElementById("boot-message");
  if (overlay !== null) overlay.hidden = false;
  if (message !== null) {
    message.dataset.error = "true";
    message.textContent = `The desktop shell failed to start: ${cause instanceof Error ? cause.message : String(cause)}`;
  }
  console.error(cause);
}
