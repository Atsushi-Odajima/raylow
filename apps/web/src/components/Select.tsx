import type { SelectHTMLAttributes } from 'react';

export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean | undefined;
}
export interface SelectProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, 'onChange' | 'value'> {
  value: string;
  onValueChange: (value: string) => void;
  options: SelectOption[];
  /** 先頭に置く未選択項目（legalJudgement 項目などは必ず未選択から始める） */
  placeholder?: string | undefined;
  invalid?: boolean | undefined;
}

export function Select({ value, onValueChange, options, placeholder, invalid, className, ...rest }: SelectProps) {
  return (
    <select {...rest} className={['select', className ?? ''].join(' ').trim()} value={value} aria-invalid={invalid || undefined} onChange={(e) => onValueChange(e.currentTarget.value)}>
      {placeholder !== undefined ? <option value="">{placeholder}</option> : null}
      {options.map((o) => (
        <option key={o.value} value={o.value} disabled={o.disabled}>
          {o.label}
        </option>
      ))}
    </select>
  );
}
