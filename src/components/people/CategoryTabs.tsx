import type { Category } from '../../types';

export function CategoryTabs({
  categories,
  activeId,
  onSelect,
  onCreate,
}: {
  categories: Category[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onCreate: () => void;
}) {
  return (
    <div className="-mx-1 flex items-center gap-1 overflow-x-auto pb-1">
      {categories.map((cat) => {
        const active = cat.id === activeId;
        return (
          <button
            key={cat.id}
            type="button"
            onClick={() => onSelect(cat.id)}
            className={
              'whitespace-nowrap rounded-full border px-3 py-1.5 text-sm transition ' +
              (active
                ? 'border-accent bg-accent/20 text-text'
                : 'border-border text-muted hover:bg-white/5 hover:text-text')
            }
          >
            {cat.name}
          </button>
        );
      })}
      <button
        type="button"
        onClick={onCreate}
        className="whitespace-nowrap rounded-full border border-dashed border-border px-3 py-1.5 text-sm text-muted hover:bg-white/5 hover:text-text"
      >
        + New section
      </button>
    </div>
  );
}
