import { SynthAudio } from './audio';
import { SaveState, YTPlayablesSDK } from './sdk';

type GamePhase = 'MENU' | 'PLAYING' | 'GAME_OVER';
type ObstacleKind = 'LOW_BARRIER' | 'HIGH_DRONE' | 'TALL_PILLAR';
type CollectibleKind = 'SHARD' | 'SHIELD';

interface Obstacle {
  x: number;
  y: number;
  w: number;
  h: number;
  kind: ObstacleKind;
  passed: boolean;
  pulsePhase: number;
}

interface Collectible {
  x: number;
  y: number;
  radius: number;
  kind: CollectibleKind;
  collected: boolean;
  bobOffset: number;
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  color: string;
  alpha: number;
  life: number;
  maxLife: number;
}

interface TrailPoint {
  x: number;
  y: number;
  h: number;
  alpha: number;
}

interface FloatingText {
  x: number;
  y: number;
  text: string;
  color: string;
  life: number;
  maxLife: number;
}

export class NeonRunnerGame {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private sdk: YTPlayablesSDK;
  private audio: SynthAudio;

  private rafId: number | null = null;
  private lastTimestamp = 0;

  private width = 800;
  private height = 600;
  private groundY = 480;

  private phase: GamePhase = 'MENU';
  private saveState: SaveState = {
    highScore: 0,
    totalShards: 0,
    runsPlayed: 0,
  };

  // Player state
  private playerX = 120;
  private playerY = 0;
  private playerVy = 0;
  private readonly baseWidth = 42;
  private readonly baseHeight = 52;
  private readonly slideHeight = 28;
  private jumpsUsed = 0;
  private readonly maxJumps = 2;
  private isSliding = false;
  private slideTimer = 0;
  private hasShield = false;
  private invincibleTimer = 0;

  // Run metrics
  private score = 0;
  private distance = 0;
  private runShards = 0;
  private combo = 0;
  private speed = 380;
  private readonly baseSpeed = 380;
  private readonly maxSpeed = 880;
  private isNewBest = false;

  // Spawners & entities
  private spawnTimer = 1.1;
  private shardSpawnTimer = 0.7;
  private obstacles: Obstacle[] = [];
  private collectibles: Collectible[] = [];
  private particles: Particle[] = [];
  private trail: TrailPoint[] = [];
  private floatingTexts: FloatingText[] = [];

  // Visual environment
  private gridOffset = 0;
  private cityOffset = 0;
  private bgTime = 0;
  private shakeIntensity = 0;

  // Touch tracking
  private touchStartY: number | null = null;

  constructor(canvas: HTMLCanvasElement, sdk: YTPlayablesSDK, audio: SynthAudio) {
    this.canvas = canvas;
    const context = canvas.getContext('2d');
    if (!context) {
      throw new Error('Failed to initialize 2D canvas context');
    }
    this.ctx = context;
    this.sdk = sdk;
    this.audio = audio;

    this.handleResize();
    this.resetPlayerPosition();

    window.addEventListener('resize', () => this.handleResize());
    this.bindInputListeners();
    this.bindSDKCallbacks();
  }

  /**
   * Boot sequence following YouTube Playables SDK lifecycle requirements:
   * 1. Draw the first visual frame and immediately notify `firstFrameReady()`.
   * 2. Load saved progression from `ytgame.game.loadData()`.
   * 3. Start interactive loop and notify `gameReady()`.
   */
  public async boot(): Promise<void> {
    // 1. Render initial visual frame and signal firstFrameReady()
    this.render();
    this.sdk.notifyFirstFrameReady();

    // 2. Load cloud/local save state and verify cloud save pipe
    this.saveState = await this.sdk.loadGameData();
    void this.sdk.saveGameData(this.saveState);
    this.audio.setEnabled(this.sdk.isAudioEnabled);
    this.audio.setPaused(this.sdk.isPaused);

    // 3. Re-render menu with loaded high score and start loop (if not paused by host)
    this.render();
    if (!this.sdk.isPaused) {
      this.startLoop();
    }

    // 4. Signal gameReady() now that the game is interactive
    this.sdk.notifyGameReady();
  }

