import { Injectable } from '@angular/core';
import { Human, Config, Result } from '@vladmandic/human';

@Injectable({
  providedIn: 'root'
})
export class HumanService {
  human: Human | undefined;
  // Initialize with default configuration, models loaded from local assets
  config: Partial<Config> = {
    modelBasePath: 'assets/models',
    filter: { enabled: true, equalization: true, flip: true },
    backend: 'webgl',
    wasmPath: '/',
    debug: true,
    face: {
      enabled: true,
      detector: { return: true, rotation: true },
      mesh: { enabled: true },
      iris: { enabled: true },
      description: { enabled: true },
      emotion: { enabled: false },
      antispoof: { enabled: false },
      liveness: { enabled: false }
    },
    body: { enabled: false },
    hand: { enabled: false },
    object: { enabled: false },
    gesture: { enabled: false },
    // Multi-threading
    // @ts-ignore
    useWorker: true
  };

  constructor() { }

  setPerformanceMode(isHighPerformance: boolean) {
    if (!this.config.face) return;

    if (isHighPerformance) {
      console.log('Switching to High Performance (Less Accuracy)');
      this.config.face.iris = { enabled: false };
      this.config.face.mesh = { enabled: false };
      if (this.config.face.detector) this.config.face.detector.rotation = false;
    } else {
      console.log('Switching to High Accuracy (Lower FPS)');
      this.config.face.iris = { enabled: true };
      this.config.face.mesh = { enabled: true };
      if (this.config.face.detector) this.config.face.detector.rotation = true;
    }
  }

  async init(): Promise<void> {
    if (this.human) return;

    this.autoConfig();
    this.human = new Human(this.config);
    if (!this.human) return;

    try {
      console.log('Initializing Human with backend:', this.config.backend);
      await this.human.load();
      await this.human.warmup();
      console.log('Human initialized successfully');
    } catch (err) {
      console.error('Human Init Error (WebGL), falling back to WASM:', err);
      // Fallback strategies
      this.config.backend = 'wasm';
      this.human = new Human(this.config);
      await this.human.load();
      await this.human.warmup();
      console.log('Human fallback initialized successfully');
    }
  }

  private autoConfig() {
    const isBrowser = typeof window !== 'undefined';
    if (!isBrowser) return;

    const nav = navigator as any;
    const memory = nav.deviceMemory || 8; // Default to 8GB if unknown
    const cores = nav.hardwareConcurrency || 4;
    const userAgent = nav.userAgent.toLowerCase();
    const isAndroid = /android/.test(userAgent);
    const isIOS = /iphone|ipad|ipod/.test(userAgent);
    const isPC = !isAndroid && !isIOS;

    console.log(`Hardware: Memory=${memory}GB, Cores=${cores}, Android=${isAndroid}, iOS=${isIOS}, PC=${isPC}`);

    // Default High-End Config (PC, iOS, High-RAM Android)
    this.config.backend = 'webgl';
    this.config.face = {
      ...this.config.face,
      mesh: { enabled: true },
      iris: { enabled: true },
      description: { enabled: true },
      antispoof: { enabled: true },
      liveness: { enabled: true },
      detector: { return: true, rotation: true, maxDetected: 10 }
    };

    // Optimization for Low-End Android (< 4GB RAM)
    if (isAndroid && memory < 4) {
      console.log('Optimizing for Low-End Android');
      this.config.face.iris = { enabled: false }; // Save computation
      this.config.face.mesh = { enabled: true }; // Keep mesh for accuracy, but could disable if VERY slow
      this.config.face.detector = {
        ...this.config.face.detector,
        maxDetected: 1, // Focus on single face
        rotation: false // Disable rotation correction to save FPS
      };
      // Use lighter backend or params if needed, but webgl is usually best.
      // We could enable cache sensitivity to skip frames.
      this.config.cacheSensitivity = 0.7;
    }
  }

  async detect(input: HTMLVideoElement | HTMLCanvasElement | HTMLImageElement): Promise<Result> {
    if (!this.human) throw new Error('Human not initialized');
    return await this.human.detect(input);
  }

  // Calculate Cosine Similarity
  // Returns -1 to 1. 1 = identical.
  similarity(descriptor1: number[], descriptor2: number[]): number {
    if (descriptor1.length !== descriptor2.length) return 0;

    let dot = 0;
    let mag1 = 0;
    let mag2 = 0;

    for (let i = 0; i < descriptor1.length; i++) {
      dot += descriptor1[i] * descriptor2[i];
      mag1 += descriptor1[i] * descriptor1[i];
      mag2 += descriptor2[i] * descriptor2[i];
    }

    const magnitude = Math.sqrt(mag1) * Math.sqrt(mag2);
    return magnitude === 0 ? 0 : dot / magnitude;
  }
}
