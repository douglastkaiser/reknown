import { useRef } from 'react';
import { Button } from '../common/Button';
import { resizeToJpeg, urlToData } from '../../lib/image';
import { FacePhoto } from '../common/FacePhoto';

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
      {value ? <FacePhoto src={value} alt="preview" containerClassName="h-20 w-20 rounded-full" /> : null}
    </div>
  );
}
