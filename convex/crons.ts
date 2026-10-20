import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();
crons.daily("purge old data", { hourUTC: 21, minuteUTC: 30 }, internal.maintenance.purge, {
  fromCron: true,
});
crons.hourly(
  "harvest failed scheduled functions",
  { minuteUTC: 5 },
  internal.errors.harvestFromCron,
  {},
);
export default crons;
