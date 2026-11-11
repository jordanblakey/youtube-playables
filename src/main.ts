import { SynthAudio } from './audio';
import { NeonRunnerGame } from './game';
import { YTPlayablesSDK } from './sdk';

async function bootstrap(): Promise<void> {
  const canvas = document.getElementById('game-canvas') as HTMLCanvasElement | null;
  if (!canvas) {
    throw new Error('Missing #game-canvas element');
  }

  const sdk = new YTPlayablesSDK();
  const audio = new SynthAudio();
  const game = new NeonRunnerGame(canvas, sdk, audio);

  await game.boot();
}

void bootstrap();

