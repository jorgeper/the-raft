import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import { toFile } from "@anthropic-ai/sdk/uploads";
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
    const content = `GITHUB_TOKEN=${this.githubToken}\n`;
    debug("client", "Uploading secrets.env via files API");

    const file = await toFile(Buffer.from(content), "secrets.env", {
      type: "text/plain",
    });
    const envFile = await this.client.beta.files.upload({ file });
    debug("client", "File uploaded", { fileId: envFile.id });
    return envFile.id;
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
    });
    debug("client", "Session created", { sessionId: session.id });

    // Mount the secrets file — the API prepends /mnt/session/uploads/ to the path,
    // so ".env" becomes /mnt/session/uploads/.env
    debug("client", "Adding .env resource to session");
    const resource = await this.client.beta.sessions.resources.add(
      session.id,
      {
        type: "file",
        file_id: envFileId,
        mount_path: ".env",
      }
    );
    debug("client", "Resource added", {
      resourceId: resource.id,
      mountPath: resource.mount_path,
    });

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
