import readline from "node:readline";
import { Command } from "commander";
import chalk from "chalk";
import { HankClient } from "./client.js";
import { initDebug, debug, getLogFile } from "./debug.js";
import { ensureAgentConfig, loadState, saveState, configShow, configSet } from "./config.js";
import {
  renderEvent,
  renderWelcome,
  renderPrompt,
  renderConnecting,
  renderConnected,
  renderSending,
  renderError,
  renderGoodbye,
} from "./render.js";
import type { CliOptions } from "./types.js";

const VERSION = "0.1.0";

const EXIT_COMMANDS = new Set(["exit", "quit", "bye"]);

// Handle Ctrl+C gracefully
process.on("SIGINT", () => {
  debug("session", "SIGINT received");
  renderGoodbye();
  process.exit(0);
});

function setupDebug(): void {
  const logPath = initDebug();
  console.log(chalk.dim(`  Debug log: ${logPath}`));
}

async function getOrCreateSession(
  client: HankClient,
  forceNew: boolean
): Promise<{ sessionId: string; resumed: boolean }> {
  const state = loadState();

  // Try to resume existing session
  if (!forceNew && state.sessionId) {
    debug("session", "Attempting to resume session", { sessionId: state.sessionId });
    const alive = await client.checkSession(state.sessionId);
    if (alive) {
      debug("session", "Session resumed");
      return { sessionId: state.sessionId, resumed: true };
    }
    debug("session", "Previous session is dead, creating new one");
  }

  // Create a new session
  renderConnecting();
  const sessionId = await client.createSession();
  saveState({ sessionId });
  renderConnected();
  debug("session", "New session ready", { sessionId });

  return { sessionId, resumed: false };
}

async function handleMessage(
  client: HankClient,
  sessionId: string,
  message: string,
  verbose: boolean
): Promise<void> {
  debug("session", "User message", { message });
  renderSending();

  for await (const event of client.sendMessage(sessionId, message)) {
    renderEvent(event, verbose);
  }
  console.log();
}

async function runRepl(options: CliOptions): Promise<void> {
  if (options.debug) setupDebug();
  debug("session", "Starting REPL", { options });

  const config = await ensureAgentConfig();
  const client = new HankClient(config);

  const { sessionId, resumed } = await getOrCreateSession(
    client,
    options.new ?? false
  );

  renderWelcome(VERSION, resumed);

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: true,
  });

  const promptForInput = (): void => {
    renderPrompt();
  };

  promptForInput();

  rl.on("line", async (line) => {
    const message = line.trim();
    if (!message) {
      promptForInput();
      return;
    }

    if (EXIT_COMMANDS.has(message.toLowerCase())) {
      rl.close();
      return;
    }

    // Pause readline while processing
    rl.pause();

    try {
      await handleMessage(client, sessionId, message, options.verbose ?? false);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Something went wrong";
      debug("session", "Error handling message", { error: msg });
      renderError(msg);
    }

    promptForInput();
    rl.resume();
  });

  rl.on("close", () => {
    debug("session", "REPL closed");
    renderGoodbye();
    process.exit(0);
  });
}

async function runOneShot(
  message: string,
  options: CliOptions
): Promise<void> {
  if (options.debug) setupDebug();
  debug("session", "One-shot mode", { message });

  const config = await ensureAgentConfig();
  const client = new HankClient(config);

  const { sessionId } = await getOrCreateSession(
    client,
    options.new ?? false
  );

  try {
    await handleMessage(client, sessionId, message, options.verbose ?? false);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Something went wrong";
    debug("session", "Error in one-shot", { error: msg });
    renderError(msg);
    process.exit(1);
  }
}

export function createProgram(): Command {
  const program = new Command();

  program
    .name("hank")
    .version(VERSION)
    .description("CLI for talking to Hank, a personal AI assistant")
    .option("-n, --new", "Start a fresh session")
    .option("-v, --verbose", "Show full tool output")
    .option("-d, --debug", "Write debug logs to ~/.config/hank/logs/")
    .argument("[message]", "Send a one-shot message")
    .action(async (message: string | undefined, options: CliOptions) => {
      if (message) {
        await runOneShot(message, options);
      } else {
        await runRepl(options);
      }
    });

  const config = program.command("config").description("Manage configuration");

  config
    .command("show")
    .description("Show current configuration")
    .action(() => {
      configShow();
    });

  config
    .command("set <key> <value>")
    .description("Set a configuration value")
    .action((key: string, value: string) => {
      configSet(key, value);
    });

  return program;
}
