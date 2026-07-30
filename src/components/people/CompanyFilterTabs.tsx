import { useState } from 'react';
import type { ReactNode } from 'react';
import { partitionCompanyOptions, type CompanyOption } from '../../lib/companies';
import type { RegionOption } from '../../lib/regions';

export type PeopleFilter =
  | { type: 'all' }
  | { type: 'company'; value: string }
  | { type: 'region'; value: string };

/** Company-history and current-region filters use typed keys so names cannot collide. */
export function CompanyFilterTabs({
  companyOptions, regionOptions, activeFilter, totalCount, onSelect, onPractice,
}: {
  companyOptions: CompanyOption[];
  regionOptions: RegionOption[];
  activeFilter: PeopleFilter;
  totalCount: number;
  onSelect: (filter: PeopleFilter) => void;
  onPractice?: (company: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  if (companyOptions.length + regionOptions.length === 0) return null;
  const { shared, rare } = partitionCompanyOptions(companyOptions);
  const activeCompany = activeFilter.type === 'company' ? activeFilter.value : null;
  const visibleCompanies = expanded ? companyOptions : shared.slice();
  if (activeCompany && !visibleCompanies.some((o) => o.name.toLowerCase() === activeCompany.toLowerCase())) {
    const option = companyOptions.find((o) => o.name.toLowerCase() === activeCompany.toLowerCase());
    if (option) visibleCompanies.push(option);
  }
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-muted">Company history</span>
        {activeCompany && onPractice ? <button type="button" onClick={() => onPractice(activeCompany)} className="rounded-full border border-accent bg-accent/20 px-3 py-1 text-xs">Practice {activeCompany} →</button> : null}
      </div>
      <div className="flex gap-1 overflow-x-auto pb-1">
        <FilterButton active={activeFilter.type === 'all'} onClick={() => onSelect({ type: 'all' })}>All ({totalCount})</FilterButton>
        {visibleCompanies.map((o) => <FilterButton key={`company:${o.name.toLowerCase()}`} active={activeFilter.type === 'company' && activeFilter.value.toLowerCase() === o.name.toLowerCase()} onClick={() => onSelect({ type: 'company', value: o.name })}>{o.name} ({o.count})</FilterButton>)}
        {rare.length ? <FilterButton active={false} onClick={() => setExpanded((v) => !v)}>{expanded ? 'Show fewer' : `+${companyOptions.length - visibleCompanies.length} more`}</FilterButton> : null}
      </div>
      {regionOptions.length ? <><div className="text-xs font-medium text-muted">Current region</div><div className="flex gap-1 overflow-x-auto pb-1">{regionOptions.map((o) => <FilterButton key={`region:${o.name.toLowerCase()}`} active={activeFilter.type === 'region' && activeFilter.value.toLowerCase() === o.name.toLowerCase()} onClick={() => onSelect({ type: 'region', value: o.name })}>{o.name} ({o.count})</FilterButton>)}</div></> : null}
    </div>
  );
}

function FilterButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return <button type="button" onClick={onClick} className={`whitespace-nowrap rounded-full border px-3 py-1 text-xs transition ${active ? 'border-accent bg-accent/20 text-text' : 'border-border text-muted hover:bg-white/5 hover:text-text'}`}>{children}</button>;
}
