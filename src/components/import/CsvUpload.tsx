import { useRef } from 'react';
import { Button } from '../common/Button';

export function CsvUpload({ onText }: { onText: (text: string) => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <div className="card space-y-2">
      <Button type="button" onClick={() => inputRef.current?.click()}>Upload CSV</Button>
      <input
        ref={inputRef}
        type="file"
        accept=".csv,text/csv"
        className="hidden"
        onChange={async (e) => {
          const file = e.target.files?.[0];
          if (!file) return;
          onText(await file.text());
        }}
      />
    </div>
  );
}
