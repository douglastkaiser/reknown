import { useMemo, useState } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { AppShell } from './components/layout/AppShell';
import { HomeDashboard } from './components/home/HomeDashboard';
import { PeopleForm } from './components/people/PeopleForm';
import { PeopleList } from './components/people/PeopleList';
import { ReviewSessionFlow } from './components/review/ReviewSessionFlow';
import { CsvPaste } from './components/import/CsvPaste';
import { CsvUpload } from './components/import/CsvUpload';
import { ImportPreview } from './components/import/ImportPreview';
import { usePeople } from './hooks/usePeople';
import { useStats } from './hooks/useStats';
import { parseGenericCsv, parseLinkedInCsv } from './lib/csv-parser';
import { getSettings, seedPeople } from './lib/storage';
import type { CsvPersonRow, Settings } from './types';
import { useEffect } from 'react';

function useAppSettings() {
  const [settings, setSettings] = useState<Settings | null>(null);
  useEffect(() => {
    void getSettings().then(setSettings);
  }, []);
  return settings;
}

function ImportPage({ onImport }: { onImport: (rows: CsvPersonRow[]) => Promise<void> }) {
  const [rows, setRows] = useState<CsvPersonRow[]>([]);

  const onText = (text: string) => {
    const normalized = parseLinkedInCsv(text);
    setRows(normalized.length ? normalized : parseGenericCsv(text));
  };

  return (
    <div className="space-y-3">
      <CsvUpload onText={onText} />
      <CsvPaste onText={onText} />
      {rows.length ? <ImportPreview rows={rows} onConfirm={() => void onImport(rows)} /> : null}
    </div>
  );
}

export default function App() {
  const peopleState = usePeople();
  const statsState = useStats();
  const settings = useAppSettings();

  const imported = useMemo(
    () => async (rows: CsvPersonRow[]) => {
      await seedPeople(rows.map((row) => ({ ...row, tags: [] })));
      await peopleState.refresh();
    },
    [peopleState]
  );

  return (
    <AppShell>
      <Routes>
        <Route path="/home" element={<HomeDashboard stats={statsState.stats} />} />
        <Route
          path="/people"
          element={
            <div className="space-y-3">
              <PeopleForm onSave={peopleState.addPerson} />
              <PeopleList people={peopleState.people} onDelete={(id) => void peopleState.removePerson(id)} />
            </div>
          }
        />
        <Route path="/review" element={<ReviewSessionFlow people={peopleState.people} settings={settings} />} />
        <Route path="/import" element={<ImportPage onImport={imported} />} />
        <Route path="*" element={<Navigate to="/home" replace />} />
      </Routes>
    </AppShell>
  );
}
