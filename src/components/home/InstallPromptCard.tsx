import { useEffect, useState } from 'react';
import { Button } from '../common/Button';

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
};

export function InstallPromptCard({
  dismissed,
  onDismiss,
}: {
  dismissed: boolean;
  onDismiss: () => Promise<void>;
}) {
  const [installEvent, setInstallEvent] = useState<BeforeInstallPromptEvent | null>(null);

  useEffect(() => {
    const onBeforeInstallPrompt = (event: Event) => {
      event.preventDefault();
      setInstallEvent(event as BeforeInstallPromptEvent);
    };

    window.addEventListener('beforeinstallprompt', onBeforeInstallPrompt);
    return () => window.removeEventListener('beforeinstallprompt', onBeforeInstallPrompt);
  }, []);

  const isStandalone = window.matchMedia('(display-mode: standalone)').matches;
  if (dismissed || isStandalone || !installEvent) return null;

  return (
    <article className="card space-y-3">
      <h2 className="text-base font-semibold">Install Reknown</h2>
      <p className="text-sm text-muted">
        Add Reknown to your home screen for a full-screen app-shell and offline review sessions.
      </p>
      <div className="flex gap-2">
        <Button
          onClick={() => {
            void installEvent.prompt();
          }}
        >
          Install app
        </Button>
        <Button className="bg-transparent text-muted hover:bg-white/5" onClick={() => void onDismiss()}>
          Not now
        </Button>
      </div>
    </article>
  );
}
