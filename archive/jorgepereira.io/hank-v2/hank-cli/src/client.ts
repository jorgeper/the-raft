import Anthropic from "@anthropic-ai/sdk";
import type { AgentEvent } from "./types.js";

export interface HankClientConfig {
  apiKey: string;
  agentId: string;
  environmentId: string;
  githubToken: string;
  githubRepo: string;
}

export class HankClient {
  private client: Anthropic;
  private agentId: string;
  private environmentId: string;
  private githubToken: string;
  private githubRepo: string;

  constructor(config: HankClientConfig) {
    this.client = new Anthropic({ apiKey: config.apiKey });
    this.agentId = config.agentId;
    this.environmentId = config.environmentId;
    this.githubToken = config.githubToken;
    this.githubRepo = config.githubRepo;
  }

  async createSession(): Promise<string> {
    const session = await (this.client as any).beta.sessions.create({
      agent: this.agentId,
      environment_id: this.environmentId,
      container: {
        environment: {
          GITHUB_TOKEN: this.githubToken,
          GITHUB_REPO: this.githubRepo,
        },
      },
    });
    return session.id;
  }

  async *sendMessage(
    sessionId: string,
    message: string
  ): AsyncGenerator<AgentEvent> {
    // Open the SSE stream
    const stream = await (this.client as any).beta.sessions.events.stream(
      sessionId
    );

    // Send the user message
    await (this.client as any).beta.sessions.events.send(sessionId, {
      events: [
        {
          type: "user.message",
          content: [{ type: "text", text: message }],
        },
      ],
    });

    // Yield events as they arrive
    for await (const event of stream) {
      yield event as AgentEvent;

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
      const session = await (this.client as any).beta.sessions.retrieve(
        sessionId
      );
      // Session exists and is not terminated
      return session.status !== "terminated";
    } catch {
      return false;
    }
  }
}
