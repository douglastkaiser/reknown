import type { ButtonHTMLAttributes, PropsWithChildren } from 'react';

export function Button({ children, className = '', ...props }: PropsWithChildren<ButtonHTMLAttributes<HTMLButtonElement>>) {
  return (
    <button
      className={`rounded-xl border border-border bg-accent/20 px-3 py-2 text-sm font-medium text-text hover:bg-accent/30 disabled:opacity-50 ${className}`}
      {...props}
    >
      {children}
    </button>
  );
}
