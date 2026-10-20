import { Link, Outlet } from "@tanstack/react-router";
import { useId } from "react";

const SECTIONS = [
  { to: "/settings/organization", label: "Organization" },
  { to: "/settings/field-tests", label: "Field tests" },
  { to: "/settings/team", label: "Team" },
  { to: "/settings/notifications", label: "Notifications" },
  { to: "/settings/releases", label: "Releases" },
  { to: "/settings/diagnostics", label: "Diagnostics" },
] as const;

export function SettingsLayout() {
  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-[12rem_minmax(0,1fr)]">
      <nav aria-label="Settings" className="flex gap-1 overflow-x-auto md:flex-col">
        {SECTIONS.map((s) => (
          <Link
            key={s.to}
            to={s.to}
            className="rounded-md px-3 py-1.5 whitespace-nowrap text-muted hover:bg-surface-2 data-[status=active]:bg-accent-soft data-[status=active]:font-medium data-[status=active]:text-ink"
          >
            {s.label}
          </Link>
        ))}
      </nav>
      <div className="min-w-0">
        <Outlet />
      </div>
    </div>
  );
}

export function Section({
  title,
  action,
  children,
}: {
  title: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  const id = useId();
  return (
    <section
      aria-labelledby={id}
      className="grid gap-3 rounded-lg border border-line bg-surface p-4"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id={id} className="text-base">
          {title}
        </h2>
        {action}
      </div>
      {children}
    </section>
  );
}
