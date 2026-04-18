#pragma once

#include "driver.h"
#include "spectrum.h"
#include "algo_config.h"

#include <atomic>
#include <vector>

namespace locarc
{

    struct ScanParams
    {
        int64_t minFrequencyHz;
        int64_t maxFrequencyHz;
        int sampleRateHz;
        int lnaGainDb;
        int vgaGainDb;
        int perStepBytes;
    };

    std::vector<PowerMeasurement> runFullScan(
        HackrfDriver &drv,
        const ScanParams &sp,
        const AlgoConfig &cfg,
        std::atomic<bool> &cancel);

    int computeBasebandFilterBandwidth(int sampleRateHz);

}