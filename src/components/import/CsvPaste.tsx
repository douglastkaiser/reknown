import { useState } from 'react';
import { Button } from '../common/Button';

export function CsvPaste({ onText }: { onText: (text: string) => void }) {
  const [value, setValue] = useState('');
  return (
    <div className="card space-y-2">
      <textarea className="min-h-32 w-full rounded-lg bg-bg p-2" value={value} onChange={(e) => setValue(e.target.value)} placeholder="Paste CSV" />
      <Button type="button" onClick={() => onText(value)}>Use pasted CSV</Button>
    </div>
  );
}
