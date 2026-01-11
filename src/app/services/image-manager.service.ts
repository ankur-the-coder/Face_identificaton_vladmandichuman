import { Injectable } from '@angular/core';
import { HumanService } from './human.service';

export interface KnownFace {
  name: string;
  descriptor: number[];
  imageSrc: string; // Base64 or URL
}

@Injectable({
  providedIn: 'root'
})
export class ImageManagerService {
  knownFaces: KnownFace[] = [];

  constructor(private humanService: HumanService) { }

  async processBatch(files: FileList): Promise<number> {
    let count = 0;
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const name = file.name.replace(/\.[^/.]+$/, ""); // Remove extension

      // Prevent duplicates
      if (this.knownFaces.some(f => f.name === name)) {
        console.log(`Skipping duplicate: ${name}`);
        continue;
      }

      try {
        const descriptor = await this.extractDescriptor(file);
        if (descriptor) {
          this.knownFaces.push({
            name,
            descriptor,
            imageSrc: URL.createObjectURL(file) // Keep blob URL (revoke later if needed)
          });
          count++;
        }
      } catch (e) {
        console.error(`Failed to process ${file.name}`, e);
      }
    }
    return count;
  }

  private async extractDescriptor(file: File): Promise<number[] | null> {
    // Convert File to Image
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = async () => {
        try {
          if (!this.humanService.human) await this.humanService.init();

          const result = await this.humanService.detect(img);
          if (result && result.face && result.face.length > 0) {
            // Return first face's descriptor
            resolve(result.face[0].embedding || null);
          } else {
            resolve(null);
          }
        } catch (err) {
          reject(err);
        }
      };
      img.onerror = reject;
      img.src = URL.createObjectURL(file);
    });
  }

  findMatch(descriptor: number[]): { name: string, score: number, isMatch: boolean, imageSrc?: string } | null {
    if (this.knownFaces.length === 0) return null;
    if (!this.humanService.human) return null;

    // Create array of descriptors for the library function
    const descriptors = this.knownFaces.map(f => f.descriptor);

    // Official API: find(descriptor, descriptors)
    // Returns { index, distance, similarity }
    // Similarity is normalized: > 0.5 is match.
    const result = this.humanService.human.match.find(descriptor, descriptors);

    // console.log('Match Result:', result);

    if (result.index === -1) return null;

    const matchedFace = this.knownFaces[result.index];
    const threshold = 0.5; // Official docs say > 0.5 is match

    return {
      name: matchedFace.name,
      score: result.similarity,
      isMatch: result.similarity > threshold,
      imageSrc: matchedFace.imageSrc
    };
  }

  deleteFace(index: number): void {
    if (index >= 0 && index < this.knownFaces.length) {
      this.knownFaces.splice(index, 1);
    }
  }

  clearAll(): void {
    this.knownFaces = [];
  }
}