  private bindSDKCallbacks(): void {
    this.sdk.onAudioChange((enabled) => {
      this.audio.setEnabled(enabled);
    });

    // Strict YouTube Playables certification rule: stop all loops & audio when paused
    this.sdk.onPause(() => {
      this.audio.setPaused(true);
      this.stopLoop();
    });

    this.sdk.onResume(() => {
      this.audio.setPaused(false);
      this.audio.setEnabled(this.sdk.isAudioEnabled);
      this.startLoop();
    });
  }

  private startLoop(): void {
    if (this.rafId !== null) return;
    this.lastTimestamp = performance.now();
    const tick = (now: number) => {
      if (this.sdk.isPaused) {
        this.rafId = null;
        return;
      }
      const dt = Math.min((now - this.lastTimestamp) / 1000, 0.05);
      this.lastTimestamp = now;

      this.update(dt);
      this.render();

      this.rafId = requestAnimationFrame(tick);
    };
    this.rafId = requestAnimationFrame(tick);
  }

  private stopLoop(): void {
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
  }

  private handleResize(): void {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.width = window.innerWidth;
    this.height = window.innerHeight;

    this.canvas.width = Math.floor(this.width * dpr);
    this.canvas.height = Math.floor(this.height * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    this.groundY = Math.floor(this.height * 0.78);
    this.playerX = Math.max(64, Math.min(160, Math.floor(this.width * 0.16)));

    if (this.phase !== 'PLAYING') {
      this.resetPlayerPosition();
    } else if (this.playerY > this.groundY - this.currentPlayerHeight) {
      this.playerY = this.groundY - this.currentPlayerHeight;
    }
  }

  private get currentPlayerHeight(): number {
    return this.isSliding ? this.slideHeight : this.baseHeight;
  }

  private resetPlayerPosition(): void {
    this.isSliding = false;
    this.slideTimer = 0;
    this.playerY = this.groundY - this.baseHeight;
    this.playerVy = 0;
    this.jumpsUsed = 0;
  }

  private bindInputListeners(): void {
    window.addEventListener('keydown', (e) => {
      if (this.sdk.isPaused) return;

      if (e.code === 'KeyM') {
        e.preventDefault();
        const enabled = this.sdk.toggleAudio();
        if (enabled) this.audio.unlock();
        return;
      }

      if (e.code === 'Space' || e.code === 'ArrowUp' || e.code === 'KeyW') {
        e.preventDefault();
        this.handlePrimaryAction();
      } else if (e.code === 'ArrowDown' || e.code === 'KeyS') {
        e.preventDefault();
        this.handleSlideOrFastFall();
      }
    });

    this.canvas.addEventListener('pointerdown', (e) => {
      if (this.sdk.isPaused) return;
      e.preventDefault();

      // Check if user clicked the top-right audio status pill
      const rect = this.canvas.getBoundingClientRect();
      const clickX = e.clientX - rect.left;
      const clickY = e.clientY - rect.top;
      if (clickX >= this.width - 230 && clickY <= 60) {
        const enabled = this.sdk.toggleAudio();
        if (enabled) this.audio.unlock();
        return;
      }

      this.audio.unlock();

      if (this.phase !== 'PLAYING') {
        this.startRun();
        return;
      }

      this.touchStartY = e.clientY;

      // Right-click or bottom-right slide zone triggers slide/fast-fall
      if (e.button === 2) {
        this.handleSlideOrFastFall();
        return;
      }

      this.triggerJump();
    });

    this.canvas.addEventListener('pointermove', (e) => {
      if (this.sdk.isPaused || this.phase !== 'PLAYING' || this.touchStartY === null) return;
      const deltaY = e.clientY - this.touchStartY;
      if (deltaY > 42) {
        this.touchStartY = null;
        this.handleSlideOrFastFall();
      }
    });

    this.canvas.addEventListener('pointerup', () => {
      this.touchStartY = null;
    });

    this.canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  private handlePrimaryAction(): void {
    this.audio.unlock();
    if (this.phase === 'MENU' || this.phase === 'GAME_OVER') {
      this.startRun();
    } else if (this.phase === 'PLAYING') {
      this.triggerJump();
    }
  }

  private triggerJump(): void {
    if (this.jumpsUsed < this.maxJumps) {
      if (this.isSliding) {
        this.endSlide();
      }
      const isDouble = this.jumpsUsed > 0;
      this.playerVy = isDouble ? -690 : -760;
      this.jumpsUsed++;
      this.audio.playJump(isDouble);

      this.spawnBurst(
        this.playerX + this.baseWidth / 2,
        this.playerY + this.currentPlayerHeight,
        isDouble ? '#ff2a85' : '#00f5d4',
        isDouble ? 14 : 9
      );
    }
  }

  private handleSlideOrFastFall(): void {
    if (this.phase !== 'PLAYING') {
      this.startRun();
      return;
    }

    const onGround = this.playerY >= this.groundY - this.currentPlayerHeight - 2;
    if (!onGround) {
      // Fast-fall slam + transition into slide on landing
      this.playerVy = Math.max(this.playerVy, 980);
      this.isSliding = true;
      this.slideTimer = 0.55;
      this.audio.playSlide();
    } else if (!this.isSliding) {
      this.isSliding = true;
      this.slideTimer = 0.55;
      this.playerY = this.groundY - this.slideHeight;
      this.audio.playSlide();
      this.spawnBurst(this.playerX + this.baseWidth / 2, this.groundY, '#a855f7', 6);
    } else {
      this.slideTimer = 0.55;
    }
  }

  private endSlide(): void {
    if (!this.isSliding) return;
    this.isSliding = false;
    this.slideTimer = 0;
    const targetBottom = this.playerY + this.slideHeight;
    this.playerY = Math.min(this.groundY - this.baseHeight, targetBottom - this.baseHeight);
  }

  private startRun(): void {
    this.phase = 'PLAYING';
    this.score = 0;
    this.distance = 0;
    this.runShards = 0;
    this.combo = 0;
    this.speed = this.baseSpeed;
    this.isNewBest = false;
    this.hasShield = false;
    this.invincibleTimer = 0;

    this.obstacles = [];
    this.collectibles = [];
    this.particles = [];
    this.trail = [];
    this.floatingTexts = [];

    this.spawnTimer = 0.9;
    this.shardSpawnTimer = 0.5;
    this.resetPlayerPosition();
    this.audio.playJump(false);
  }

  private update(dt: number): void {
    this.bgTime += dt;
    const parallaxSpeed = this.phase === 'PLAYING' ? this.speed : 120;
    this.gridOffset = (this.gridOffset + parallaxSpeed * dt) % 64;
    this.cityOffset = (this.cityOffset + parallaxSpeed * 0.22 * dt) % 320;

    if (this.shakeIntensity > 0) {
      this.shakeIntensity = Math.max(0, this.shakeIntensity - dt * 28);
    }

    this.updateParticles(dt);
    this.updateFloatingTexts(dt);

    if (this.phase !== 'PLAYING') {
      return;
    }

    // Accelerate run speed gradually
    this.speed = Math.min(this.maxSpeed, this.speed + 14 * dt);
    const speedRatio = (this.speed - this.baseSpeed) / (this.maxSpeed - this.baseSpeed);
    this.audio.updateMusic(dt, true, speedRatio);

    this.distance += (this.speed * dt) / 12;
    this.score = Math.floor(this.distance + this.runShards * 25);

    if (this.invincibleTimer > 0) {
      this.invincibleTimer = Math.max(0, this.invincibleTimer - dt);
    }

    // Update slide timer
    if (this.isSliding) {
      this.slideTimer -= dt;
      if (this.slideTimer <= 0) {
        this.endSlide();
      }
    }

    // Player vertical physics
    const gravity = 2150;
    this.playerVy += gravity * dt;
    this.playerY += this.playerVy * dt;

    const floorTop = this.groundY - this.currentPlayerHeight;
    if (this.playerY >= floorTop) {
      this.playerY = floorTop;
      this.playerVy = 0;
      this.jumpsUsed = 0;
    }

    // Player neon motion trail
    this.trail.push({
      x: this.playerX,
      y: this.playerY,
      h: this.currentPlayerHeight,
      alpha: 0.45,
    });
    for (let i = this.trail.length - 1; i >= 0; i--) {
      this.trail[i].x -= this.speed * dt * 0.75;
      this.trail[i].alpha -= dt * 2.4;
      if (this.trail[i].alpha <= 0) {
        this.trail.splice(i, 1);
      }
    }

    // Spawn obstacles
    this.spawnTimer -= dt;
    if (this.spawnTimer <= 0) {
      this.spawnObstacle();
      const speedRatio = (this.speed - this.baseSpeed) / (this.maxSpeed - this.baseSpeed);
      const minGap = Math.max(0.55, 1.05 - speedRatio * 0.42);
      const maxGap = Math.max(0.95, 1.55 - speedRatio * 0.48);
      this.spawnTimer = minGap + Math.random() * (maxGap - minGap);
    }

    // Spawn collectibles
    this.shardSpawnTimer -= dt;
    if (this.shardSpawnTimer <= 0) {
      this.spawnCollectibleArc();
      this.shardSpawnTimer = 1.2 + Math.random() * 1.1;
    }

    this.updateObstacles(dt);
    this.updateCollectibles(dt);
  }

  private spawnObstacle(): void {
    const roll = Math.random();
    const spawnX = this.width + 60;

    if (roll < 0.46) {
      // Low barrier — jump over
      const h = 44 + Math.floor(Math.random() * 18);
      this.obstacles.push({
        x: spawnX,
        y: this.groundY - h,
        w: 34,
        h,
        kind: 'LOW_BARRIER',
        passed: false,
        pulsePhase: Math.random() * Math.PI * 2,
      });
    } else if (roll < 0.8) {
      // Hover drone — slide under or double-jump over
      const droneH = 38;
      // Positioned so standing player hits it, but sliding player passes safely underneath
      const clearanceFromGround = this.slideHeight + 12;
      this.obstacles.push({
        x: spawnX,
        y: this.groundY - clearanceFromGround - droneH,
        w: 54,
        h: droneH,
        kind: 'HIGH_DRONE',
        passed: false,
        pulsePhase: Math.random() * Math.PI * 2,
      });
    } else {
      // Tall neon pillar — requires double-jump timing
      const h = 92;
      this.obstacles.push({
        x: spawnX,
        y: this.groundY - h,
        w: 38,
        h,
        kind: 'TALL_PILLAR',
        passed: false,
        pulsePhase: Math.random() * Math.PI * 2,
      });
    }
  }

  private spawnCollectibleArc(): void {
    const startX = this.width + 80;
    const count = 3 + Math.floor(Math.random() * 3);
    const arcHeight = 55 + Math.random() * 75;

    // Occasional plasma shield orb when player doesn't have one
    if (!this.hasShield && Math.random() < 0.16) {
      this.collectibles.push({
        x: startX,
        y: this.groundY - 95,
        radius: 14,
        kind: 'SHIELD',
        collected: false,
        bobOffset: Math.random() * Math.PI * 2,
      });
      return;
    }

    for (let i = 0; i < count; i++) {
      const t = count > 1 ? i / (count - 1) : 0.5;
      const arch = Math.sin(t * Math.PI) * arcHeight;
      this.collectibles.push({
        x: startX + i * 44,
        y: this.groundY - 34 - arch,
        radius: 10,
        kind: 'SHARD',
        collected: false,
        bobOffset: i * 0.6,
      });
    }
  }

  private updateObstacles(dt: number): void {
    const px = this.playerX + 5;
    const py = this.playerY + 4;
    const pw = this.baseWidth - 10;
    const ph = this.currentPlayerHeight - 8;

    for (let i = this.obstacles.length - 1; i >= 0; i--) {
      const obs = this.obstacles[i];
      obs.x -= this.speed * dt;
      obs.pulsePhase += dt * 6;

      // Award clean dodge bonus
      if (!obs.passed && obs.x + obs.w < this.playerX) {
        obs.passed = true;
        this.distance += 10;
      }

      // AABB collision check
      if (
        this.invincibleTimer <= 0 &&
        px < obs.x + obs.w &&
        px + pw > obs.x &&
        py < obs.y + obs.h &&
        py + ph > obs.y
      ) {
        if (this.hasShield) {
          this.hasShield = false;
          this.invincibleTimer = 1.1;
          this.shakeIntensity = 10;
          this.audio.playShield(false);
          this.spawnBurst(obs.x + obs.w / 2, obs.y + obs.h / 2, '#38bdf8', 22);
          this.addFloatingText(this.playerX, this.playerY - 12, 'SHIELD BLOCK!', '#38bdf8');
          this.obstacles.splice(i, 1);
          continue;
        } else {
          this.triggerGameOver();
          return;
        }
      }

      if (obs.x + obs.w < -80) {
        this.obstacles.splice(i, 1);
      }
    }
  }

  private updateCollectibles(dt: number): void {
    const pCenterX = this.playerX + this.baseWidth / 2;
    const pCenterY = this.playerY + this.currentPlayerHeight / 2;

    for (let i = this.collectibles.length - 1; i >= 0; i--) {
      const item = this.collectibles[i];
      item.x -= this.speed * dt;
      item.bobOffset += dt * 5;

      const drawY = item.y + Math.sin(item.bobOffset) * 5;
      const dx = pCenterX - item.x;
      const dy = pCenterY - drawY;
      const hitRadius = item.radius + Math.max(this.baseWidth, this.currentPlayerHeight) * 0.48;

      if (!item.collected && dx * dx + dy * dy <= hitRadius * hitRadius) {
        item.collected = true;
        if (item.kind === 'SHIELD') {
          this.hasShield = true;
          this.audio.playShield(true);
          this.spawnBurst(item.x, drawY, '#38bdf8', 16);
          this.addFloatingText(item.x, drawY - 10, 'SHIELD READY', '#38bdf8');
        } else {
          this.combo++;
          const bonus = Math.min(5, 1 + Math.floor(this.combo / 5));
          this.runShards += bonus;
          this.audio.playPickup(this.combo);
          this.spawnBurst(item.x, drawY, '#fde047', 10);
          if (bonus > 1) {
            this.addFloatingText(item.x, drawY - 10, `+${bonus}x`, '#fde047');
          }
        }
        this.collectibles.splice(i, 1);
        continue;
      }

      if (item.x + item.radius < -40) {
        if (item.kind === 'SHARD' && !item.collected) {
          this.combo = 0;
        }
        this.collectibles.splice(i, 1);
      }
    }
  }

  private triggerGameOver(): void {
    this.phase = 'GAME_OVER';
    this.shakeIntensity = 14;
    this.audio.playCrash();
    this.spawnBurst(
      this.playerX + this.baseWidth / 2,
      this.playerY + this.currentPlayerHeight / 2,
      '#ff2a85',
      30
    );

    const finalScore = Math.floor(this.score);
    if (finalScore > this.saveState.highScore) {
      this.saveState.highScore = finalScore;
      this.isNewBest = true;
    }
    this.saveState.totalShards += this.runShards;
    this.saveState.runsPlayed += 1;

    // Submit score & persist cloud save via YouTube Playables SDK
    void this.sdk.submitScore(finalScore);
    void this.sdk.saveGameData(this.saveState);
  }

  private spawnBurst(x: number, y: number, color: string, count: number): void {
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const spd = 60 + Math.random() * 260;
      const maxLife = 0.25 + Math.random() * 0.35;
      this.particles.push({
        x,
        y,
        vx: Math.cos(angle) * spd,
        vy: Math.sin(angle) * spd - 40,
        size: 2.5 + Math.random() * 4,
        color,
        alpha: 1,
        life: maxLife,
        maxLife,
      });
    }
  }

  private updateParticles(dt: number): void {
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vy += 480 * dt;
      p.life -= dt;
      p.alpha = Math.max(0, p.life / p.maxLife);
      if (p.life <= 0) {
        this.particles.splice(i, 1);
      }
    }
  }

