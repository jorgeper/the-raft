import chalk from "chalk";
import ora, { type Ora } from "ora";
import { Marked } from "marked";
import { markedTerminal } from "marked-terminal";
import type { AgentEvent } from "./types.js";

const marked = new Marked(markedTerminal() as object);

const INDENT = "  ";
const TOOL_BORDER = chalk.dim("  │ ");

let activeSpinner: Ora | null = null;
let responseBuffer = "";
let flushedLength = 0;

function stopSpinner(symbol?: string, text?: string): void {
  if (activeSpinner) {
    if (symbol && text) {
      activeSpinner.stopAndPersist({ symbol, text });
    } else {
      activeSpinner.stop();
    }
    activeSpinner = null;
  }
}

function startSpinner(text: string): void {
  stopSpinner();
  activeSpinner = ora({ text, indent: 2 }).start();
}

function flushResponseBuffer(): void {
  if (responseBuffer) {
    // Render the full markdown and write only what hasn't been written yet
    const rendered = marked.parse(responseBuffer) as string;
    const indented = rendered
      .split("\n")
      .map((line) => INDENT + line)
      .join("\n");
    const remaining = indented.slice(flushedLength);
    if (remaining) {
      process.stdout.write(remaining);
    }
    responseBuffer = "";
    flushedLength = 0;
  }
}

export function renderEvent(event: AgentEvent, verbose: boolean): void {
  switch (event.type) {
    case "agent.thinking": {
      flushResponseBuffer();
      startSpinner(chalk.dim.italic("Thinking..."));
      break;
    }

    case "agent.message": {
      stopSpinner();
      const text = event.content
        ?.filter((b) => b.type === "text" && b.text)
        .map((b) => b.text)
        .join("") ?? "";

      if (text) {
        responseBuffer += text;
        // Render the full buffer, but only write the new delta
        const rendered = marked.parse(responseBuffer) as string;
        const indented = rendered
          .split("\n")
          .map((line) => INDENT + line)
          .join("\n");
        const delta = indented.slice(flushedLength);
        if (delta) {
          process.stdout.write(delta);
          flushedLength = indented.length;
        }
      }
      break;
    }

    case "agent.tool_use":
    case "agent.mcp_tool_use": {
      flushResponseBuffer();
      const toolName = event.name ?? "tool";
      startSpinner(chalk.cyan(toolName) + chalk.dim("..."));
      break;
    }

    case "agent.tool_result":
    case "agent.mcp_tool_result": {
      const toolName = (event as { name?: string }).name ?? "tool";
      const elapsed = "";
      stopSpinner(
        chalk.green("✓"),
        chalk.cyan(toolName) + (elapsed ? chalk.dim(` (${elapsed})`) : "")
      );

      if (verbose && event.output) {
        const output = typeof event.output === "string"
          ? event.output
          : JSON.stringify(event.output, null, 2);
        const lines = output.split("\n");
        for (const line of lines) {
          console.log(TOOL_BORDER + chalk.dim(line));
        }
      }
      break;
    }

    case "session.status_running": {
      // Agent is working — spinner should already be active
      break;
    }

    case "session.status_idle": {
      flushResponseBuffer();
      stopSpinner();
      break;
    }

    case "session.status_terminated": {
      flushResponseBuffer();
      stopSpinner();
      console.log();
      console.log(INDENT + chalk.dim("Session ended."));
      break;
    }

    case "session.error": {
      flushResponseBuffer();
      stopSpinner();
      const msg = event.error?.message ?? "Unknown error";
      console.log();
      console.log(INDENT + chalk.red("Error: " + msg));
      break;
    }

    case "span.model_request_start": {
      // Could show timing info in verbose mode later
      break;
    }

    case "span.model_request_end": {
      if (verbose && event.model_usage) {
        const { input_tokens, output_tokens } = event.model_usage;
        console.log(
          INDENT +
            chalk.dim(`tokens: ${input_tokens} in / ${output_tokens} out`)
        );
      }
      break;
    }

    default: {
      // Unknown event type — ignore silently
      break;
    }
  }
}

export function renderWelcome(version: string, resumed: boolean): void {
  console.log();
  console.log(
    INDENT +
      chalk.bold("Hank CLI") +
      chalk.dim(` v${version}`) +
      chalk.dim(resumed ? " — session resumed" : " — new session")
  );
  console.log();
}

export function renderPrompt(): void {
  process.stdout.write(chalk.bold.blue("> "));
}

export function renderConnecting(): void {
  startSpinner("Connecting to Hank...");
}

export function renderConnected(): void {
  stopSpinner(chalk.green("✓"), chalk.dim("Connected"));
}

export function renderSending(): void {
  startSpinner(chalk.dim("Sending..."));
}

export function renderError(message: string): void {
  flushResponseBuffer();
  stopSpinner();
  console.log(INDENT + chalk.red(message));
}

export function renderGoodbye(): void {
  stopSpinner();
  console.log();
  console.log(INDENT + chalk.dim("Goodbye."));
  console.log();
}
