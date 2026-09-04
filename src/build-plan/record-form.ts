/** Optional form wiring; product rules and page composition remain agent-owned. */
export const RECORD_FORM_SOURCE = `import { useId, useRef, useState, type FormEvent, type ReactElement, type ReactNode } from "react";

export interface RecordField<Key extends string> {
  key: Key;
  label: string;
  type?: "text" | "email" | "number" | "date" | "textarea" | "select";
  placeholder?: string;
  options?: readonly { value: string; label: string }[];
}

export type FormResult<Key extends string> =
  | { ok: true }
  | { ok: false; errors: Partial<Record<Key, string>>; message?: string };

export interface RecordFormProps<Key extends string> {
  fields: readonly RecordField<Key>[];
  initialValues: Record<Key, string>;
  onSubmit: (values: Record<Key, string>) => FormResult<Key>;
  ariaLabel: string;
  submitLabel: string;
  title?: string;
  resetOnSuccess?: boolean;
  actions?: ReactNode;
  className?: string;
  fieldsClassName?: string;
  actionsClassName?: string;
  submitClassName?: string;
}

// Remount with a React key when switching records. A parent's rerender must
// never replace an in-progress draft with freshly allocated initialValues.
export function RecordForm<Key extends string>({
  fields, initialValues, onSubmit, ariaLabel, submitLabel, title,
  resetOnSuccess = false, actions, className, fieldsClassName = "form-grid",
  actionsClassName = "form-actions", submitClassName = "button-primary",
}: RecordFormProps<Key>): ReactElement {
  const id = useId();
  const form = useRef<HTMLFormElement>(null);
  const [values, setValues] = useState(() => ({ ...initialValues }));
  const [errors, setErrors] = useState<Partial<Record<Key, string>>>({});
  const [message, setMessage] = useState("");

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const result = onSubmit({ ...values });
    if (result.ok) {
      setErrors({});
      setMessage("");
      if (resetOnSuccess) setValues({ ...initialValues });
    } else {
      setErrors(result.errors);
      setMessage(result.message ?? "");
      const first = fields.find((field) => result.errors[field.key]);
      const control = first ? form.current?.elements.namedItem(first.key) : null;
      if (control instanceof HTMLElement) control.focus();
    }
  }

  return <form ref={form} className={className} aria-label={ariaLabel} onSubmit={submit} noValidate>
    {title ? <h2>{title}</h2> : null}
    {message ? <p role="alert" className="field-error">{message}</p> : null}
    <div className={fieldsClassName}>
      {fields.map((field) => {
        const fieldId = id + "-" + field.key;
        const errorId = fieldId + "-error";
        const common = {
          id: fieldId, name: field.key, value: values[field.key], placeholder: field.placeholder,
          "aria-invalid": !!errors[field.key], "aria-describedby": errors[field.key] ? errorId : undefined,
          onChange: (event: { target: { value: string } }) => {
            const value = event.target.value;
            setValues((previous) => ({ ...previous, [field.key]: value }));
          },
        };
        return <div className="field" key={field.key}>
          <label htmlFor={fieldId}>{field.label}</label>
          {field.type === "textarea" ? <textarea {...common} /> : field.type === "select"
            ? <select {...common}>{field.options?.some((option) => option.value === "") ? null : <option value="">{field.placeholder ?? "Choose an option"}</option>}{field.options?.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select>
            : <input {...common} type={field.type ?? "text"} />}
          {errors[field.key] ? <p id={errorId} role="alert" className="field-error">{errors[field.key]}</p> : null}
        </div>;
      })}
    </div>
    <div className={actionsClassName}>
      <button type="submit" className={submitClassName}>{submitLabel}</button>
      {actions}
    </div>
  </form>;
}
`;
