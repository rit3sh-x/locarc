import {
  createRootRouteWithContext,
  createRoute,
  createRouter,
  Outlet,
  redirect,
} from "@tanstack/react-router";
import { z } from "zod";
import { RouteError } from "./components/route-error";
import { Shell } from "./components/shell";
import { DiagnosticsPage } from "./pages/diagnostics";
import { EmitterPage } from "./pages/emitter";
import { FieldTestsPage } from "./pages/field-tests";

import { InvitePage } from "./pages/invite";

import { MapPage } from "./pages/map";

import { NotificationsPage } from "./pages/notifications";
import { OrganizationPage } from "./pages/organization";
import { OverviewPage } from "./pages/overview";

import { ReceiverPage } from "./pages/receiver";
import { ReceiversPage } from "./pages/receivers";
import { ReleasesPage } from "./pages/releases";

import { ResetPage } from "./pages/reset";
import { ScanDetailPage } from "./pages/scan-detail";
import { ScansPage } from "./pages/scans";

import { SettingsLayout } from "./pages/settings";
import { SignInPage } from "./pages/sign-in";
import { TeamPage } from "./pages/team";
import { WatchlistPage } from "./pages/watchlist";

export type RouterContext = { auth: { isAuthenticated: boolean } };

const root = createRootRouteWithContext<RouterContext>()({ component: Outlet });

const signIn = createRoute({
  getParentRoute: () => root,
  path: "/sign-in",
  validateSearch: z.object({ redirect: z.string().optional() }),
  component: SignInPage,
});

const invite = createRoute({
  getParentRoute: () => root,
  path: "/invite/$token",
  component: InvitePage,
});

const reset = createRoute({
  getParentRoute: () => root,
  path: "/reset/$token",
  component: ResetPage,
});

const app = createRoute({
  getParentRoute: () => root,
  id: "app",
  beforeLoad: ({ context, location }) => {
    if (!context.auth.isAuthenticated) {
      throw redirect({ to: "/sign-in", search: { redirect: location.href } });
    }
  },
  component: Shell,
  errorComponent: RouteError,
});

const overview = createRoute({ getParentRoute: () => app, path: "/", component: OverviewPage });
const map = createRoute({
  getParentRoute: () => app,
  path: "/map",
  validateSearch: z.object({
    at: z.number().optional(),
    show: z.enum(["all", "watched", "intermittent"]).optional(),
    em: z.number().optional(),
  }),
  component: MapPage,
});
const emitter = createRoute({
  getParentRoute: () => app,
  path: "/emitters/$freqHz",
  component: EmitterPage,
});
const receiver = createRoute({
  getParentRoute: () => app,
  path: "/receivers/$receiverId",
  component: ReceiverPage,
});
const scans = createRoute({
  getParentRoute: () => app,
  path: "/scans",
  validateSearch: z.object({
    run: z.number().optional(),
    state: z.enum(["collecting", "localizing", "done", "no_fix", "failed", "discarded"]).optional(),
  }),
  component: ScansPage,
});
const scanDetail = createRoute({
  getParentRoute: () => app,
  path: "/scans/$run/$k",
  component: ScanDetailPage,
});
const receivers = createRoute({
  getParentRoute: () => app,
  path: "/receivers",
  component: ReceiversPage,
});
const watchlist = createRoute({
  getParentRoute: () => app,
  path: "/watchlist",
  component: WatchlistPage,
});
const settings = createRoute({
  getParentRoute: () => app,
  path: "/settings",
  component: SettingsLayout,
});
const settingsIndex = createRoute({
  getParentRoute: () => settings,
  path: "/",
  beforeLoad: () => {
    throw redirect({ to: "/settings/organization" });
  },
});
const organization = createRoute({
  getParentRoute: () => settings,
  path: "organization",
  component: OrganizationPage,
});
const fieldTests = createRoute({
  getParentRoute: () => settings,
  path: "field-tests",
  component: FieldTestsPage,
});
const team = createRoute({ getParentRoute: () => settings, path: "team", component: TeamPage });
const notifications = createRoute({
  getParentRoute: () => settings,
  path: "notifications",
  component: NotificationsPage,
});
const releases = createRoute({
  getParentRoute: () => settings,
  path: "releases",
  component: ReleasesPage,
});
const diagnostics = createRoute({
  getParentRoute: () => settings,
  path: "diagnostics",
  component: DiagnosticsPage,
});

export const routeTree = root.addChildren([
  signIn,
  invite,
  reset,
  app.addChildren([
    overview,
    map,
    scanDetail,
    emitter,
    receiver,
    scans,
    receivers,
    watchlist,
    settings.addChildren([
      settingsIndex,
      organization,
      fieldTests,
      team,
      notifications,
      releases,
      diagnostics,
    ]),
  ]),
]);

export const router = createRouter({
  routeTree,
  context: { auth: { isAuthenticated: false } },
  defaultPreload: "intent",
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
