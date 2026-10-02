/** A row of buttons of which one is pressed. */
export function Toggle<T extends string>({ label, onChange, options, value }: { label: string; onChange: (value: T) => void; options: [T, string][]; value: T }) {
  return (
    <div aria-label={label} className="toggle" role="group">
      {options.map(([option, text]) => (
        <button aria-pressed={value === option} key={option} onClick={() => onChange(option)} type="button">
          {text}
        </button>
      ))}
    </div>
  );
}
