import type { ButtonHTMLAttributes, ReactNode } from 'react';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost';
  loading?: boolean;
  children: ReactNode;
}

export function Button({ variant = 'secondary', loading = false, className = '', disabled, children, ...props }: ButtonProps) {
  return (
    <button
      className={`lumer-button lumer-button-${variant} ${className}`}
      disabled={disabled || loading}
      {...props}
    >
      {loading && <span className="lumer-spinner" aria-hidden="true" />}
      {children}
    </button>
  );
}
