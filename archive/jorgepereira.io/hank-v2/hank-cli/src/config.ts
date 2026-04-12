import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import readline from "node:readline";
import chalk from "chalk";
import type { HankConfig, HankState } from "./types.js";

const CONFIG_DIR =
  process.env.XDG_CONFIG_HOME
    ? path.join(process.env.XDG_CONFIG_HOME, "hank")
    : path.join(os.homedir(), ".config", "hank");

const CONFIG_FILE = path.join(CONFIG_DIR, "config.json");
const STATE_FILE = path.join(CONFIG_DIR, "state.json");

// Each required config field with its metadata and setup instructions.
const CONFIG_FIELDS: Array<{
  key: keyof HankConfig;
  envVar?: string;
  label: string;
  hint: string;
  sensitive: boolean;
  description: string;
}> = [
  {
    key: "apiKey",
    envVar: "ANTHROPIC_API_KEY",
    label: "Anthropic API key",
    hint: "sk-ant-...",
    sensitive: true,
    description:
      "This authenticates you with the Anthropic API.\n" +
      "  Get one at: https://console.anthropic.com/settings/keys",
  },
  {
    key: "agentId",
    envVar: undefined,
    label: "Agent ID",
    hint: "agent_...",
    sensitive: false,
    description:
      "The ID of your Claude managed agent.\n" +
      "  Find it in the Anthropic console: console.anthropic.com > Agents > your agent > copy the ID.",
  },
  {
    key: "environmentId",
    envVar: undefined,
    label: "Environment ID",
    hint: "env_...",
    sensitive: false,
    description:
      "The container environment your agent runs in.\n" +
      "  Find it in the Anthropic console: console.anthropic.com > Environments tab > copy the ID.",
  },
  {
    key: "githubToken",
    envVar: "GITHUB_TOKEN",
    label: "GitHub token",
    hint: "ghp_...",
    sensitive: true,
    description:
      "A personal access token so the agent can read/write to your memory repo.\n" +
      "  Create one at: https://github.com/settings/tokens (needs repo access).",
  },
  {
    key: "githubRepo",
    envVar: "GITHUB_REPO",
    label: "GitHub repo URL",
    hint: "https://github.com/user/repo",
    sensitive: false,
    description:
      "The GitHub repo where Hank stores memories.\n" +
      "  This is passed to the agent's container as an environment variable.",
  },
];

function ensureConfigDir(): void {
  fs.mkdirSync(CONFIG_DIR, { recursive: true });
}

export function loadConfig(): HankConfig {
  try {
    const raw = fs.readFileSync(CONFIG_FILE, "utf-8");
    return JSON.parse(raw) as HankConfig;
  } catch {
    return {};
  }
}

export function saveConfig(config: HankConfig): void {
  ensureConfigDir();
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2) + "\n");
}

export function loadState(): HankState {
  try {
    const raw = fs.readFileSync(STATE_FILE, "utf-8");
    return JSON.parse(raw) as HankState;
  } catch {
    return {};
  }
}

export function saveState(state: HankState): void {
  ensureConfigDir();
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2) + "\n");
}

function mask(value: string): string {
  if (value.length <= 12) return "***";
  return value.slice(0, 8) + "..." + value.slice(-4);
}

function resolve(
  field: (typeof CONFIG_FIELDS)[number],
  config: HankConfig
): string | undefined {
  if (field.envVar && process.env[field.envVar]) {
    return process.env[field.envVar];
  }
  return config[field.key];
}

function ask(
  rl: readline.Interface,
  question: string
): Promise<string> {
  return new Promise((res) => {
    rl.question(question, (answer) => {
      res(answer.trim());
    });
  });
}

/**
 * Walks through all required config fields.
 * For each missing value, explains what it is and prompts the user.
 * Saves any new values to the config file at the end.
 */
export async function ensureAgentConfig(): Promise<{
  apiKey: string;
  agentId: string;
  environmentId: string;
  githubToken: string;
  githubRepo: string;
}> {
  const config = loadConfig();
  const missing = CONFIG_FIELDS.filter((f) => !resolve(f, config));

  if (missing.length > 0) {
    console.log();
    console.log(chalk.bold("  Hey, I'm Hank!") + chalk.dim(" Let's get me set up so we can chat."));
    console.log();

    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    let changed = false;

    for (const field of missing) {
      // Explain what this value is
      const lines = field.description.split("\n");
      for (const line of lines) {
        console.log(chalk.dim(`  ${line}`));
      }

      const envHint = field.envVar
        ? chalk.dim(` (or set ${field.envVar} env var)`)
        : "";

      const answer = await ask(rl, `  ${field.label}${envHint}: `);

      if (!answer) {
        rl.close();
        console.log();
        console.log(chalk.red(`  ${field.label} is required.`));
        console.log(
          chalk.dim(`  You can set it later: hank config set ${field.key} <value>`)
        );
        console.log();
        process.exit(1);
      }

      config[field.key] = answer;
      changed = true;
      console.log();
    }

    rl.close();

    if (changed) {
      saveConfig(config);
      console.log(chalk.green(`  Config saved to ${CONFIG_FILE}`));
      console.log();
    }
  }

  // Every field is now resolved (from env or config).
  const result: Record<string, string> = {};
  for (const field of CONFIG_FIELDS) {
    result[field.key] = resolve(field, config)!;
  }

  return result as {
    apiKey: string;
    agentId: string;
    environmentId: string;
    githubToken: string;
    githubRepo: string;
  };
}

export function configShow(): void {
  const config = loadConfig();
  const state = loadState();

  console.log();
  console.log(chalk.bold("  Configuration") + chalk.dim(` (${CONFIG_FILE})`));
  console.log();

  for (const field of CONFIG_FIELDS) {
    const configVal = config[field.key];
    const envVal = field.envVar ? process.env[field.envVar] : undefined;
    const label = `  ${field.key}:`.padEnd(20);

    if (configVal) {
      const display = field.sensitive ? mask(configVal) : configVal;
      console.log(`${label}${chalk.dim(display)}`);
    } else if (envVal) {
      const display = field.sensitive ? mask(envVal) : envVal;
      console.log(`${label}${chalk.dim(display)} ${chalk.dim("(from env)")}`);
    } else {
      console.log(`${label}${chalk.red("not set")}`);
    }
  }

  console.log();
  console.log(chalk.bold("  State") + chalk.dim(` (${STATE_FILE})`));
  console.log();
  console.log(
    `  sessionId:        ${state.sessionId ? chalk.dim(state.sessionId) : chalk.dim("none")}`
  );
  console.log();
}

export function configSet(key: string, value: string): void {
  const valid = CONFIG_FIELDS.map((f) => f.key);

  if (!valid.includes(key as keyof HankConfig)) {
    console.log(chalk.red(`  Unknown config key: ${key}`));
    console.log(`  Valid keys: ${valid.join(", ")}`);
    process.exit(1);
  }

  const field = CONFIG_FIELDS.find((f) => f.key === key)!;
  const config = loadConfig();
  config[field.key] = value;
  saveConfig(config);

  const display = field.sensitive ? mask(value) : value;
  console.log(chalk.green(`  ${key} = ${display}`));
}
