import { validateWebTeamProviderUrl } from './providers';
import type {
  DiscoveredWebTeamCandidate,
  PrepareWebTeamSectionImportsResult,
  WebTeamDiscoverySource,
  WebTeamProvider,
} from './types';

export interface DiscoverySourceConfig {
  label: string;
  description: string;
}

/**
 * Discovery sources find company URLs. They do not parse team pages.
 * Provider validation is still required before category creation/import.
 */
export const WEB_TEAM_DISCOVERY_SOURCES: Record<WebTeamDiscoverySource, DiscoverySourceConfig> = {
  yc_directory: {
    label: 'YC Directory',
    description: 'Startup directory feed that can provide candidate company homepages.',
  },
};

export function prepareWebTeamSectionImports({
  provider,
  candidates,
}: {
  provider: WebTeamProvider;
  candidates: DiscoveredWebTeamCandidate[];
}): PrepareWebTeamSectionImportsResult {
  const accepted: PrepareWebTeamSectionImportsResult['accepted'] = [];
  const rejected: PrepareWebTeamSectionImportsResult['rejected'] = [];

  for (const candidate of candidates) {
    const validation = validateWebTeamProviderUrl(provider, candidate.companyUrl);
    if (!validation.ok) {
      rejected.push({
        candidate,
        reason: validation.reason,
      });
      continue;
    }

    accepted.push({
      name: candidate.companyName,
      provider,
      url: validation.parsedUrl.toString(),
      source: candidate.source,
    });
  }

  return { accepted, rejected };
}
