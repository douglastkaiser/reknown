import type { CSSProperties } from 'react';

export interface PhotoFocus {
  x: number;
  y: number;
  zoom?: number;
}

const DEFAULT_FOCUS: PhotoFocus = { x: 0.5, y: 0.3, zoom: 1.35 };

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    if (!src.startsWith('data:')) image.crossOrigin = 'anonymous';
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('Unable to load image for face detection'));
    image.src = src;
  });
}

function hasFaceDetector(): boolean {
  return typeof window !== 'undefined' && 'FaceDetector' in window;
}

type FaceDetectorCtor = new (options?: { fastMode?: boolean; maxDetectedFaces?: number }) => {
  detect: (image: HTMLImageElement) => Promise<Array<{ boundingBox: { x: number; y: number; width: number; height: number } }>>;
};

export async function detectPhotoFocus(src?: string): Promise<PhotoFocus | undefined> {
  if (!src || !hasFaceDetector()) return undefined;

  try {
    const image = await loadImage(src);
    const detectorWindow = window as unknown as { FaceDetector: FaceDetectorCtor };
    const detector = new detectorWindow.FaceDetector({ fastMode: true, maxDetectedFaces: 3 });

    const faces = await detector.detect(image);
    if (!faces.length) return undefined;

    const chosen = faces
      .slice()
      .sort((a, b) => (b.boundingBox.width * b.boundingBox.height) - (a.boundingBox.width * a.boundingBox.height))[0];

    const centerX = chosen.boundingBox.x + (chosen.boundingBox.width / 2);
    const centerY = chosen.boundingBox.y + (chosen.boundingBox.height * 0.38);

    return {
      x: clamp(centerX / image.naturalWidth, 0.05, 0.95),
      y: clamp(centerY / image.naturalHeight, 0.05, 0.95),
      zoom: 1.55,
    };
  } catch {
    return undefined;
  }
}

export function faceImageStyle(focus?: PhotoFocus): CSSProperties {
  const target = focus ?? DEFAULT_FOCUS;
  const zoom = clamp(target.zoom ?? DEFAULT_FOCUS.zoom ?? 1.35, 1, 2.25);
  return {
    objectPosition: `${Math.round(target.x * 100)}% ${Math.round(target.y * 100)}%`,
    transform: zoom > 1 ? `scale(${zoom})` : undefined,
    transformOrigin: 'center',
  };
}
