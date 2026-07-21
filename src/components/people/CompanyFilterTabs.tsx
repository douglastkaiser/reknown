import { useState } from 'react';
import { partitionCompanyOptions, type CompanyOption } from '../../lib/companies';

/**
 * Sub-tabs that filter the people in the active section by a company from
 * their background. The special `null` value ("All") shows everyone. Because a
 * person can belong to several companies, selecting one shows every person who
 * lists it — the same person can appear under multiple tabs.
 *
 * Companies you share with 2+ people lead the row; the long tail of
 * single-person companies is collapsed behind a "+N more" toggle so the filter
 * stays usable in sections with dozens of one-off employers. A selected
 * single-person company stays pinned so the active filter is always visible.
 */
export function CompanyFilterTabs({
  options,
  activeCompany,
  totalCount,
  onSelect,
  onPractice,
}: {
  options: CompanyOption[];
  activeCompany: string | null;
  totalCount: number;
  onSelect: (company: string | null) => void;
  onPractice?: (company: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);

  if (options.length < 2) return null;

  const { shared, rare } = partitionCompanyOptions(options);

  // Collapsed view leads with shared employers and pins the active company so a
  // selected single-person tab doesn't vanish behind the toggle.
  const activeLower = activeCompany?.toLowerCase() ?? null;
  const collapsed = shared.slice();
  if (activeLower && !collapsed.some((o) => o.name.toLowerCase() === activeLower)) {
    const activeOpt = options.find((o) => o.name.toLowerCase() === activeLower);
    if (activeOpt) collapsed.push(activeOpt);
  }

  const visible = expanded ? options : collapsed;
  const hiddenCount = options.length - visible.length;
  const canToggle = rare.length > 0;

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-muted">Filter by company</span>
        {activeCompany && onPractice ? (
          <button
            type="button"
            onClick={() => onPractice(activeCompany)}
            className="whitespace-nowrap rounded-full border border-accent bg-accent/20 px-3 py-1 text-xs font-medium text-text hover:bg-accent/30"
          >
            Practice {activeCompany} →
          </button>
        ) : null}
      </div>
      <div className="-mx-1 flex items-center gap-1 overflow-x-auto pb-1">
        <button
          type="button"
          onClick={() => onSelect(null)}
          className={
            'whitespace-nowrap rounded-full border px-3 py-1 text-xs transition ' +
            (activeCompany === null
              ? 'border-accent bg-accent/20 text-text'
              : 'border-border text-muted hover:bg-white/5 hover:text-text')
          }
        >
          All ({totalCount})
        </button>
        {visible.map((opt) => {
          const active = activeCompany !== null && activeCompany.toLowerCase() === opt.name.toLowerCase();
          return (
            <button
              key={opt.name.toLowerCase()}
              type="button"
              onClick={() => onSelect(opt.name)}
              className={
                'whitespace-nowrap rounded-full border px-3 py-1 text-xs transition ' +
                (active
                  ? 'border-accent bg-accent/20 text-text'
                  : 'border-border text-muted hover:bg-white/5 hover:text-text')
              }
            >
              {opt.name} ({opt.count})
            </button>
          );
        })}
        {canToggle ? (
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="whitespace-nowrap rounded-full border border-dashed border-border px-3 py-1 text-xs text-muted transition hover:bg-white/5 hover:text-text"
          >
            {expanded ? 'Show fewer' : `+${hiddenCount} more`}
          </button>
        ) : null}
      </div>
    </div>
  );
}
