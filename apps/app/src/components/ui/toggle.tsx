interface ToggleProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label?: string;
  description?: string;
  disabled?: boolean;
}

export function Toggle({ checked, onChange, label, description, disabled }: ToggleProps) {
  return (
    <label className="flex cursor-pointer items-center justify-between gap-4 py-0.5">
      {(label || description) && (
        <div className="min-w-0">
          {label && <div className="text-sm text-stone-200">{label}</div>}
          {description && <div className="mt-0.5 text-xs text-stone-500">{description}</div>}
        </div>
      )}
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className="md-toggle shrink-0 disabled:opacity-40"
      >
        <span className="md-toggle-thumb" />
      </button>
    </label>
  );
}

export function ToggleRow({ label, description, checked, onChange, disabled }: ToggleProps) {
  return (
    <div className="settings-row">
      <div className="min-w-0">
        <div className="text-sm text-stone-200">{label}</div>
        {description && <div className="mt-0.5 text-xs text-stone-500">{description}</div>}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className="md-toggle shrink-0 disabled:opacity-40"
      >
        <span className="md-toggle-thumb" />
      </button>
    </div>
  );
}
