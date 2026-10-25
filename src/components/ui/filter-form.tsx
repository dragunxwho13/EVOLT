import Link from "next/link";
import { Field, buttonClass, inputClass } from "./primitives";

export interface FilterSelect {
  name: string;
  label: string;
  value: string | undefined;
  options: { value: string; label: string }[];
  /** Label of the empty option, i.e. what the server does when no value is chosen. */
  anyLabel?: string;
}

/** Plain GET form: works without JavaScript and keeps filters in the URL. */
export function FilterForm({
  action,
  search,
  selects,
}: {
  action: string;
  search?: { name: string; label: string; value: string | undefined; placeholder: string };
  selects: FilterSelect[];
}) {
  const active = Boolean(search?.value) || selects.some((s) => s.value);
  return (
    <form
      action={action}
      method="get"
      className="mb-4 flex flex-wrap items-end gap-3 rounded-lg border border-line bg-surface p-3 sm:p-4"
    >
      {search && (
        <div className="min-w-48 flex-[2]">
          <Field label={search.label} htmlFor={`f-${search.name}`}>
            <input
              id={`f-${search.name}`}
              name={search.name}
              type="search"
              defaultValue={search.value ?? ""}
              placeholder={search.placeholder}
              className={inputClass}
            />
          </Field>
        </div>
      )}
      {selects.map((s) => (
        <div key={s.name} className="min-w-40 flex-1">
          <Field label={s.label} htmlFor={`f-${s.name}`}>
            <select id={`f-${s.name}`} name={s.name} defaultValue={s.value ?? ""} className={inputClass}>
              <option value="">{s.anyLabel ?? "Any"}</option>
              {s.options.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </Field>
        </div>
      ))}
      <div className="flex gap-2">
        <button type="submit" className={buttonClass("primary")}>
          Apply filters
        </button>
        {active && (
          <Link href={action} className={buttonClass("ghost")}>
            Clear
          </Link>
        )}
      </div>
    </form>
  );
}
