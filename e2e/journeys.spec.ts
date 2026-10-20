// The journeys, in run order (one worker): later ones reuse what earlier ones set up, such as
// the fleet pairing pairs. Run one with `bunx playwright test -g <title>`. They share this file, so
// a journey sets options (viewport, permissions) inside its test: a top-level `test.use` applies to all.
import "./journeys/setup-sign-in";
import "./journeys/team";
import "./journeys/pairing";
import "./journeys/scanning";
import "./journeys/scan-detail";
import "./journeys/new-emitter";
import "./journeys/health";
import "./journeys/org-config";
import "./journeys/receiver-config";
import "./journeys/calibration";
import "./journeys/field-test";
import "./journeys/receiver-lifecycle";
import "./journeys/map";
import "./journeys/diagnostics";
import "./journeys/releases";
import "./journeys/stop";
import "./journeys/push";
import "./journeys/layout";
