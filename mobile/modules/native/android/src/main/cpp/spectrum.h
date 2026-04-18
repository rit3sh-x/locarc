#pragma once

#include "algo_config.h"
#include "dsp.h"

#include <vector>

namespace locarc
{

    struct PowerMeasurement
    {
        double frequencyHz;
        double powerDbm;
    };

    class SpectrumAnalyzer
    {
    public:
        SpectrumAnalyzer(double centerFreqHz, double bbSampleRate, const AlgoConfig &cfg);

        std::vector<PowerMeasurement> analyze(const ComplexVec &iqData);

    private:
        double centerFreqHz_;
        double bbSampleRate_;
        AlgoConfig cfg_;
    };

    ComplexVec bytesToIqSamples(const uint8_t *bytes, int byteCount);

}