  private addFloatingText(x: number, y: number, text: string, color: string): void {
    this.floatingTexts.push({
      x,
      y,
      text,
      color,
      life: 0.75,
      maxLife: 0.75,
    });
  }

  private updateFloatingTexts(dt: number): void {
    for (let i = this.floatingTexts.length - 1; i >= 0; i--) {
      const ft = this.floatingTexts[i];
      ft.y -= 42 * dt;
      ft.life -= dt;
      if (ft.life <= 0) {
        this.floatingTexts.splice(i, 1);
      }
    }
  }

  private render(): void {
    const ctx = this.ctx;
    ctx.save();

    if (this.shakeIntensity > 0) {
      const dx = (Math.random() - 0.5) * this.shakeIntensity;
      const dy = (Math.random() - 0.5) * this.shakeIntensity;
      ctx.translate(dx, dy);
    }

    // 1. Synthwave Sky Gradient
    const skyGrad = ctx.createLinearGradient(0, 0, 0, this.groundY);
    skyGrad.addColorStop(0, '#060613');
    skyGrad.addColorStop(0.55, '#12092b');
    skyGrad.addColorStop(1, '#290d47');
    ctx.fillStyle = skyGrad;
    ctx.fillRect(0, 0, this.width, this.height);

    // 2. Retro Sun
    const sunRadius = Math.min(this.width, this.height) * 0.16;
    const sunX = this.width * 0.5;
    const sunY = this.groundY - sunRadius * 0.95;
    const sunGrad = ctx.createLinearGradient(sunX, sunY - sunRadius, sunX, sunY + sunRadius);
    sunGrad.addColorStop(0, '#ffbe0b');
    sunGrad.addColorStop(0.5, '#fb5607');
    sunGrad.addColorStop(1, '#ff006e');
    ctx.fillStyle = sunGrad;
    ctx.beginPath();
    ctx.arc(sunX, sunY, sunRadius, 0, Math.PI * 2);
    ctx.fill();

    // 3. Parallax Cyber Skyline
    this.renderCitySkyline(ctx);

    // 4. Neon Ground Plane & Perspective Grid
    this.renderGroundGrid(ctx);

    // 5. Collectibles, Obstacles, Player, Particles
    this.renderCollectibles(ctx);
    this.renderObstacles(ctx);
    this.renderPlayer(ctx);
    this.renderParticles(ctx);
    this.renderFloatingTexts(ctx);

    // 6. HUD & Overlays
    this.renderHUD(ctx);

    if (this.phase === 'MENU') {
      this.renderMenuOverlay(ctx);
    } else if (this.phase === 'GAME_OVER') {
      this.renderGameOverOverlay(ctx);
    }

    ctx.restore();
  }

