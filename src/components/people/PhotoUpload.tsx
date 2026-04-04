import { useRef } from 'react';
import { Button } from '../common/Button';

async function resizeToJpeg(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 400 / bitmap.width, 400 / bitmap.height);
  const width = Math.round(bitmap.width * scale);
  const height = Math.round(bitmap.height * scale);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas unavailable');
  ctx.drawImage(bitmap, 0, 0, width, height);
  return canvas.toDataURL('image/jpeg', 0.85);
}

async function urlToData(url: string): Promise<string> {
  try {
    const response = await fetch(url, { mode: 'cors' });
    const blob = await response.blob();
    return await resizeToJpeg(new File([blob], 'remote.jpg', { type: blob.type || 'image/jpeg' }));
  } catch {
    return url;
  }
}

export function PhotoUpload({ value, onChange }: { value?: string; onChange: (val: string) => void }) {
  const inputRef = useRef<HTMLInputElement>(null);

  async function handleFile(file?: File) {
    if (!file) return;
    onChange(await resizeToJpeg(file));
  }

  async function capture() {
    const stream = await navigator.mediaDevices.getUserMedia({ video: true });
    const video = document.createElement('video');
    video.srcObject = stream;
    await video.play();
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext('2d')?.drawImage(video, 0, 0);
    stream.getTracks().forEach((t) => t.stop());
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.85));
    if (!blob) return;
    await handleFile(new File([blob], 'camera.jpg', { type: 'image/jpeg' }));
  }

  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <Button type="button" onClick={() => inputRef.current?.click()}>Upload</Button>
        <Button type="button" onClick={() => void capture()}>Camera</Button>
        <Button type="button" onClick={async () => {
          const url = window.prompt('Paste image URL');
          if (url) onChange(await urlToData(url));
        }}>URL</Button>
      </div>
      <input ref={inputRef} className="hidden" type="file" accept="image/*" onChange={(e) => void handleFile(e.target.files?.[0])} />
      {value ? <img src={value} alt="preview" className="h-20 w-20 rounded-full object-cover" /> : null}
    </div>
  );
}
