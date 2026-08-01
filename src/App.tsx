import { useEffect, useMemo, useState } from 'react';
import { Navigate, Route, Routes, useNavigate, useSearchParams } from 'react-router-dom';
import { AppShell } from './components/layout/AppShell';
import { LoginPage } from './components/auth/LoginPage';
import { PeopleForm } from './components/people/PeopleForm';
import { PeopleList } from './components/people/PeopleList';
import { EnrichPhotosPanel } from './components/people/EnrichPhotosPanel';
import { EspnRosterPanel } from './components/people/EspnRosterPanel';
import { HistoricalFiguresPanel } from './components/people/HistoricalFiguresPanel';
import { CivicRepresentativesPanel } from './components/people/CivicRepresentativesPanel';
import { WebTeamPagePanel } from './components/people/WebTeamPagePanel';
import { CategoryTabs } from './components/people/CategoryTabs';
import { CompanyFilterTabs, type PeopleFilter } from './components/people/CompanyFilterTabs';
import { CategoryHeader } from './components/people/CategoryHeader';
import { NewCategoryDialog } from './components/people/NewCategoryDialog';
import { ReviewSessionFlow } from './components/review/ReviewSessionFlow';
import { CsvUpload } from './components/import/CsvUpload';
import { CsvPaste } from './components/import/CsvPaste';
import { ImportPreview } from './components/import/ImportPreview';
import { StatsPage } from './components/stats/StatsPage';
import { AboutPage } from './pages/AboutPage';
import { useAuth } from './contexts/AuthContext';
import { usePeople } from './hooks/usePeople';
import { useCategories } from './hooks/useCategories';
import { useStats } from './hooks/useStats';
import { parseGenericCsv, parseLinkedInCsv } from './lib/csv-parser';
import { fetchRoster, rosterToPersonRecords, SPORTS } from './lib/espn';
import { getSettings, seedPeople } from './lib/storage';
import { collectCompanyOptions, personHasCompany } from './lib/companies';
import { collectRegionOptions, personHasRegion } from './lib/regions';
import { getHistoricalCollection } from './lib/historical-collections';
import { importHistoricalFigures } from './lib/historical-import';
import { wikidataHistoricalFigureProvider } from './lib/wikidata';
import type { Category, CsvPersonRow, Person, Settings } from './types';

function useAppSettings() {
  const [settings, setSettings] = useState<Settings | null>(null);
  useEffect(() => {
    void getSettings().then(setSettings);
  }, []);
  return { settings, setSettings };
}

function LinkedInImportSection({
  category,
  onImported,
}: {
  category: Category;
  onImported: () => Promise<void> | void;
}) {
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
        rows,
        category.id,
        (done, total) => setProgress({ done, total }),
      );
      await onImported();
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
      <div className="flex gap-2">
        <button
          id="import-csv-toggle"
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
    </div>
  );
}

