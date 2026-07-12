export interface EngineChoice {
  engine: string;
  model: string;
}

export interface EngineInfo {
  stt: EngineChoice;
  diarization: EngineChoice;
}

export interface Speaker {
  id: string;
  name: string;
  color: string;
  auto_named: boolean;
  embedding?: number[];
}

export type Item =
  | {
      type: "utterance";
      id: string;
      speaker_id: string;
      text: string;
      t_start: number;
      t_end: number;
      wall_time: string;
    }
  | {
      type: "image";
      id: string;
      file: string;
      wall_time: string;
      caption: string | null;
    };

export interface Conversation {
  schema_version: number;
  id: string;
  title: string;
  started_at: string | null;
  ended_at: string | null;
  engine: EngineInfo;
  speakers: Speaker[];
  items: Item[];
}

export type EngineStatus = "idle" | "recording" | "paused" | "stopped";

export const SPEAKER_PALETTE = [
  "#5B8DEF",
  "#E0716C",
  "#5BBD8B",
  "#C99A3C",
  "#9B7FE0",
  "#4FB3C6",
  "#D77BAE",
  "#8A9663",
];
