import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

crons.interval(
    "create batches for active admins",
    { minutes: 5 },
    internal.jobs.localization.createBatchesForActiveAdmins
);

crons.interval(
    "dispatch pending batches",
    { minutes: 5 },
    internal.jobs.localization.dispatchPendingBatches
);

crons.interval(
    "cleanup old batches",
    { hours: 1 },
    internal.jobs.localization.cleanupOldBatches
);

export default crons;
