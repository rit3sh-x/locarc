import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

// TODO
// crons.interval(
//     "create batches for active admins",
//     { minutes: 5 },
//     internal.jobs.localization.createBatchesForActiveAdmins
// );

// crons.interval(
//     "dispatch pending batches",
//     { minutes: 5 },
//     internal.jobs.localization.dispatchPendingBatches
// );

crons.interval(
    "cleanup old batches",
    { hours: 1 },
    internal.jobs.localization.cleanupOldBatches
);

crons.interval(
    "cleanup old sdr measurements",
    { hours: 1 },
    internal.jobs.localization.cleanupOldSdrMeasurements
);

crons.interval(
    "mark and cleanup locations",
    { minutes: 15 },
    internal.jobs.localization.cleanupOldLocations
);

export default crons;
