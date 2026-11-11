/**
 * YouTube Playables SDK Wrapper (`src/sdk.ts`)
 * Handles lifecycle events, pause/resume compliance, audio state synchronization,
 * cloud data persistence (with localStorage fallback), and high-score submission.
 */

export interface SaveState {
  highScore: number;
  totalShards: number;
  runsPlayed: number;
}

const LOCAL_STORAGE_KEY = 'neon_pulse_yt_save_v1';

const DEFAULT_SAVE: SaveState = {
  highScore: 0,
  totalShards: 0,
  runsPlayed: 0,
};

export class YTPlayablesSDK {
  private firstFrameSent = false;
  private gameReadySent = false;
  private pausedByHost = false;
  private audioEnabled = true;

  private pauseListeners: Array<() => void> = [];
  private resumeListeners: Array<() => void> = [];
  private audioListeners: Array<(enabled: boolean) => void> = [];

  constructor() {
    this.initSystemListeners();
  }

  /**
   * Returns true when running inside the official YouTube Playables environment or Test Suite.
   */
  public get isPlayablesEnv(): boolean {
    return typeof ytgame !== 'undefined' && Boolean(ytgame.IN_PLAYABLES_ENV);
  }

  public get sdkVersion(): string {
    return typeof ytgame !== 'undefined' && ytgame.SDK_VERSION ? ytgame.SDK_VERSION : 'local-dev';
  }

  public get isPaused(): boolean {
    return this.pausedByHost;
  }

  public get isAudioEnabled(): boolean {
    return this.audioEnabled;
  }

  /**
   * Allows toggling mute state manually during local play or via in-game HUD button.
   */
  public toggleAudio(): boolean {
    this.audioEnabled = !this.audioEnabled;
    for (const listener of this.audioListeners) {
      listener(this.audioEnabled);
    }
    return this.audioEnabled;
  }

  private initSystemListeners(): void {
    if (typeof ytgame === 'undefined') {
      return;
    }

    try {
      // Only query initial isAudioEnabled() when inside the real YT Playables host container;
      // outside the container, the SDK stub returns false/undefined by default.
      if (this.isPlayablesEnv && typeof ytgame.system?.isAudioEnabled === 'function') {
        const hostAudio = ytgame.system.isAudioEnabled();
        if (typeof hostAudio === 'boolean') {
          this.audioEnabled = hostAudio;
        }
      }

      ytgame.system?.onAudioEnabledChange?.((enabled: boolean) => {
        this.audioEnabled = Boolean(enabled);
        for (const listener of this.audioListeners) {
          listener(this.audioEnabled);
        }
      });

      ytgame.system?.onPause?.(() => {
        this.pausedByHost = true;
        for (const listener of this.pauseListeners) {
          listener();
        }
      });

      ytgame.system?.onResume?.(() => {
        this.pausedByHost = false;
        if (this.isPlayablesEnv && typeof ytgame.system?.isAudioEnabled === 'function') {
          const hostAudio = ytgame.system.isAudioEnabled();
          if (typeof hostAudio === 'boolean') {
            this.audioEnabled = hostAudio;
          }
        }
        for (const listener of this.resumeListeners) {
          listener();
        }
      });
    } catch (err) {
      console.warn('[YTPlayablesSDK] Failed to initialize system listeners:', err);
    }
  }

  public onPause(cb: () => void): void {
    this.pauseListeners.push(cb);
  }

  public onResume(cb: () => void): void {
    this.resumeListeners.push(cb);
  }

  public onAudioChange(cb: (enabled: boolean) => void): void {
    this.audioListeners.push(cb);
  }

  /**
   * Must be called immediately after the very first visual frame is drawn on the canvas.
   */
  public notifyFirstFrameReady(): void {
    if (this.firstFrameSent) return;
    this.firstFrameSent = true;
    try {
      ytgame?.game?.firstFrameReady?.();
    } catch (err) {
      console.warn('[YTPlayablesSDK] firstFrameReady error:', err);
    }
  }

  /**
   * Must be called once initialization/loading completes and the game is interactive.
   */
  public notifyGameReady(): void {
    if (this.gameReadySent) return;
    this.gameReadySent = true;
    try {
      ytgame?.game?.gameReady?.();
    } catch (err) {
      console.warn('[YTPlayablesSDK] gameReady error:', err);
    }
  }

  /**
   * Submits an integer score to YouTube Playables (`ytgame.engagement.sendScore`).
   */
  public async submitScore(score: number): Promise<void> {
    const cleanScore = Math.max(0, Math.floor(score));
    if (cleanScore <= 0) return;

    try {
      if (typeof ytgame !== 'undefined' && ytgame.engagement?.sendScore) {
        await ytgame.engagement.sendScore({ value: cleanScore });
      }
    } catch (err) {
      console.warn('[YTPlayablesSDK] sendScore error:', err);
    }
  }

  /**
   * Loads player progression from YouTube Cloud Storage with localStorage fallback.
   */
  public async loadGameData(): Promise<SaveState> {
    let parsed: Partial<SaveState> | null = null;

    // 1. Try YouTube Cloud Save first
    try {
      if (typeof ytgame !== 'undefined' && ytgame.game?.loadData) {
        const raw = await ytgame.game.loadData();
        if (raw && raw.trim().length > 0) {
          parsed = JSON.parse(raw) as Partial<SaveState>;
        }
      }
    } catch (err) {
      console.warn('[YTPlayablesSDK] loadData cloud fallback:', err);
    }

    // 2. Fallback to localStorage for local browser testing
    if (!parsed) {
      try {
        const localRaw = window.localStorage.getItem(LOCAL_STORAGE_KEY);
        if (localRaw) {
          parsed = JSON.parse(localRaw) as Partial<SaveState>;
        }
      } catch {
        // Ignore storage errors in restricted iframes
      }
    }

    return {
      highScore: typeof parsed?.highScore === 'number' ? Math.max(0, Math.floor(parsed.highScore)) : DEFAULT_SAVE.highScore,
      totalShards: typeof parsed?.totalShards === 'number' ? Math.max(0, Math.floor(parsed.totalShards)) : DEFAULT_SAVE.totalShards,
      runsPlayed: typeof parsed?.runsPlayed === 'number' ? Math.max(0, Math.floor(parsed.runsPlayed)) : DEFAULT_SAVE.runsPlayed,
    };
  }

  /**
   * Saves player progression to YouTube Cloud Storage and localStorage fallback.
   */
  public async saveGameData(state: SaveState): Promise<void> {
    const serialized = JSON.stringify({
      highScore: Math.max(0, Math.floor(state.highScore)),
      totalShards: Math.max(0, Math.floor(state.totalShards)),
      runsPlayed: Math.max(0, Math.floor(state.runsPlayed)),
    });

    try {
      window.localStorage.setItem(LOCAL_STORAGE_KEY, serialized);
    } catch {
      // Ignore localStorage quota/iframe errors
    }

    try {
      if (typeof ytgame !== 'undefined' && ytgame.game?.saveData) {
        await ytgame.game.saveData(serialized);
      }
    } catch (err) {
      console.warn('[YTPlayablesSDK] saveData error:', err);
    }
  }
}

