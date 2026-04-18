#include "algo_config.h"

namespace locarc
{

    AlgoConfig AlgoConfig::fromArrays(const double *d, const int *i)
    {
        AlgoConfig c;

        c.phase1.sigBwHz = d[0];
        c.phase1.perOlf = d[1];
        c.phase1.numSamUseRatio = d[2];
        c.phase1.maxTh = d[3];
        c.phase1.kaiserBeta = d[4];
        c.phase1.highpassCutoff = d[5];
        c.phase1.noiseMaxDiff = d[6];
        c.phase1.highpassOrder = i[0];
        c.phase1.noiseMinPeaks = i[1];

        c.phase2.requiredFs1Hz = d[7];
        c.phase2.chSpacingHz = d[8];
        c.phase2.perOlfP1 = d[9];
        c.phase2.numSamUseRatioP1 = d[10];
        c.phase2.maxThP1 = d[11];
        c.phase2.kaiserBetaP1 = d[12];
        c.phase2.lpfCutoff = d[13];
        c.phase2.noiseMaxDiffP2 = d[14];
        c.phase2.dcGuardHz = d[15];
        c.phase2.lpfOrder = i[2];
        c.phase2.noiseMinPeaksP2 = i[3];

        c.channelMapping.bandStartFreqHz = d[16];
        c.channelMapping.bandEndFreqHz = d[17];
        c.channelMapping.channelSpacingMapHz = d[18];
        c.channelMapping.powerCalOffsetDb = d[19];
        c.channelMapping.sidelobeDedupHz = d[20];

        return c;
    }

}