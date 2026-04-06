import { Link } from 'react-router-dom';
import { InstallPromptCard } from './InstallPromptCard';

export function HomeDashboard({
  installPromptDismissed,
  onDismissInstallPrompt,
}: {
  installPromptDismissed: boolean;
  onDismissInstallPrompt: () => Promise<void>;
}) {
  return (
    <section className="space-y-3">
      <InstallPromptCard dismissed={installPromptDismissed} onDismiss={onDismissInstallPrompt} />

      <div className="rounded-xl border border-outline bg-surface p-4">
        <h2 className="text-lg font-semibold text-text">Ready for a quick review?</h2>
        <p className="mt-1 text-sm text-muted">Jump back into your queue and keep your momentum going.</p>
        <Link
          to="/review"
          className="mt-3 inline-flex w-full items-center justify-center rounded-xl border border-border bg-accent/20 px-3 py-2 text-sm font-medium text-text hover:bg-accent/30"
        >
          Continue Review
        </Link>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <Link to="/import" className="rounded-xl border border-outline bg-surface p-3 text-sm hover:bg-white/5">
          <p className="font-medium text-text">Import People</p>
          <p className="mt-1 text-muted">Upload CSV or paste rows.</p>
        </Link>
        <Link to="/people" className="rounded-xl border border-outline bg-surface p-3 text-sm hover:bg-white/5">
          <p className="font-medium text-text">Manage People</p>
          <p className="mt-1 text-muted">Add, edit, or clean up profiles.</p>
        </Link>
      </div>

      <div className="rounded-xl border border-outline bg-surface p-3 text-sm text-muted">
        Starter people were preloaded for your first session. Use Import to replace them with your own LinkedIn connections, or delete any starter profile from People.
      </div>
    </section>
  );
}
