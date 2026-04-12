import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Anthropic from "@anthropic-ai/sdk";
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
    // Write token to a temp .env file
    const tmpPath = path.join(os.tmpdir(), `hank-secrets-${Date.now()}.env`);
    fs.writeFileSync(tmpPath, `GITHUB_TOKEN=${this.githubToken}\n`);

    try {
      // Upload via the files API
      const fileStream = fs.createReadStream(tmpPath);
      const envFile = await (this.client.beta.files as any).upload(
        { file: ["secrets.env", fileStream, "text/plain"] },
        { headers: { "anthropic-beta": "files-api-2025-04-14" } }
      );
      return envFile.id;
    } finally {
      fs.unlinkSync(tmpPath);
    }
  }

  async createSession(): Promise<string> {
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
    return session.id;
  }

  async *sendMessage(
    sessionId: string,
    message: string
  ): AsyncGenerator<AgentEvent> {
    // Open the SSE stream
    const stream = await this.client.beta.sessions.events.stream(sessionId);

    // Send the user message
    await this.client.beta.sessions.events.send(sessionId, {
      events: [
        {
          type: "user.message",
          content: [{ type: "text", text: message }],
        },
      ],
    });

    // Yield events as they arrive
    for await (const event of stream) {
      yield event as unknown as AgentEvent;

      // Stop iterating when the agent is done
      if (
        event.type === "session.status_idle" ||
        event.type === "session.status_terminated"
      ) {
        break;
      }
    }
  }

  async checkSession(sessionId: string): Promise<boolean> {
    try {
      const session = await this.client.beta.sessions.retrieve(sessionId);
      return session.status !== "terminated";
    } catch {
      return false;
    }
  }
}
