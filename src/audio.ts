/**
 * Procedural Web Audio Synth & Music Engine (`src/audio.ts`)
 * Zero external audio files needed — instant startup and tiny bundle size.
 * Strictly obeys YouTube Playables `onAudioEnabledChange` and `onPause` / `onResume` rules.
 */

// D Minor Pentatonic / Synthwave scale frequencies (Hz)
const BASS_PATTERN = [
  73.42, 73.42, 146.83, 73.42, // D2, D2, D3, D2
  87.31, 87.31, 174.61, 87.31, // F2, F2, F3, F2
  98.00, 98.00, 196.00, 98.00, // G2, G2, G3, G2
  65.41, 65.41, 130.81, 82.41, // C2, C2, C3, E2
];

const ARP_PATTERN = [
  293.66, 349.23, 440.00, 587.33, // D4, F4, A4, D5
  293.66, 349.23, 523.25, 440.00, // D4, F4, C5, A4
  392.00, 440.00, 587.33, 698.46, // G4, A4, D5, F5
  261.63, 329.63, 392.00, 523.25, // C4, E4, G4, C5
];

export class SynthAudio {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private enabled = true;
  private paused = false;

  private stepTimer = 0;
  private stepIndex = 0;

  constructor() {
    // Unlock AudioContext on first user interaction anywhere in the window
    const unlockHandler = () => {
      this.unlock();
    };
    window.addEventListener('pointerdown', unlockHandler, { passive: true });
    window.addEventListener('keydown', unlockHandler, { passive: true });
  }

