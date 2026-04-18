#pragma once

#include <cstdint>

namespace locarc {

struct Phase1Config {
    double sigBwHz;
    double perOlf;
    double numSamUseRatio;
    double maxTh;
    double kaiserBeta;
    double highpassCutoff;
    double noiseMaxDiff;
    int highpassOrder;
    int noiseMinPeaks;
};

struct Phase2Config {
    double requiredFs1Hz;
    double chSpacingHz;
    double perOlfP1;
    double numSamUseRatioP1;
    double maxThP1;
    double kaiserBetaP1;
    double lpfCutoff;
    double noiseMaxDiffP2;
    double dcGuardHz;
    int lpfOrder;
    int noiseMinPeaksP2;
};

struct ChannelMappingConfig {
    double bandStartFreqHz;
    double bandEndFreqHz;
    double channelSpacingMapHz;
    double powerCalOffsetDb;
    double sidelobeDedupHz;
};

struct AlgoConfig {
    Phase1Config phase1;
    Phase2Config phase2;
    ChannelMappingConfig channelMapping;

    static AlgoConfig fromArrays(const double* d, const int* i);
};

}