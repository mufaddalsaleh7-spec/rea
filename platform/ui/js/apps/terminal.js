import { api } from "../api.js";
import { clear, el } from "../dom.js";

/**
 * Terminal.
 *
 * The terminal is deliberately *not* a shell: it splits a line into a command
 * and arguments (honouring quotes), then asks the platform process host to run
 * an allowlisted executable. That means pipes, redirection and globbing do not
 * exist, and the command surface is exactly what the platform approved.
 */

const BUILTINS = {
  help: "Built-ins: help, clear, open <path>, caps, history",
  clear: "Clear the transcript",
  open: "Open a file in the editor",
  caps: "Show granted capabilities and the command allowlist",
  history: "Show recent commands",
};

export const renderTerminal = (body, ctx) => {
  const output = el("div", {
    class: "terminal-output",
    role: "log",
    "aria-live": "polite",
  });
  const input = el("input", {
    class: "terminal-input",
    type: "text",
    spellcheck: "false",
    autocomplete: "off",
    "aria-label": "Terminal command",
    placeholder: "Type a command, or help",
  });
  const promptRow = el("div", { class: "terminal-input-row" }, [
    el("span", { class: "terminal-prompt", text: "reaos ›" }),
    input,
  ]);
  const shell = el("div", { class: "terminal" }, [output, promptRow]);
  body.append(el("div", { class: "app" }, [shell]));

  const history = [];
  let historyIndex = -1;
  let busy = false;

  const write = (text, kind = "output") => {
    for (const line of String(text).replace(/\n$/u, "").split("\n")) {
      output.append(
        el("div", { class: "terminal-line", dataset: { kind }, text: line }),
      );
    }
    output.scrollTop = output.scrollHeight;
  };

  const tokenise = (line) => {
    const tokens = [];
    let current = "";
    let quote = null;
    for (const character of line) {
      if (quote !== null) {
        if (character === quote) quote = null;
        else current += character;
      } else if (character === '"' || character === "'") {
        quote = character;
      } else if (/\s/u.test(character)) {
        if (current.length > 0) tokens.push(current);
        current = "";
      } else {
        current += character;
      }
    }
    if (current.length > 0) tokens.push(current);
    return tokens;
  };

  const printCaps = async () => {
    const response = await api.capabilities();
    if (!response.ok) {
      write(response.error.message, "error");
      return;
    }
    write(
      `capabilities: ${response.data.granted.join(", ") || "none"}`,
      "meta",
    );
    write(`allowlist: ${response.data.allowedCommands.join(" ")}`, "meta");
  };

  const run = async (line) => {
    const trimmed = line.trim();
    if (trimmed.length === 0) return;
    history.push(trimmed);
    historyIndex = history.length;
    write(`reaos › ${trimmed}`, "command");

    const [command, ...args] = tokenise(trimmed);
    if (command === undefined) return;

    if (command in BUILTINS) {
      if (command === "help") {
        for (const [name, description] of Object.entries(BUILTINS))
          write(`${name.padEnd(9)} ${description}`);
        write(
          "Everything else is an allowlisted host command, for example: ls, cat Documents/Welcome.md, uname -a",
          "meta",
        );
      } else if (command === "clear") {
        clear(output);
      } else if (command === "caps") {
        await printCaps();
      } else if (command === "history") {
        for (const entry of history.slice(-20)) write(`  ${entry}`, "meta");
      } else if (command === "open") {
        const target = args[0];
        if (target === undefined) write("usage: open <path>", "error");
        else
          ctx.openFile(
            target.startsWith("/") ? target : `/Documents/${target}`,
          );
      }
      return;
    }

    busy = true;
    promptRow.dataset.busy = "true";
    const response = await api.exec(command, args, 8000);
    busy = false;
    delete promptRow.dataset.busy;
    if (!response.ok) {
      write(response.error.message, "error");
      if (
        response.error.code === "PERMISSION_DENIED" &&
        String(response.error.message).includes("process:spawn")
      ) {
        write(
          "Enable command execution in Settings → Privacy & security.",
          "notice",
        );
      }
      return;
    }
    if (response.data.stdout.length > 0) write(response.data.stdout);
    if (response.data.stderr.length > 0) write(response.data.stderr, "error");
    write(
      `${response.data.timedOut ? "timed out after" : "exit"} ${response.data.timedOut ? "" : (response.data.exitCode ?? "signal")} ${response.data.timedOut ? "the limit" : ""} · ${response.data.durationMs} ms${response.data.truncated ? " · output truncated" : ""}`,
      "meta",
    );
  };

  const renderLocked = () => {
    clear(shell);
    const unlock = async () => {
      const response = await api.patchSettings({ terminalEnabled: true });
      if (!response.ok) {
        write(response.error.message, "error");
        return;
      }
      ctx.applySettings(response.data);
      ctx.notify(
        "Terminal enabled",
        "Command execution is now allowed.",
        "success",
      );
      renderUnlocked();
    };
    shell.append(
      el("div", { class: "terminal-locked" }, [
        el("h3", {
          class: "section-title",
          style: "font-size:15px;color:#eef2ff",
          text: "Command execution is off",
        }),
        el("p", {
          class: "setting-hint",
          style: "color:#a8b0c6;max-width:52ch",
          text: "For safety the Terminal cannot start processes until you grant the `process:spawn` capability. Only allowlisted commands run, they never pass through a shell, and every child is killed when its timeout expires or ReaOS stops.",
        }),
        el("div", { style: "display:flex;gap:8px" }, [
          el("button", {
            class: "toolbar-button",
            dataset: { primary: "true" },
            text: "Enable in Settings",
            on: {
              click: () => ctx.openApp("settings", { section: "privacy" }),
            },
          }),
          el("button", {
            class: "toolbar-button",
            text: "Enable now",
            on: { click: () => void unlock() },
          }),
        ]),
      ]),
    );
  };

  const renderUnlocked = () => {
    clear(shell);
    shell.append(output, promptRow);
    write(
      "ReaOS Terminal — allowlisted commands only. Type help for built-ins.",
      "meta",
    );
    input.focus();
  };

  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !busy) {
      const value = input.value;
      input.value = "";
      void run(value);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      if (history.length === 0) return;
      historyIndex = Math.max(0, historyIndex - 1);
      input.value = history[historyIndex] ?? "";
    } else if (event.key === "ArrowDown") {
      event.preventDefault();
      historyIndex = Math.min(history.length, historyIndex + 1);
      input.value = history[historyIndex] ?? "";
    } else if (event.key === "l" && event.ctrlKey) {
      event.preventDefault();
      clear(output);
    }
  });

  const onSettings = ctx.onSettingsChanged?.((next) => {
    if (next.terminalEnabled) renderUnlocked();
    else renderLocked();
  });
  const onPermissions = ctx.onCapabilitiesChanged?.(() => {
    if (ctx.capabilities().includes("process:spawn")) renderUnlocked();
    else renderLocked();
  });
  ctx.win.onClose = () => {
    onSettings?.();
    onPermissions?.();
  };

  if (ctx.capabilities().includes("process:spawn")) renderUnlocked();
  else renderLocked();
};