function PeoplePage({
  peopleState,
  categoriesState,
}: {
  peopleState: ReturnType<typeof usePeople>;
  categoriesState: ReturnType<typeof useCategories>;
}) {
  const { categories, addCategory, editCategory, removeCategory } = categoriesState;
  const navigate = useNavigate();
  const [activeId, setActiveId] = useState<string | null>(null);
  const [activeFilter, setActiveFilter] = useState<PeopleFilter>({ type: 'all' });
  const [dialogOpen, setDialogOpen] = useState(false);

  // Keep activeId in sync when categories list changes.
  useEffect(() => {
    if (categories.length === 0) {
      if (activeId !== null) setActiveId(null);
      return;
    }
    if (!activeId || !categories.some((c) => c.id === activeId)) {
      setActiveId(categories[0].id);
    }
  }, [categories, activeId]);

  const activeCategory = useMemo(
    () => categories.find((c) => c.id === activeId) ?? null,
    [categories, activeId],
  );

  const peopleInCategory = useMemo(
    () =>
      activeCategory
        ? peopleState.people.filter((p) => p.categoryId === activeCategory.id)
        : [],
    [peopleState.people, activeCategory],
  );

  const companyOptions = useMemo(
    () => collectCompanyOptions(peopleInCategory),
    [peopleInCategory],
  );
  const regionOptions = useMemo(() => collectRegionOptions(peopleInCategory), [peopleInCategory]);

  // Drop the active company filter whenever it no longer applies to the
  // people currently in view (category switch, deletions, edits).
  useEffect(() => {
    if (
      activeFilter.type !== 'all' &&
      !(activeFilter.type === 'company' ? companyOptions : regionOptions)
        .some((o) => o.name.toLowerCase() === activeFilter.value.toLowerCase())
    ) {
      setActiveFilter({ type: 'all' });
    }
  }, [companyOptions, regionOptions, activeFilter]);

  useEffect(() => { setActiveFilter({ type: 'all' }); }, [activeId]);

  const visiblePeople = useMemo(
    () =>
      activeFilter.type === 'all'
        ? peopleInCategory
        : activeFilter.type === 'company'
          ? peopleInCategory.filter((p) => personHasCompany(p, activeFilter.value))
          : peopleInCategory.filter((p) => personHasRegion(p, activeFilter.value)),
    [peopleInCategory, activeFilter],
  );

  const [espnImporting, setEspnImporting] = useState(false);
  const [historicalImportErrors, setHistoricalImportErrors] = useState<Record<string, string>>({});

  async function handleCreate(input: Omit<Category, 'id' | 'createdAt' | 'updatedAt'>) {
    const created = await addCategory(input);
    setActiveId(created.id);
    setDialogOpen(false);

    if (
      input.enrichMethod === 'espn_roster' &&
      input.espnSport &&
      input.espnLeague &&
      input.espnTeamId
    ) {
      const sport = SPORTS.find(
        (s) => s.slug === input.espnSport && s.leagueSlug === input.espnLeague,
      );
      if (sport) {
        setEspnImporting(true);
        try {
          const players = await fetchRoster(sport, input.espnTeamId);
          const records = rosterToPersonRecords(
            players,
            input.espnTeamName ?? created.name,
          );
          await seedPeople(records, created.id);
          await peopleState.refresh();
        } catch (err) {
          console.error('[espn] auto-import failed', err);
        } finally {
          setEspnImporting(false);
        }
      }
    }

    if (input.enrichMethod === 'historical_figures' && input.historicalCollectionId) {
      const collection = getHistoricalCollection(input.historicalCollectionId);
      if (collection) {
        try {
          const result = await importHistoricalFigures(
            created.id,
            collection.wikidataEntityIds,
            [],
            wikidataHistoricalFigureProvider,
          );
          if (result.failures.length) {
            const failed = result.failures.reduce((sum, failure) => sum + failure.entityIds.length, 0);
            setHistoricalImportErrors((current) => ({
              ...current,
              [created.id]: `${failed} figure${failed === 1 ? '' : 's'} could not be imported. Retry from the collection panel.`,
            }));
          }
          await peopleState.refresh();
        } catch (err) {
          console.error('[historical] auto-import failed', err);
          setHistoricalImportErrors((current) => ({
            ...current,
            [created.id]: err instanceof Error ? err.message : 'Historical import failed. Retry from the collection panel.',
          }));
        }
      }
    }
  }

  async function handleDelete(id: string) {
    await removeCategory(id);
    await peopleState.refresh();
  }

  async function handleToggleHiddenFromReview(id: string, hidden: boolean) {
    await editCategory(id, { hiddenFromReview: hidden });
  }

  if (categoriesState.loading && categories.length === 0) {
    return <div className="card text-sm text-muted">Loading…</div>;
  }

  if (categories.length === 0) {
    return (
      <div className="space-y-3">
        <div className="card space-y-3">
          <h2 className="text-lg font-semibold">Create your first section</h2>
          <p className="text-sm text-muted">
            Group the people you want to remember into sections like{' '}
            <strong>LinkedIn</strong>, <strong>Patriots</strong>, or <strong>Local Reps</strong>.
            Each section has its own import and enrichment method.
          </p>
          <button
            type="button"
            onClick={() => setDialogOpen(true)}
            className="rounded-xl border border-accent bg-accent/20 px-3 py-2 text-sm font-medium text-text hover:bg-accent/30"
          >
            + New section
          </button>
        </div>
        <NewCategoryDialog
          open={dialogOpen}
          onCancel={() => setDialogOpen(false)}
          onCreate={handleCreate}
        />
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <CategoryTabs
        categories={categories}
        activeId={activeId}
        onSelect={setActiveId}
        onCreate={() => setDialogOpen(true)}
      />

      {activeCategory ? (
        <>
          <CategoryHeader
            category={activeCategory}
            peopleCount={peopleInCategory.length}
            onDelete={handleDelete}
            onToggleHiddenFromReview={handleToggleHiddenFromReview}
          />

          <CompanyFilterTabs
            companyOptions={companyOptions}
            regionOptions={regionOptions}
            activeFilter={activeFilter}
            totalCount={peopleInCategory.length}
            onSelect={setActiveFilter}
            onPractice={(company) =>
              navigate(`/review?company=${encodeURIComponent(company)}`)
            }
          />

          <PeopleForm categoryId={activeCategory.id} onSave={peopleState.addPerson} />

          {activeCategory.enrichMethod === 'linkedin' ? (
            <>
              <LinkedInImportSection category={activeCategory} onImported={peopleState.refresh} />
              <EnrichPhotosPanel
                people={peopleInCategory}
                onUpdate={(id, updates) => peopleState.editPerson(id, updates)}
              />
            </>
          ) : activeCategory.enrichMethod === 'espn_roster' ? (
            <EspnRosterPanel
              category={activeCategory}
              people={peopleInCategory}
              onImported={peopleState.refresh}
            />
          ) : activeCategory.enrichMethod === 'civic_reps' ? (
            <CivicRepresentativesPanel
              category={activeCategory}
              people={peopleInCategory}
              onImported={peopleState.refresh}
            />
          ) : activeCategory.enrichMethod === 'historical_figures' ? (
            <HistoricalFiguresPanel
              category={activeCategory}
              people={peopleInCategory}
              initialError={historicalImportErrors[activeCategory.id]}
              onImported={async () => {
                setHistoricalImportErrors((current) => {
                  const next = { ...current };
                  delete next[activeCategory.id];
                  return next;
                });
                await peopleState.refresh();
              }}
            />
          ) : activeCategory.enrichMethod === 'web_team_page' ? (
            <WebTeamPagePanel
              category={activeCategory}
              people={peopleInCategory}
              onImported={peopleState.refresh}
            />
          ) : null}

          {espnImporting ? (
            <div className="card text-sm text-muted">Importing roster from ESPN…</div>
          ) : null}

          {activeFilter.type !== 'all' && visiblePeople.length === 0 ? (
            <div className="card text-sm text-muted">
              No people matching {activeFilter.type === 'company' ? 'company history' : 'current region'} {activeFilter.value} in this section.
            </div>
          ) : null}

          <PeopleList
            people={visiblePeople}
            onDelete={(id) => void peopleState.removePerson(id)}
            onUpdate={(id, updates) => peopleState.editPerson(id, updates)}
          />
        </>
      ) : null}

      <NewCategoryDialog
        open={dialogOpen}
        onCancel={() => setDialogOpen(false)}
        onCreate={handleCreate}
      />
    </div>
  );
}

function ReviewRoute({
  people,
  settings,
}: {
  people: Person[];
  settings: Settings | null;
}) {
  const [searchParams, setSearchParams] = useSearchParams();
  const company = searchParams.get('company');

  const scopedPeople = useMemo(
    () => (company ? people.filter((p) => personHasCompany(p, company)) : people),
    [people, company],
  );

  return (
    <div className="space-y-3">
      {company ? (
        <div className="flex items-center justify-between gap-2 rounded-xl border border-accent/40 bg-accent/10 px-3 py-2 text-sm">
          <span className="text-text">
            Practicing <strong>{company}</strong> · {scopedPeople.length}{' '}
            {scopedPeople.length === 1 ? 'person' : 'people'}
          </span>
          <button
            type="button"
            onClick={() => setSearchParams({})}
            className="whitespace-nowrap rounded-full border border-border px-3 py-1 text-xs text-muted hover:bg-white/5 hover:text-text"
          >
            Practice everyone
          </button>
        </div>
      ) : null}
      <ReviewSessionFlow key={company ?? 'all'} people={scopedPeople} settings={settings} />
    </div>
  );
}

function AuthenticatedApp() {
  const peopleState = usePeople();
  const categoriesState = useCategories();
  const statsState = useStats();
  const { settings } = useAppSettings();

  const reviewPeople = useMemo(() => {
    const hiddenIds = new Set(
      categoriesState.categories
        .filter((c) => c.hiddenFromReview)
        .map((c) => c.id),
    );
    if (hiddenIds.size === 0) return peopleState.people;
    return peopleState.people.filter((p) => !hiddenIds.has(p.categoryId));
  }, [peopleState.people, categoriesState.categories]);

  return (
    <AppShell>
      <Routes>
        <Route path="/review" element={<ReviewRoute people={reviewPeople} settings={settings} />} />
        <Route
          path="/people"
          element={<PeoplePage peopleState={peopleState} categoriesState={categoriesState} />}
        />
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
