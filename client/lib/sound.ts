"use client";

import { useSyncExternalStore } from "react";

/**
 * Optional payment sounds: a soft rising chime when a payment settles, a low
 * note when one fails. Off by default; the choice is remembered per browser.
 * Tones are synthesised (no audio files), and the AudioContext is only created
 * from the click that turns sound on, as browsers require.
 */
const KEY = "gandiva:sound";
const listeners = new Set<() => void>();
let enabled: boolean | null = null;
let ctx: AudioContext | null = null;

function read(): boolean {
  if (enabled === null) {
    try {
      enabled = localStorage.getItem(KEY) === "on";
    } catch {
      enabled = false;
    }
  }
  return enabled;
}

export function setSoundEnabled(on: boolean) {
  enabled = on;
  try {
    localStorage.setItem(KEY, on ? "on" : "off");
  } catch {}
  if (on) {
    ctx ??= new AudioContext();
    void ctx.resume();
  }
  listeners.forEach((l) => l());
}

export function useSoundEnabled() {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    read,
    () => false,
  );
}

function tone(freq: number, at: number, length: number, gain: number) {
  if (!ctx) return;
  const osc = ctx.createOscillator();
  const amp = ctx.createGain();
  osc.type = "sine";
  osc.frequency.value = freq;
  const t = ctx.currentTime + at;
  amp.gain.setValueAtTime(0, t);
  amp.gain.linearRampToValueAtTime(gain, t + 0.01);
  amp.gain.exponentialRampToValueAtTime(0.0001, t + length);
  osc.connect(amp).connect(ctx.destination);
  osc.start(t);
  osc.stop(t + length + 0.02);
}

function ready() {
  if (!read()) return false;
  // Remembered "on" from an earlier visit: audio may only start after the
  // person has interacted with the page, so stay silent until then.
  if (!ctx) {
    if (!navigator.userActivation?.hasBeenActive) return false;
    ctx = new AudioContext();
  }
  if (ctx.state !== "running") void ctx.resume();
  return ctx.state === "running";
}

export function playSettled() {
  if (!ready()) return;
  tone(880, 0, 0.18, 0.08);
  tone(1318.5, 0.08, 0.28, 0.07);
}

export function playFailed() {
  if (!ready()) return;
  tone(220, 0, 0.32, 0.09);
}
