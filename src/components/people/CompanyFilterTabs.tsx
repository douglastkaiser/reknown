import type { CompanyOption } from '../../lib/companies';

/**
 * Sub-tabs that filter the people in the active section by a company from
 * their background. The special `null` value ("All") shows everyone. Because a
 * person can belong to several companies, selecting one shows every person who
 * lists it — the same person can appear under multiple tabs.
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
  if (options.length < 2) return null;

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
        {options.map((opt) => {
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
      </div>
    </div>
  );
}
