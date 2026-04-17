import {
  WEB_TEAM_PROVIDERS,
  matchWebTeamProvider,
  validateWebTeamProviderUrl,
} from './providers';
import { WEB_TEAM_DISCOVERY_SOURCES, prepareWebTeamSectionImports } from './discovery';
import { fetchAndParseVastTeamPage } from './vast';
import type { ImportWebTeamPageInput, WebTeamPersonRecord, WebTeamProvider } from './types';

function resolveProvider(inputProvider: ImportWebTeamPageInput['provider'], parsedUrl: URL): WebTeamProvider {
  if (inputProvider) {
    if (inputProvider in WEB_TEAM_PROVIDERS) {
      return inputProvider as WebTeamProvider;
    }
    throw new Error(`Unsupported web team provider: ${inputProvider}`);
  }

  const matched = matchWebTeamProvider(parsedUrl);
  if (!matched) {
    throw new Error('Unsupported team page URL');
  }
  return matched;
}

export async function importWebTeamPage({
  provider,
  url,
}: ImportWebTeamPageInput): Promise<WebTeamPersonRecord[]> {
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(url);
  } catch {
    throw new Error('Invalid team page URL');
  }

  const resolvedProvider = resolveProvider(provider, parsedUrl);
  const validation = validateWebTeamProviderUrl(resolvedProvider, parsedUrl.toString());
  if (!validation.ok) {
    throw new Error(validation.reason);
  }

  switch (resolvedProvider) {
    case 'vast':
      return fetchAndParseVastTeamPage(validation.parsedUrl.toString());
    default:
      throw new Error(`Unsupported web team provider: ${resolvedProvider}`);
  }
}

export type { WebTeamPersonRecord, WebTeamProvider } from './types';
export {
  WEB_TEAM_DISCOVERY_SOURCES,
  WEB_TEAM_PROVIDERS,
  matchWebTeamProvider,
  prepareWebTeamSectionImports,
  validateWebTeamProviderUrl,
};
