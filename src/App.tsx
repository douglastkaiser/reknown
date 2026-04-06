import { useEffect, useMemo, useState } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { AppShell } from './components/layout/AppShell';
import { HomeDashboard } from './components/home/HomeDashboard';
import { PeopleForm } from './components/people/PeopleForm';
import { PeopleList } from './components/people/PeopleList';
import { ReviewSessionFlow } from './components/review/ReviewSessionFlow';
import { CsvPaste } from './components/import/CsvPaste';
import { CsvUpload } from './components/import/CsvUpload';
import { ImportPreview } from './components/import/ImportPreview';
import { StatsPage } from './components/stats/StatsPage';
import { usePeople } from './hooks/usePeople';
import { useStats } from './hooks/useStats';
import { parseGenericCsv, parseLinkedInCsv } from './lib/csv-parser';
import { getSettings, seedPeople, updateSettings } from './lib/storage';
import type { CsvPersonRow, Settings } from './types';

function useAppSettings() {
  const [settings, setSettings] = useState<Settings | null>(null);
  useEffect(() => {
    void getSettings().then(setSettings);
  }, []);
  return { settings, setSettings };
}

function ImportPage({ onImport }: { onImport: (rows: CsvPersonRow[]) => Promise<void> }) {
  const [rows, setRows] = useState<CsvPersonRow[]>([]);

  const onText = (text: string) => {
    const normalized = parseLinkedInCsv(text);
    setRows(normalized.length ? normalized : parseGenericCsv(text));
  };

  return (
    <div className="space-y-3">
      <div className="rounded-xl border border-outline bg-surface p-3 text-sm text-muted">
        Starter people are preloaded on first run. You can delete them anytime or replace them by importing your LinkedIn CSV.
      </div>
      <CsvUpload onText={onText} />
      <CsvPaste onText={onText} />
      {rows.length ? <ImportPreview rows={rows} onConfirm={() => void onImport(rows)} /> : null}
    </div>
  );
}

export default function App() {
  const peopleState = usePeople();
  const statsState = useStats();
  const { settings, setSettings } = useAppSettings();

  const dismissInstallPrompt = useMemo(
    () => async () => {
      const next = await updateSettings({ installPromptDismissedAt: Date.now() });
      setSettings(next);
    },
    [setSettings]
  );

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
        <Route
          path="/home"
          element={
            <HomeDashboard
              installPromptDismissed={Boolean(settings?.installPromptDismissedAt)}
              onDismissInstallPrompt={dismissInstallPrompt}
            />
          }
        />
        <Route
          path="/stats"
          element={<StatsPage stats={statsState.stats} reviewMetrics={statsState.reviewMetrics} />}
        />
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
        <Route path="*" element={<Navigate to="/review" replace />} />
      </Routes>
    </AppShell>
  );
}
