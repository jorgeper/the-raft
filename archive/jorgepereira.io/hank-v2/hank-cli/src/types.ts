export interface HankConfig {
  apiKey?: string;
  agentId?: string;
  environmentId?: string;
  githubToken?: string;
  githubRepo?: string;
}

export interface HankState {
  sessionId?: string;
}

export type AgentEventType =
  | "agent.thinking"
  | "agent.message"
  | "agent.tool_use"
  | "agent.tool_result"
  | "agent.mcp_tool_use"
  | "agent.mcp_tool_result"
  | "session.status_running"
  | "session.status_idle"
  | "session.status_terminated"
  | "session.error"
  | "span.model_request_start"
  | "span.model_request_end";

export interface AgentEvent {
  type: AgentEventType | string;
  content?: Array<{ type: string; text?: string }>;
  name?: string;
  input?: unknown;
  output?: unknown;
  error?: { message: string };
  model_usage?: { input_tokens: number; output_tokens: number };
  [key: string]: unknown;
}

export interface CliOptions {
  new?: boolean;
  verbose?: boolean;
}
