import type { WebTeamProvider } from './types';

export interface WebTeamProviderConfig {
  label: string;
  isSupportedUrl: (url: URL) => boolean;
  validationMessage: string;
}

export const WEB_TEAM_PROVIDERS: Record<WebTeamProvider, WebTeamProviderConfig> = {
  vast: {
    label: 'Vast',
    isSupportedUrl: (url: URL) =>
      url.protocol === 'https:' &&
      url.hostname === 'www.vastspace.com' &&
      (url.pathname === '/team' || url.pathname === '/team/'),
    validationMessage:
      'For Vast, URL must be https://www.vastspace.com/team (trailing slash or query is okay).',
  },
};

export function matchWebTeamProvider(url: URL): WebTeamProvider | null {
  for (const provider of Object.keys(WEB_TEAM_PROVIDERS) as WebTeamProvider[]) {
    if (WEB_TEAM_PROVIDERS[provider].isSupportedUrl(url)) {
      return provider;
    }
  }
  return null;
}
