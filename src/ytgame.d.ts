/**
 * TypeScript declarations for the YouTube Playables SDK (game_api/v1)
 * Reference: https://developers.google.com/youtube/gaming/playables/reference/sdk
 */
declare namespace ytgame {
  const SDK_VERSION: string;
  const IN_PLAYABLES_ENV: boolean;

  namespace game {
    /**
     * Signals to YouTube that the first visual frame has been rendered.
     * Must be called as early as possible once canvas draws its initial frame.
     */
    function firstFrameReady(): void;

    /**
     * Signals to YouTube that the game is fully loaded and ready for user interaction.
     */
    function gameReady(): void;

    /**
     * Saves serialized game state string (up to 3 MiB) to YouTube Cloud Storage.
     */
    function saveData(data: string): Promise<void>;

    /**
     * Loads previously saved serialized game state string from YouTube Cloud Storage.
     */
    function loadData(): Promise<string>;
  }

  namespace engagement {
    interface ScorePayload {
      value: number;
    }

    /**
     * Submits the player's integer score to YouTube Playables.
     */
    function sendScore(score: ScorePayload): Promise<void>;
  }

  namespace system {
    /**
     * Returns whether game audio is currently enabled by the YouTube host.
     */
    function isAudioEnabled(): boolean;

    /**
     * Registers a callback invoked when the user toggles audio settings in YouTube.
     * Returns an unsubscribe function.
     */
    function onAudioEnabledChange(callback: (isAudioEnabled: boolean) => void): () => void;

    /**
     * Registers a callback invoked when YouTube pauses the game (e.g. overlay, backgrounding).
     * The game MUST stop its update loop and mute/suspend audio immediately.
     */
    function onPause(callback: () => void): () => void;

    /**
     * Registers a callback invoked when YouTube resumes the game from a paused state.
     */
    function onResume(callback: () => void): () => void;

    /**
     * Returns the user's BCP-47 language tag from the YouTube host.
     */
    function getLanguage(): Promise<string>;
  }

  namespace health {
    /**
     * Logs a non-fatal error to the YouTube Playables health monitoring service.
     */
    function logError(): void;

    /**
     * Logs a warning to the YouTube Playables health monitoring service.
     */
    function logWarning(): void;
  }
}

