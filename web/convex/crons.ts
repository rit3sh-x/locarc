import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

crons.interval(
    "dispatch pending batches",
    { minutes: 5 },
    internal.jobs.localiation.dispatchPendingBatches
);

crons.interval(
    "cleanup old batches",
    { hours: 1 },
    internal.jobs.localiation.cleanupOldBatches
);

export default crons;
