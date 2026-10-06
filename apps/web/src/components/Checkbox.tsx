import type { ReactNode } from 'react';

export interface CheckboxProps {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  label: ReactNode;
  description?: ReactNode | undefined;
  disabled?: boolean | undefined;
  disabledReason?: string | undefined;
  name?: string | undefined;
  required?: boolean | undefined;
}

export function Checkbox({ checked, onCheckedChange, label, description, disabled, disabledReason, name, required }: CheckboxProps) {
  const isDisabled = disabled || !!disabledReason;
  return (
    <label className="check" title={disabledReason}>
      <input type="checkbox" name={name} checked={checked} disabled={isDisabled} required={required} onChange={(e) => onCheckedChange(e.currentTarget.checked)} />
      <span className="check__text">
        <span>{label}</span>
        {description ? <span className="inline-note">{description}</span> : null}
        {disabledReason ? <span className="inline-note">{disabledReason}</span> : null}
      </span>
    </label>
  );
}

export interface RadioGroupProps {
  name: string;
  value: string | null;
  onValueChange: (value: string) => void;
  options: Array<{ value: string; label: ReactNode; description?: ReactNode }>;
  legend: ReactNode;
  disabled?: boolean | undefined;
  describedBy?: string | undefined;
}

/** 既定選択なし（null）を表せるラジオ群。法的判断を含む項目で使う */
export function RadioGroup({ name, value, onValueChange, options, legend, disabled, describedBy }: RadioGroupProps) {
  return (
    <fieldset style={{ border: 0, padding: 0, margin: 0 }} aria-describedby={describedBy}>
      <legend className="field__label">{legend}</legend>
      <div className="radio-group">
        {options.map((o) => (
          <label key={o.value} className="check">
            <input type="radio" name={name} value={o.value} checked={value === o.value} disabled={disabled} onChange={() => onValueChange(o.value)} />
            <span className="check__text">
              <span>{o.label}</span>
              {o.description ? <span className="inline-note">{o.description}</span> : null}
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}
