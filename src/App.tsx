import { useEffect, useMemo, useState } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { AppShell } from './components/layout/AppShell';
import { LoginPage } from './components/auth/LoginPage';
import { PeopleForm } from './components/people/PeopleForm';
import { PeopleList } from './components/people/PeopleList';
import { ReviewSessionFlow } from './components/review/ReviewSessionFlow';
import { CsvUpload } from './components/import/CsvUpload';
import { CsvPaste } from './components/import/CsvPaste';
import { ImportPreview } from './components/import/ImportPreview';
import { StatsPage } from './components/stats/StatsPage';
import { AboutPage } from './pages/AboutPage';
import { useAuth } from './contexts/AuthContext';
import { usePeople } from './hooks/usePeople';
import { useStats } from './hooks/useStats';
import { parseGenericCsv, parseLinkedInCsv } from './lib/csv-parser';
import { getSettings } from './lib/storage';
import type { CsvPersonRow, Settings } from './types';

function useAppSettings() {
  const [settings, setSettings] = useState<Settings | null>(null);
  useEffect(() => {
    void getSettings().then(setSettings);
  }, []);
  return { settings, setSettings };
}

function PeoplePage({ peopleState }: { peopleState: ReturnType<typeof usePeople> }) {
  const [rows, setRows] = useState<CsvPersonRow[]>([]);
  const [showImport, setShowImport] = useState(false);
  const [importing, setImporting] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [importError, setImportError] = useState<string | null>(null);

  const onText = (text: string) => {
    const normalized = parseLinkedInCsv(text);
    setRows(normalized.length ? normalized : parseGenericCsv(text));
    setImportError(null);
  };

  const onImport = async () => {
    setImporting(true);
    setImportError(null);
    setProgress({ done: 0, total: rows.length });
    try {
      const { seedPeople } = await import('./lib/storage');
      await seedPeople(
        rows.map((row) => ({ ...row, tags: [] })),
        (done, total) => setProgress({ done, total }),
      );
      await peopleState.refresh();
      setRows([]);
      setShowImport(false);
    } catch (err) {
      console.error('CSV import failed', err);
      setImportError(err instanceof Error ? err.message : 'Import failed');
    } finally {
      setImporting(false);
    }
  };

  return (
    <div className="space-y-3">
      <PeopleForm onSave={peopleState.addPerson} />

      <div className="flex gap-2">
        <button
          onClick={() => setShowImport(!showImport)}
          className="rounded-xl border border-border px-3 py-2 text-sm text-muted hover:bg-white/5 hover:text-text"
        >
          {showImport ? 'Hide Import' : 'Import CSV'}
        </button>
      </div>

      {showImport ? (
        <div className="space-y-3">
          <CsvUpload onText={onText} />
          <CsvPaste onText={onText} />
          {rows.length ? (
            <ImportPreview
              rows={rows}
              onConfirm={() => void onImport()}
              importing={importing}
              progress={progress}
              error={importError}
            />
          ) : null}
        </div>
      ) : null}

      <PeopleList
        people={peopleState.people}
        onDelete={(id) => void peopleState.removePerson(id)}
        onUpdate={(id, updates) => peopleState.editPerson(id, updates)}
      />
    </div>
  );
}

function AuthenticatedApp() {
  const peopleState = usePeople();
  const statsState = useStats();
  const { settings } = useAppSettings();

  return (
    <AppShell>
      <Routes>
        <Route path="/review" element={<ReviewSessionFlow people={peopleState.people} settings={settings} />} />
        <Route path="/people" element={<PeoplePage peopleState={peopleState} />} />
        <Route
          path="/stats"
          element={<StatsPage stats={statsState.stats} reviewMetrics={statsState.reviewMetrics} />}
        />
        <Route path="/about" element={<AboutPage />} />
        <Route path="*" element={<Navigate to="/review" replace />} />
      </Routes>
    </AppShell>
  );
}

export default function App() {
  const { user, isGuest, loading } = useAuth();

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p className="text-muted">Loading...</p>
      </div>
    );
  }

  if (!user && !isGuest) {
    return <LoginPage />;
  }

  return <AuthenticatedApp />;
}