  public setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    this.syncContextState();
  }

  public setPaused(paused: boolean): void {
    this.paused = paused;
    this.syncContextState();
  }

  private ensureContext(): AudioContext | null {
    if (!this.ctx) {
      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AudioCtx) return null;
      this.ctx = new AudioCtx();
      this.masterGain = this.ctx.createGain();
      this.masterGain.gain.value = this.enabled && !this.paused ? 0.85 : 0;
      this.masterGain.connect(this.ctx.destination);
    }
    return this.ctx;
  }

  private syncContextState(): void {
    if (!this.ctx || !this.masterGain) return;
    const now = this.ctx.currentTime;
    if (this.paused || !this.enabled) {
      this.masterGain.gain.setTargetAtTime(0, now, 0.015);
      if (this.ctx.state === 'running') {
        void this.ctx.suspend().catch(() => {});
      }
    } else {
      this.masterGain.gain.setTargetAtTime(0.85, now, 0.015);
      if (this.ctx.state !== 'running') {
        void this.ctx.resume().catch(() => {});
      }
    }
  }

  /**
   * Initializes or unlocks the AudioContext on user gesture (if audio is enabled and not paused).
   */
  public unlock(): void {
    if (!this.enabled || this.paused) return;
    const ctx = this.ensureContext();
    if (!ctx) return;
    if (ctx.state !== 'running') {
      void ctx.resume().catch(() => {});
    }
    if (this.masterGain) {
      this.masterGain.gain.setValueAtTime(0.85, ctx.currentTime);
    }
  }

  private getOutputNode(): { ctx: AudioContext; out: AudioNode } | null {
    if (!this.enabled || this.paused) return null;
    const ctx = this.ensureContext();
    if (!ctx || !this.masterGain) return null;
    if (ctx.state !== 'running') {
      void ctx.resume().catch(() => {});
    }
    return { ctx, out: this.masterGain };
  }

  /**
   * Advances the procedural synthwave soundtrack during active gameplay.
   */
  public updateMusic(dt: number, isPlaying: boolean, speedRatio: number): void {
    if (!this.enabled || this.paused || !isPlaying) return;
    if (!this.ctx || this.ctx.state !== 'running') return;

    // Tempo scales from ~125 BPM to ~155 BPM as runner accelerates
    const stepDuration = Math.max(0.095, 0.12 - speedRatio * 0.025);
    this.stepTimer += dt;

    if (this.stepTimer >= stepDuration) {
      this.stepTimer -= stepDuration;
      this.triggerSequencerStep(this.stepIndex, stepDuration);
      this.stepIndex = (this.stepIndex + 1) % BASS_PATTERN.length;
    }
  }

  private triggerSequencerStep(step: number, stepDuration: number): void {
    const audio = this.getOutputNode();
    if (!audio) return;
    const { ctx, out } = audio;
    const now = ctx.currentTime;

    // 1. Driving synth bassline
    const bassFreq = BASS_PATTERN[step % BASS_PATTERN.length];
    const bassOsc = ctx.createOscillator();
    const bassFilter = ctx.createBiquadFilter();
    const bassGain = ctx.createGain();

    bassOsc.type = 'sawtooth';
    bassOsc.frequency.setValueAtTime(bassFreq, now);

    bassFilter.type = 'lowpass';
    bassFilter.frequency.setValueAtTime(620, now);
    bassFilter.frequency.exponentialRampToValueAtTime(160, now + stepDuration * 0.9);

    bassGain.gain.setValueAtTime(0.11, now);
    bassGain.gain.exponentialRampToValueAtTime(0.001, now + stepDuration * 0.92);

    bassOsc.connect(bassFilter);
    bassFilter.connect(bassGain);
    bassGain.connect(out);

    bassOsc.start(now);
    bassOsc.stop(now + stepDuration);

    // 2. Plucky neon arpeggio on every step
    const arpFreq = ARP_PATTERN[step % ARP_PATTERN.length];
    const arpOsc = ctx.createOscillator();
    const arpGain = ctx.createGain();

    arpOsc.type = 'triangle';
    arpOsc.frequency.setValueAtTime(arpFreq, now);

    arpGain.gain.setValueAtTime(0.055, now);
    arpGain.gain.exponentialRampToValueAtTime(0.001, now + stepDuration * 0.75);

    arpOsc.connect(arpGain);
    arpGain.connect(out);

    arpOsc.start(now);
    arpOsc.stop(now + stepDuration * 0.8);
  }

  public playJump(isDoubleJump = false): void {
    const audio = this.getOutputNode();
    if (!audio) return;
    const { ctx, out } = audio;
    const now = ctx.currentTime;

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = isDoubleJump ? 'square' : 'triangle';
    const baseFreq = isDoubleJump ? 360 : 230;
    const endFreq = isDoubleJump ? 880 : 580;

    osc.frequency.setValueAtTime(baseFreq, now);
    osc.frequency.exponentialRampToValueAtTime(endFreq, now + 0.16);

    gain.gain.setValueAtTime(0.26, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.18);

    osc.connect(gain);
    gain.connect(out);

    osc.start(now);
    osc.stop(now + 0.18);
  }

  public playSlide(): void {
    const audio = this.getOutputNode();
    if (!audio) return;
    const { ctx, out } = audio;
    const now = ctx.currentTime;

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(280, now);
    osc.frequency.exponentialRampToValueAtTime(90, now + 0.14);

    gain.gain.setValueAtTime(0.18, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.15);

    osc.connect(gain);
    gain.connect(out);

    osc.start(now);
    osc.stop(now + 0.15);
  }

  public playPickup(combo = 1): void {
    const audio = this.getOutputNode();
    if (!audio) return;
    const { ctx, out } = audio;
    const now = ctx.currentTime;

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    const pitchBoost = Math.min(combo * 40, 400);
    osc.type = 'sine';
    osc.frequency.setValueAtTime(587.33 + pitchBoost, now);
    osc.frequency.setValueAtTime(880 + pitchBoost, now + 0.06);

    gain.gain.setValueAtTime(0.25, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.19);

    osc.connect(gain);
    gain.connect(out);

    osc.start(now);
    osc.stop(now + 0.19);
  }

  public playShield(gained: boolean): void {
    const audio = this.getOutputNode();
    if (!audio) return;
    const { ctx, out } = audio;
    const now = ctx.currentTime;

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = 'triangle';
    if (gained) {
      osc.frequency.setValueAtTime(330, now);
      osc.frequency.exponentialRampToValueAtTime(987.77, now + 0.25);
    } else {
      osc.frequency.setValueAtTime(740, now);
      osc.frequency.exponentialRampToValueAtTime(130, now + 0.28);
    }

    gain.gain.setValueAtTime(0.28, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.29);

    osc.connect(gain);
    gain.connect(out);

    osc.start(now);
    osc.stop(now + 0.29);
  }

  public playCrash(): void {
    const audio = this.getOutputNode();
    if (!audio) return;
    const { ctx, out } = audio;
    const now = ctx.currentTime;

    // Low impact boom
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(190, now);
    osc.frequency.exponentialRampToValueAtTime(34, now + 0.42);

    gain.gain.setValueAtTime(0.35, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.44);

    osc.connect(gain);
    gain.connect(out);

    osc.start(now);
    osc.stop(now + 0.44);
  }
}
