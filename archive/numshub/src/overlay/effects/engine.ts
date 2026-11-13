// Drives one EffectRenderer on a DPR-aware canvas (SPEC6 FR-A1).
// rAF pauses when stop() is called (overlay hidden) and the engine passes
// reducedMotion through so renderers can calm themselves.

import type { EffectColors, EffectFrame, EffectRenderer } from "./types";
import { getEffect } from "./index";
import { clamp01 } from "./types";

const HISTORY_CAP = 96;

export class EffectEngine {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D | null;
  private renderer: EffectRenderer | null = null;
  private raf = 0;
  private running = false;
  private startTs = 0;
  private lastTs = 0;
  private level = 0;
  private levels: number[] = [];
  private colors: EffectColors = { primary: "", accent: "", glow: "" };
  private reducedMotion: boolean;
  private width = 0;
  private height = 0;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.reducedMotion =
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  }

  /** Resolve theme colors from CSS variables on (an ancestor of) the canvas. */
  refreshColors() {
    const style = getComputedStyle(this.canvas);
    this.colors = {
      primary: style.getPropertyValue("--nh-fx-primary").trim() || style.color,
      accent: style.getPropertyValue("--nh-fx-accent").trim() || style.color,
      glow: style.getPropertyValue("--nh-fx-glow").trim() || style.color,
    };
  }

  setEffect(id: string) {
    this.renderer?.dispose();
    this.renderer = getEffect(id).create();
    this.initRenderer();
  }

  private initRenderer() {
    if (!this.ctx || !this.renderer) return;
    const rect = this.canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    this.width = Math.max(1, Math.round(rect.width));
    this.height = Math.max(1, Math.round(rect.height));
    this.canvas.width = this.width * dpr;
    this.canvas.height = this.height * dpr;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.renderer.init(this.ctx, this.width, this.height);
  }

  feed(level: number) {
    this.level = clamp01(level);
    this.levels.push(this.level);
    if (this.levels.length > HISTORY_CAP) {
      this.levels.splice(0, this.levels.length - HISTORY_CAP);
    }
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.startTs = performance.now();
    this.lastTs = this.startTs;
    this.refreshColors();
    this.initRenderer();
    const tick = (ts: number) => {
      if (!this.running) return;
      const frame: EffectFrame = {
        level: this.level,
        levels: this.levels,
        time: (ts - this.startTs) / 1000,
        dt: Math.min(0.1, (ts - this.lastTs) / 1000),
        colors: this.colors,
        reducedMotion: this.reducedMotion,
        width: this.width,
        height: this.height,
      };
      this.lastTs = ts;
      if (this.ctx && this.renderer) {
        this.ctx.clearRect(0, 0, this.width, this.height);
        this.renderer.render(this.ctx, frame);
      }
      // Levels decay between mic events so silence visibly settles.
      this.level *= 0.92;
      this.raf = requestAnimationFrame(tick);
    };
    this.raf = requestAnimationFrame(tick);
  }

  stop() {
    this.running = false;
    cancelAnimationFrame(this.raf);
    this.level = 0;
    this.levels = [];
  }

  dispose() {
    this.stop();
    this.renderer?.dispose();
    this.renderer = null;
  }
}
