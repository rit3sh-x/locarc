import { Link, Outlet, useNavigate } from "@tanstack/react-router";
import { useQuery } from "convex/react";
import { Menu as MenuIcon, UserRound } from "lucide-react";
import { useEffect } from "react";
import { api } from "@/convex/_generated/api";
import { env } from "../env";
import { authClient } from "../lib/auth";
import { useOpenTabNotifications } from "../lib/notify";
import { type Theme, useTheme } from "../lib/theme";

import { AlertBell } from "./alerts-feed";
import { ScanControl } from "./scan-control";
import { buttonVariants } from "./ui/button";
import {
  Menu,
  MenuContent,
  MenuItem,
  MenuLabel,
  MenuLinkItem,
  MenuRadioGroup,
  MenuRadioItem,
  MenuSeparator,
  MenuTrigger,
} from "./ui/menu";
import { UsageMeter } from "./usage-meter";

const TABS = [
  { to: "/", label: "Overview" },
  { to: "/map", label: "Map" },
  { to: "/scans", label: "Scans" },
  { to: "/receivers", label: "Receivers" },
  { to: "/watchlist", label: "Watchlist" },
  { to: "/settings", label: "Settings" },
] as const;

export function Shell() {
  const me = useQuery(api.operators.me);
  // Hot subscription held for every page, so tabs switch without re-subscribing.
  useQuery(api.live.receiverStatuses);
  useQuery(api.live.run);
  useOpenTabNotifications();
  const navigate = useNavigate();

  // A removed Operator's token is still valid for a few minutes, but the row is gone.
  useEffect(() => {
    if (me === null) void authClient.signOut().then(() => navigate({ to: "/sign-in" }));
  }, [me, navigate]);

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="sticky top-0 z-40 border-b border-line bg-surface">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 pt-2.5 pb-1">
          <TabMenu />
          <span className="font-semibold" data-testid="org-name">
            {me?.organization ?? " "}
          </span>
          <ScanControl />
          <div className="ml-auto flex items-center gap-2">
            <UsageMeter />
            <AlertBell />
            <AccountMenu name={me?.name ?? ""} email={me?.email ?? ""} />
          </div>
        </div>
        <nav aria-label="Main" className="hidden gap-0.5 overflow-x-auto px-4 sm:flex">
          {TABS.map((t) => (
            <Link
              key={t.to}
              to={t.to}
              activeOptions={{ exact: t.to === "/" }}
              className="border-b-2 border-transparent px-3.5 py-2.5 whitespace-nowrap text-muted data-[status=active]:border-accent data-[status=active]:font-medium data-[status=active]:text-ink"
            >
              {t.label}
            </Link>
          ))}
        </nav>
      </header>
      <main className="mx-auto w-full max-w-[1400px] flex-1 p-4 pb-16">
        <Outlet />
      </main>
    </div>
  );
}

function TabMenu() {
  return (
    <Menu>
      <MenuTrigger
        aria-label="Open navigation"
        className={buttonVariants({ variant: "ghost", size: "sm", className: "sm:hidden" })}
      >
        <MenuIcon className="size-4" />
      </MenuTrigger>
      <MenuContent align="start">
        {TABS.map((t) => (
          <MenuLinkItem key={t.to} render={<Link to={t.to} />}>
            {t.label}
          </MenuLinkItem>
        ))}
      </MenuContent>
    </Menu>
  );
}

function AccountMenu({ name, email }: { name: string; email: string }) {
  const [theme, setTheme] = useTheme();
  const navigate = useNavigate();
  return (
    <Menu>
      <MenuTrigger
        aria-label="Account"
        className={buttonVariants({ variant: "ghost", size: "sm" })}
      >
        <UserRound className="size-4" />
        <span className="hidden md:inline">{name}</span>
      </MenuTrigger>
      <MenuContent>
        <MenuLabel>
          <div className="font-medium text-ink">{name}</div>
          <div>{email}</div>
        </MenuLabel>
        <MenuSeparator />
        <MenuLabel>Theme</MenuLabel>
        <MenuRadioGroup value={theme} onValueChange={(v) => setTheme(v as Theme)}>
          <MenuRadioItem value="system">System</MenuRadioItem>
          <MenuRadioItem value="light">Light</MenuRadioItem>
          <MenuRadioItem value="dark">Dark</MenuRadioItem>
        </MenuRadioGroup>
        <MenuSeparator />
        <MenuLabel>
          Version <span className="num">{env.VITE_WEB_VERSION}</span>
        </MenuLabel>
        <MenuItem
          onClick={async () => {
            await authClient.signOut();
            await navigate({ to: "/sign-in" });
          }}
        >
          Sign out
        </MenuItem>
      </MenuContent>
    </Menu>
  );
}
