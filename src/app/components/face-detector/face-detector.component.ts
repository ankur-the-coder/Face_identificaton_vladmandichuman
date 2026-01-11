import { Component, ElementRef, ViewChild, AfterViewInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { HumanService } from '../../services/human.service';
import { ImageManagerService } from '../../services/image-manager.service';
import type { Result } from '@vladmandic/human';

@Component({
  selector: 'app-face-detector',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './face-detector.component.html',
  styleUrls: ['./face-detector.component.css']
})
export class FaceDetectorComponent implements AfterViewInit {
  @ViewChild('video') videoEl!: ElementRef<HTMLVideoElement>;
  @ViewChild('canvas') canvasEl!: ElementRef<HTMLCanvasElement>;

  status: string = 'Initializing...';
  detectedFaces: any[] = [];
  fps: number = 0;
  isCameraActive = false;

  // Modal State
  showMatchModal = false;
  matchLiveImage: string | null = null;
  matchStoredImage: string | null = null;
  matchName: string = '';
  matchScore: number = 0;
  isAudioEnabled = false; // Default OFF
  isMobile = false;
  showManageModal = false;

  constructor(
    private humanService: HumanService,
    public imageManager: ImageManagerService
  ) { }

  // ... (existing code) ...

  toggleAudio() {
    this.isAudioEnabled = !this.isAudioEnabled;
  }

  toggleManage() {
    this.showManageModal = !this.showManageModal;
  }

  deleteFace(index: number) {
    if (confirm('Delete this face from the database?')) {
      this.imageManager.deleteFace(index);
    }
  }

  clearAllFaces() {
    if (confirm('Delete ALL faces from the database? This cannot be undone.')) {
      this.imageManager.clearAll();
    }
  }


  async ngAfterViewInit() {
    await this.humanService.init();
    this.status = 'Ready to Start';
    this.checkMobile();
  }

  async startCamera() {
    this.status = 'Starting Camera...';
    await this.setupCamera();
  }

  togglePerformanceMode(event: any) {
    const isHighPerf = event.target.checked;
    this.humanService.setPerformanceMode(isHighPerf);
  }

  async setupCamera() {
    const memory = (navigator as any).deviceMemory || 8;
    const userAgent = navigator.userAgent.toLowerCase();
    const isAndroid = /android/.test(userAgent);
    const isPortrait = window.innerHeight > window.innerWidth;
    const isMobileDevice = /iphone|ipad|ipod|android/i.test(userAgent);

    // Config: Mobile devices need MUCH lower resolution to avoid crashes
    // Desktop can handle higher resolution
    let videoConfig: MediaTrackConstraints = {
      width: { ideal: 1920 },
      height: { ideal: 1920 }
    };

    if (isAndroid && memory < 5) {
      videoConfig = { width: { ideal: 1920 }, height: { ideal: 1440 } };
      console.log('Low memory Android detected, limiting resolution');
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { ...videoConfig, facingMode: 'user' },
        audio: false
      });
      const video = this.videoEl.nativeElement;
      video.srcObject = stream;

      // Wait for video to be ready
      await new Promise((resolve) => {
        video.onloadedmetadata = () => {
          video.play();
          resolve(true);
        };
      });

      this.isCameraActive = true;
      this.status = 'Active';

      // Resize canvas to match video
      this.resizeCanvas();
      window.addEventListener('resize', () => {
        this.resizeCanvas();
        this.checkMobile();
      });
      this.detectLoop();
    } catch (err) {
      console.error('Camera setup failed', err);
      this.status = 'Camera Error: ' + err;
      this.isCameraActive = false;
      alert(`Camera Error: ${err}`); // Visual feedback for mobile user
    }
  }

  checkMobile() {
    this.isMobile = window.innerWidth < 768;
  }

  resizeCanvas() {
    if (!this.videoEl.nativeElement || !this.canvasEl.nativeElement) return;
    const video = this.videoEl.nativeElement;
    const canvas = this.canvasEl.nativeElement;

    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    // Debounce log
    // console.log(`Resolution: ${canvas.width}x${canvas.height}`);
  }

  async detectLoop() {
    if (!this.videoEl.nativeElement || this.videoEl.nativeElement.paused || this.videoEl.nativeElement.ended) {
      requestAnimationFrame(() => this.detectLoop());
      return;
    }

    const t0 = performance.now();

    if (!this.humanService.human || this.showMatchModal) {
      // If modal is open, do not detect.
      if (!this.showMatchModal) {
        requestAnimationFrame(() => this.detectLoop());
      }
      return;
    }

    // Detect
    const result: Result = await this.humanService.detect(this.videoEl.nativeElement);

    // Draw
    this.draw(result);

    // FPS
    const t1 = performance.now();
    this.fps = Math.round(1000 / (t1 - t0));

    requestAnimationFrame(() => this.detectLoop());
  }

  draw(result: Result) {
    const canvas = this.canvasEl.nativeElement;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Visual settings
    ctx.lineWidth = 4;
    ctx.font = '24px Arial';

    if (result.face) {
      for (const face of result.face) {
        // Draw Box
        const [x, y, w, h] = face.box;
        ctx.strokeStyle = '#00FFFF'; // Cyan
        ctx.fillStyle = 'rgba(0, 255, 255, 0.2)';
        ctx.beginPath();
        ctx.rect(x, y, w, h);
        ctx.stroke();
        ctx.fill();

        // Recognize
        let label = `Unknown`;
        let subLabel = '';

        // Match logic
        if (face.embedding) {
          const match = this.imageManager.findMatch(face.embedding);
          if (match) {
            const score = match.score.toFixed(4); // Raw similarity
            if (match.isMatch) {
              // MATCH FOUND!
              this.handleMatch(face, match);
              return; // Stop drawing, loop will stop check next frame
            } else {
              label = `Unknown (${score})`;
              subLabel = `Nearest: ${match.name} (${score})`;
            }
          }
        }

        // Liveness logic REMOVED as per request.

        // Points Count
        let points = 0;
        if (face.mesh) points += face.mesh.length;
        if ((face as any).iris) points += (face as any).iris.length;

        const infoLabel = `Points: ${points}`;

        // Draw Text
        ctx.fillStyle = 'white';
        ctx.shadowColor = 'black';
        ctx.shadowBlur = 4;
        ctx.font = 'bold 24px Arial';
        ctx.fillText(label, x, y - 30);

        ctx.font = '16px Arial';
        if (subLabel) ctx.fillText(subLabel, x, y - 10);
        ctx.fillText(infoLabel, x, y + h + 20); // Draw points count below box

        ctx.shadowBlur = 0;
      }
    }

    this.detectedFaces = result.face || [];
  }

  handleMatch(face: any, match: any) {
    this.showMatchModal = true;
    this.matchName = match.name;
    this.matchScore = match.score;
    this.matchStoredImage = match.imageSrc || null;

    // Config check
    const isFlipped = this.humanService.config.filter?.flip;

    // TTS Logic
    if (this.isAudioEnabled) {
      const utterance = new SpeechSynthesisUtterance(`Identity verified: ${match.name}`);
      utterance.rate = 1.0;
      speechSynthesis.speak(utterance);
    }

    // Crop Face
    let [x, y, w, h] = face.box;

    // If flipped, 'x' is relative to the visual (mirrored) canvas.
    // We need to un-flip it to get the coordinate on the raw video element.
    // RawX = Width - VisualX - WidthOfFace
    if (isFlipped) {
      const videoW = this.videoEl.nativeElement.videoWidth;
      x = videoW - x - w;
    }

    // Dynamic Padding (e.g. 50% of face width/height)
    // Clamp padding to ensure we don't zoom out too much, but always have some context.
    const padW = w * 0.5;
    const padH = h * 0.5;

    const cropX = Math.max(0, x - padW);
    const cropY = Math.max(0, y - padH);

    const videoWidth = this.videoEl.nativeElement.videoWidth;
    const videoHeight = this.videoEl.nativeElement.videoHeight;

    const cropW = Math.min(videoWidth - cropX, w + padW * 2);
    const cropH = Math.min(videoHeight - cropY, h + padH * 2);

    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = cropW;
    tempCanvas.height = cropH;
    const tCtx = tempCanvas.getContext('2d');
    if (tCtx) {
      // If the user wants the CROP to look mirrored (like the live feed), we should flip the context.
      if (isFlipped) {
        tCtx.translate(cropW, 0);
        tCtx.scale(-1, 1);
      }

      // Draw from VIDEO
      tCtx.drawImage(this.videoEl.nativeElement, cropX, cropY, cropW, cropH, 0, 0, cropW, cropH);
      this.matchLiveImage = tempCanvas.toDataURL('image/png');
    }
  }

  closeModal() {
    this.showMatchModal = false;
    this.matchLiveImage = null;
    this.matchStoredImage = null;
    this.matchName = '';
    // Restart Loop
    this.detectLoop();
  }

  onFileSelected(event: any) {
    const files = event.target.files;
    if (files && files.length) {
      this.status = 'Importing...';

      // Safety: Process one by one or batch, but handle errors
      this.imageManager.processBatch(files)
        .then(count => {
          this.status = `Imported ${count} faces`;
          setTimeout(() => this.status = 'Ready', 3000);
          if (count === 0) alert('No valid faces found in imported photos.');
        })
        .catch(err => {
          console.error('Import Error:', err);
          this.status = 'Import Failed';
          alert(`Failed to import photos. Error: ${err.message || err}`);
        });
    }
  }
}