  private renderCitySkyline(ctx: CanvasRenderingContext2D): void {
    ctx.fillStyle = '#0c0721';
    const heights = [68, 112, 84, 140, 96, 62, 128, 90];
    const bWidth = 40;
    const totalSpan = heights.length * bWidth;

    for (let x = -this.cityOffset; x < this.width + totalSpan; x += totalSpan) {
      for (let i = 0; i < heights.length; i++) {
        const bx = x + i * bWidth;
        const bh = heights[i];
        ctx.fillRect(bx, this.groundY - bh, bWidth - 2, bh);
      }
    }
  }

  private renderGroundGrid(ctx: CanvasRenderingContext2D): void {
    // Ground fill
    ctx.fillStyle = '#070512';
    ctx.fillRect(0, this.groundY, this.width, this.height - this.groundY);

    // Horizon glow line
    ctx.strokeStyle = '#00f5d4';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(0, this.groundY);
    ctx.lineTo(this.width, this.groundY);
    ctx.stroke();

    // Scrolling grid lines
    ctx.strokeStyle = 'rgba(255, 0, 110, 0.28)';
    ctx.lineWidth = 1.5;
    const step = 64;
    for (let x = -this.gridOffset; x < this.width + step; x += step) {
      ctx.beginPath();
      ctx.moveTo(x, this.groundY);
      ctx.lineTo(x - 90, this.height);
      ctx.stroke();
    }

    for (let y = this.groundY + 24; y < this.height; y += 28) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(this.width, y);
      ctx.stroke();
    }
  }

  private renderPlayer(ctx: CanvasRenderingContext2D): void {
    // Motion trail
    for (const t of this.trail) {
      ctx.fillStyle = `rgba(0, 245, 212, ${t.alpha * 0.45})`;
      ctx.fillRect(t.x, t.y, this.baseWidth * 0.85, t.h);
    }

    if (this.invincibleTimer > 0 && Math.floor(this.bgTime * 20) % 2 === 0) {
      return;
    }

    const h = this.currentPlayerHeight;

    // Outer neon body
    ctx.fillStyle = '#00f5d4';
    ctx.beginPath();
    ctx.roundRect(this.playerX, this.playerY, this.baseWidth, h, 8);
    ctx.fill();

    // Inner core visor
    ctx.fillStyle = '#070714';
    ctx.beginPath();
    ctx.roundRect(this.playerX + 6, this.playerY + 6, this.baseWidth - 12, Math.max(10, h - 14), 4);
    ctx.fill();

    // Glowing eye visor
    ctx.fillStyle = '#ff006e';
    ctx.fillRect(this.playerX + 18, this.playerY + 10, 16, 6);

    // Shield bubble
    if (this.hasShield) {
      ctx.strokeStyle = '#38bdf8';
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.arc(
        this.playerX + this.baseWidth / 2,
        this.playerY + h / 2,
        Math.max(this.baseWidth, h) * 0.72,
        0,
        Math.PI * 2
      );
      ctx.stroke();
    }
  }

  private renderObstacles(ctx: CanvasRenderingContext2D): void {
    for (const obs of this.obstacles) {
      const pulse = 0.85 + Math.sin(obs.pulsePhase) * 0.15;
      if (obs.kind === 'HIGH_DRONE') {
        ctx.fillStyle = '#f72585';
        ctx.beginPath();
        ctx.roundRect(obs.x, obs.y, obs.w, obs.h, 10);
        ctx.fill();

        ctx.fillStyle = '#fde047';
        ctx.fillRect(obs.x + 8, obs.y + obs.h / 2 - 3, obs.w - 16, 6);
      } else {
        ctx.fillStyle = obs.kind === 'TALL_PILLAR' ? '#b5179e' : '#ff006e';
        ctx.beginPath();
        ctx.roundRect(obs.x, obs.y, obs.w, obs.h, 6);
        ctx.fill();

        ctx.strokeStyle = `rgba(255, 255, 255, ${0.55 * pulse})`;
        ctx.lineWidth = 2;
        ctx.strokeRect(obs.x + 4, obs.y + 4, obs.w - 8, obs.h - 8);
      }
    }
  }

  private renderCollectibles(ctx: CanvasRenderingContext2D): void {
    for (const item of this.collectibles) {
      const drawY = item.y + Math.sin(item.bobOffset) * 5;
      ctx.save();
      ctx.translate(item.x, drawY);

      if (item.kind === 'SHIELD') {
        ctx.fillStyle = '#38bdf8';
        ctx.beginPath();
        ctx.arc(0, 0, item.radius, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#e0f2fe';
        ctx.lineWidth = 2;
        ctx.stroke();
      } else {
        ctx.rotate(this.bgTime * 3 + item.bobOffset);
        ctx.fillStyle = '#fde047';
        ctx.beginPath();
        ctx.moveTo(0, -item.radius);
        ctx.lineTo(item.radius, 0);
        ctx.lineTo(0, item.radius);
        ctx.lineTo(-item.radius, 0);
        ctx.closePath();
        ctx.fill();
      }
      ctx.restore();
    }
  }

  private renderParticles(ctx: CanvasRenderingContext2D): void {
    for (const p of this.particles) {
      ctx.globalAlpha = p.alpha;
      ctx.fillStyle = p.color;
      ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
    }
    ctx.globalAlpha = 1;
  }

  private renderFloatingTexts(ctx: CanvasRenderingContext2D): void {
    ctx.font = 'bold 15px system-ui, sans-serif';
    ctx.textAlign = 'center';
    for (const ft of this.floatingTexts) {
      ctx.globalAlpha = Math.max(0, ft.life / ft.maxLife);
      ctx.fillStyle = ft.color;
      ctx.fillText(ft.text, ft.x, ft.y);
    }
    ctx.globalAlpha = 1;
  }

  private renderHUD(ctx: CanvasRenderingContext2D): void {
    const pad = 20;

    // Score & Best Score
    ctx.textAlign = 'left';
    ctx.fillStyle = '#ffffff';
    ctx.font = '800 26px system-ui, sans-serif';
    ctx.fillText(`${Math.floor(this.score).toLocaleString()}`, pad, pad + 24);

    ctx.fillStyle = '#94a3b8';
    ctx.font = '600 13px system-ui, sans-serif';
    ctx.fillText(`BEST ${this.saveState.highScore.toLocaleString()}`, pad, pad + 44);

    if (this.combo > 1 && this.phase === 'PLAYING') {
      ctx.fillStyle = '#fde047';
      ctx.font = '700 14px system-ui, sans-serif';
      ctx.fillText(`COMBO x${this.combo}`, pad, pad + 64);
    }

    // YT Playables SDK status pill (top-right)
    ctx.textAlign = 'right';
    const envLabel = this.sdk.isPlayablesEnv ? 'YT PLAYABLES SDK' : 'LOCAL SDK READY';
    const audioIcon = this.sdk.isAudioEnabled ? 'SFX ON' : 'MUTED';
    ctx.fillStyle = 'rgba(15, 23, 42, 0.72)';
    ctx.beginPath();
    ctx.roundRect(this.width - 200 - pad, pad, 200, 32, 16);
    ctx.fill();

    ctx.fillStyle = this.sdk.isPlayablesEnv ? '#00f5d4' : '#38bdf8';
    ctx.font = '700 11px system-ui, sans-serif';
    ctx.fillText(`${envLabel} • ${audioIcon}`, this.width - pad - 14, pad + 20);
  }

  private renderMenuOverlay(ctx: CanvasRenderingContext2D): void {
    const cx = this.width / 2;
    const cy = this.height * 0.42;

    const cardW = Math.min(420, this.width - 32);
    const cardH = 250;

    ctx.fillStyle = 'rgba(7, 7, 20, 0.86)';
    ctx.strokeStyle = '#00f5d4';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.roundRect(cx - cardW / 2, cy - cardH / 2, cardW, cardH, 16);
    ctx.fill();
    ctx.stroke();

    ctx.textAlign = 'center';
    ctx.fillStyle = '#00f5d4';
    ctx.font = '900 34px system-ui, sans-serif';
    ctx.fillText('NEON PULSE', cx, cy - 58);

    ctx.fillStyle = '#e2e8f0';
    ctx.font = '600 15px system-ui, sans-serif';
    ctx.fillText('Jump & Double-Jump: Space / W / Tap', cx, cy - 16);
    ctx.fillText('Slide / Fast-Fall: Down / S / Swipe Down', cx, cy + 10);

    if (this.saveState.highScore > 0) {
      ctx.fillStyle = '#fde047';
      ctx.font = '700 14px system-ui, sans-serif';
      ctx.fillText(
        `HIGH SCORE: ${this.saveState.highScore.toLocaleString()}  •  SHARDS: ${this.saveState.totalShards.toLocaleString()}`,
        cx,
        cy + 44
      );
    }

    // Pulsing CTA button
    const btnW = 210;
    const btnH = 46;
    const btnY = cy + 64;
    ctx.fillStyle = '#ff006e';
    ctx.beginPath();
    ctx.roundRect(cx - btnW / 2, btnY, btnW, btnH, 23);
    ctx.fill();

    ctx.fillStyle = '#ffffff';
    ctx.font = '800 16px system-ui, sans-serif';
    ctx.fillText('TAP OR SPACE TO RUN', cx, btnY + 29);
  }

  private renderGameOverOverlay(ctx: CanvasRenderingContext2D): void {
    const cx = this.width / 2;
    const cy = this.height * 0.43;

    const cardW = Math.min(400, this.width - 32);
    const cardH = 260;

    ctx.fillStyle = 'rgba(7, 7, 20, 0.9)';
    ctx.strokeStyle = '#ff006e';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.roundRect(cx - cardW / 2, cy - cardH / 2, cardW, cardH, 16);
    ctx.fill();
    ctx.stroke();

    ctx.textAlign = 'center';
    ctx.fillStyle = '#ff006e';
    ctx.font = '900 30px system-ui, sans-serif';
    ctx.fillText('SYSTEM CRASHED', cx, cy - 66);

    ctx.fillStyle = '#ffffff';
    ctx.font = '800 24px system-ui, sans-serif';
    ctx.fillText(`SCORE: ${Math.floor(this.score).toLocaleString()}`, cx, cy - 22);

    ctx.fillStyle = this.isNewBest ? '#00f5d4' : '#fde047';
    ctx.font = '700 15px system-ui, sans-serif';
    ctx.fillText(
      this.isNewBest
        ? `NEW RECORD! (${this.saveState.highScore.toLocaleString()})`
        : `BEST: ${this.saveState.highScore.toLocaleString()}`,
      cx,
      cy + 8
    );

    ctx.fillStyle = '#94a3b8';
    ctx.font = '600 13px system-ui, sans-serif';
    ctx.fillText(`Shards Collected: +${this.runShards} (Total: ${this.saveState.totalShards})`, cx, cy + 36);

    const btnW = 210;
    const btnH = 46;
    const btnY = cy + 60;
    ctx.fillStyle = '#00f5d4';
    ctx.beginPath();
    ctx.roundRect(cx - btnW / 2, btnY, btnW, btnH, 23);
    ctx.fill();

    ctx.fillStyle = '#070714';
    ctx.font = '800 16px system-ui, sans-serif';
    ctx.fillText('PLAY AGAIN', cx, btnY + 29);
  }
}

