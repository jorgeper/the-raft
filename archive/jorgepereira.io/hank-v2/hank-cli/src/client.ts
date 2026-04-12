import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import { debug } from "./debug.js";
import type { AgentEvent } from "./types.js";

export interface HankClientConfig {
  apiKey: string;
  agentId: string;
  environmentId: string;
  githubToken: string;
}

export class HankClient {
  private client: Anthropic;
  private agentId: string;
  private environmentId: string;
  private githubToken: string;

  constructor(config: HankClientConfig) {
    this.client = new Anthropic({ apiKey: config.apiKey });
    this.agentId = config.agentId;
    this.environmentId = config.environmentId;
    this.githubToken = config.githubToken;
  }

  private async uploadSecretsEnv(): Promise<string> {
    const tmpPath = path.join(os.tmpdir(), `hank-secrets-${Date.now()}.env`);
    fs.writeFileSync(tmpPath, `GITHUB_TOKEN=${this.githubToken}\n`);
    debug("client", "Wrote temp secrets file", { path: tmpPath });

    try {
      debug("client", "Uploading secrets.env via files API");
      const envFile = await this.client.beta.files.upload({
        file: fs.createReadStream(tmpPath),
      });
      debug("client", "File uploaded", { fileId: envFile.id });
      return envFile.id;
    } finally {
      fs.unlinkSync(tmpPath);
    }
  }

  async createSession(): Promise<string> {
    debug("client", "Creating session", {
      agentId: this.agentId,
      environmentId: this.environmentId,
    });

    const envFileId = await this.uploadSecretsEnv();

    const session = await this.client.beta.sessions.create({
      agent: this.agentId,
      environment_id: this.environmentId,
      resources: [
        {
          type: "file",
          file_id: envFileId,
          mount_path: "/workspace/.env",
        } as any,
      ],
    });
    debug("client", "Session created", { sessionId: session.id });
    return session.id;
  }

  async *sendMessage(
    sessionId: string,
    message: string
  ): AsyncGenerator<AgentEvent> {
    debug("client", "Opening SSE stream", { sessionId });
    const stream = await this.client.beta.sessions.events.stream(sessionId);
    debug("client", "Stream opened, sending message", {
      sessionId,
      messageLength: message.length,
    });

    await this.client.beta.sessions.events.send(sessionId, {
      events: [
        {
          type: "user.message",
          content: [{ type: "text", text: message }],
        },
      ],
    });
    debug("client", "Message sent, waiting for events");

    for await (const event of stream) {
      debug("event", event.type, event);
      yield event as unknown as AgentEvent;

      if (
        event.type === "session.status_idle" ||
        event.type === "session.status_terminated"
      ) {
        debug("client", "Stream ended", { reason: event.type });
        break;
      }
    }
  }

  async checkSession(sessionId: string): Promise<boolean> {
    debug("client", "Checking session", { sessionId });
    try {
      const session = await this.client.beta.sessions.retrieve(sessionId);
      debug("client", "Session status", { status: session.status });
      return session.status !== "terminated";
    } catch (err) {
      debug("client", "Session check failed", {
        error: err instanceof Error ? err.message : String(err),
      });
      return false;
    }
  }
}
