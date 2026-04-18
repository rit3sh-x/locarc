#include "spectrum.h"

#include <android/log.h>
#include <algorithm>
#include <cmath>
#include <map>

#define LOG_TAG "Spectrum"
#define LOGD(...) __android_log_print(ANDROID_LOG_DEBUG, LOG_TAG, __VA_ARGS__)

namespace locarc
{

    namespace
    {

        struct ZoomPkResult
        {
            std::vector<double> peakPowersDb;
            std::vector<double> peakFrequencies;
        };

        double minAbsAdjDiff(const std::vector<double> &v)
        {
            if (v.size() < 2)
                return std::numeric_limits<double>::infinity();
            double m = std::numeric_limits<double>::infinity();
            for (size_t i = 1; i < v.size(); ++i)
            {
                m = std::min(m, std::abs(v[i] - v[i - 1]));
            }
            return m;
        }

        double mapToBand(double f, const ChannelMappingConfig &cm)
        {
            const double idx = std::round((f - cm.bandStartFreqHz) / cm.channelSpacingMapHz) + 1.0;
            return cm.bandStartFreqHz + (idx - 1.0) * cm.channelSpacingMapHz;
        }

        ZoomPkResult whAvgFftZoomPk(
            const dsp::Frames &windowed,
            int zoomK,
            int numSamples,
            const RealVec &frequencyAxis,
            double sigBw,
            double maxTh,
            double sumW)
        {
            const int totalFft = numSamples * zoomK;
            const int paddedSize = dsp::nextPowerOf2(totalFft);
            const int framesToUse = windowed.numFragments;

            ComplexVec fftSum(paddedSize, Complex(0.0, 0.0));
            for (int f = 0; f < framesToUse; ++f)
            {
                ComplexVec frame(numSamples);
                const Complex *row = &windowed.data[(size_t)f * numSamples];
                for (int i = 0; i < numSamples; ++i)
                    frame[i] = row[i];

                auto shifted = dsp::fftShifted(frame, paddedSize);
                for (int i = 0; i < paddedSize; ++i)
                    fftSum[i] += shifted[i];
            }

            const int n = std::min(paddedSize, (int)frequencyAxis.size());
            RealVec xasDb(n);
            for (int i = 0; i < n; ++i)
            {
                const double xa = std::abs(fftSum[i]);
                const double xas = 2.0 * xa / sumW;
                xasDb[i] = 20.0 * std::log10(xas + 1e-300);
            }

            ZoomPkResult out;
            if (n == 0)
                return out;

            double maxDb = xasDb[0];
            for (int i = 1; i < n; ++i)
                maxDb = std::max(maxDb, xasDb[i]);
            const double threshold = 20.0 * std::log10(maxTh) + maxDb;

            const double df = (frequencyAxis.size() >= 2)
                                  ? (frequencyAxis[1] - frequencyAxis[0])
                                  : 1.0;
            const int distance = std::max(1, (int)std::round(sigBw / df));

            auto locs = dsp::findPeaks(xasDb, threshold, distance);
            out.peakPowersDb.reserve(locs.size());
            out.peakFrequencies.reserve(locs.size());
            for (int idx : locs)
            {
                double delta = 0.0;
                if (idx > 0 && idx < (int)xasDb.size() - 1)
                {
                    const double ym = xasDb[idx - 1];
                    const double y0 = xasDb[idx];
                    const double yp = xasDb[idx + 1];
                    const double denom = ym - 2.0 * y0 + yp;
                    if (denom != 0.0)
                    {
                        delta = 0.5 * (ym - yp) / denom;
                        if (delta > 1.0) delta = 1.0;
                        else if (delta < -1.0) delta = -1.0;
                    }
                }
                out.peakPowersDb.push_back(xasDb[idx]);
                out.peakFrequencies.push_back(frequencyAxis[idx] + delta * df);
            }
            return out;
        }

    }

    SpectrumAnalyzer::SpectrumAnalyzer(double centerFreqHz, double bbSampleRate,
                                       const AlgoConfig &cfg)
        : centerFreqHz_(centerFreqHz), bbSampleRate_(bbSampleRate), cfg_(cfg) {}

    std::vector<PowerMeasurement> SpectrumAnalyzer::analyze(const ComplexVec &iqData)
    {
        const auto &p1 = cfg_.phase1;
        const auto &p2 = cfg_.phase2;
        const auto &cm = cfg_.channelMapping;

        auto hp = dsp::butter(p1.highpassOrder, p1.highpassCutoff, true);
        auto data = dsp::filtfilt(hp, iqData);

        const int frameSize = (int)data.size();
        const int numSamUseM = std::max(2, (int)(p1.numSamUseRatio * frameSize));
        const int zoomK = std::max(1, frameSize / numSamUseM);

        auto w3 = dsp::kaiserWindow(numSamUseM, p1.kaiserBeta);
        double sumW3 = 0.0;
        for (double v : w3)
            sumW3 += v;

        auto frames = dsp::generateOverlappingFrames(p1.perOlf, data, numSamUseM);
        for (int i = 0; i < frames.numFragments; ++i)
        {
            Complex *row = &frames.data[(size_t)i * numSamUseM];
            for (int j = 0; j < numSamUseM; ++j)
                row[j] *= w3[j];
        }

        const int totalFft1 = numSamUseM * zoomK;
        const double freqStep = bbSampleRate_ / totalFft1;
        RealVec freqAxis(totalFft1);
        for (int i = 0; i < totalFft1; ++i)
        {
            freqAxis[i] = -bbSampleRate_ / 2.0 + i * freqStep;
        }

        auto phase1 = whAvgFftZoomPk(frames, zoomK, numSamUseM, freqAxis,
                                     p1.sigBwHz, p1.maxTh, sumW3);

        const double passHalf = bbSampleRate_ / 4.0;
        std::vector<double> primaryF, primaryP;
        primaryF.reserve(phase1.peakFrequencies.size());
        primaryP.reserve(phase1.peakPowersDb.size());
        for (size_t k = 0; k < phase1.peakFrequencies.size(); ++k)
        {
            if (std::abs(phase1.peakFrequencies[k]) <= passHalf)
            {
                primaryF.push_back(phase1.peakFrequencies[k]);
                primaryP.push_back(phase1.peakPowersDb[k]);
            }
        }

        if ((int)primaryF.size() > p1.noiseMinPeaks &&
            minAbsAdjDiff(primaryP) < p1.noiseMaxDiff)
        {
            LOGD("phase1: noisy (%zu peaks, flat) -> skip", primaryF.size());
            return {};
        }

        std::vector<double> globalFreqs, globalPowers;

        for (size_t pk = 0; pk < primaryF.size(); ++pk)
        {
            const double freq1 = primaryF[pk];

            auto shifted = dsp::frequencyShift(data, bbSampleRate_, -freq1);
            auto decimated = dsp::lpfAndDownsample(p2.lpfOrder, p2.lpfCutoff, shifted,
                                                   bbSampleRate_, p2.requiredFs1Hz);

            const int numSamP1 = std::max(2, (int)((int)decimated.size() * p2.numSamUseRatioP1));
            const int zoomKP1 = std::max(1, (int)decimated.size() / numSamP1);

            auto w3P1 = dsp::kaiserWindow(numSamP1, p2.kaiserBetaP1);
            double sumW3P1 = 0.0;
            for (double v : w3P1)
                sumW3P1 += v;

            auto framesP1 = dsp::generateOverlappingFrames(p2.perOlfP1, decimated, numSamP1);
            for (int i = 0; i < framesP1.numFragments; ++i)
            {
                Complex *row = &framesP1.data[(size_t)i * numSamP1];
                for (int j = 0; j < numSamP1; ++j)
                    row[j] *= w3P1[j];
            }

            const int totalFft2 = numSamP1 * zoomKP1;
            const double freqStepP1 = p2.requiredFs1Hz / totalFft2;
            RealVec axisP1(totalFft2);
            for (int i = 0; i < totalFft2; ++i)
            {
                axisP1[i] = -p2.requiredFs1Hz / 2.0 + i * freqStepP1;
            }

            auto phase2 = whAvgFftZoomPk(framesP1, zoomKP1, numSamP1, axisP1,
                                         p2.chSpacingHz, p2.maxThP1, sumW3P1);

            if ((int)phase2.peakFrequencies.size() >= p2.noiseMinPeaksP2 &&
                minAbsAdjDiff(phase2.peakPowersDb) <= p2.noiseMaxDiffP2)
            {
                continue;
            }

            for (size_t idx = 0; idx < phase2.peakFrequencies.size(); ++idx)
            {
                const double freq2 = phase2.peakFrequencies[idx];
                const double offset = freq1 + freq2;
                globalFreqs.push_back(centerFreqHz_ + offset);
                globalPowers.push_back(phase2.peakPowersDb[idx]);
            }
        }

        std::map<double, double> preSnap;
        for (size_t i = 0; i < globalFreqs.size(); ++i)
        {
            auto it = preSnap.find(globalFreqs[i]);
            if (it == preSnap.end() || globalPowers[i] > it->second)
            {
                preSnap[globalFreqs[i]] = globalPowers[i];
            }
        }

        std::vector<std::pair<double, double>> sorted(preSnap.begin(), preSnap.end());
        std::sort(sorted.begin(), sorted.end(),
                  [](const auto &a, const auto &b)
                  { return a.first < b.first; });

        std::map<double, double> clustered;
        if (!sorted.empty())
        {
            double clusterFreq = sorted[0].first;
            double clusterPw = sorted[0].second;
            double prevFreq = clusterFreq;
            for (size_t i = 1; i < sorted.size(); ++i)
            {
                const double f = sorted[i].first;
                const double pw = sorted[i].second;
                if (f - prevFreq > cm.sidelobeDedupHz)
                {
                    clustered[clusterFreq] = clusterPw;
                    clusterFreq = f;
                    clusterPw = pw;
                }
                else if (pw > clusterPw)
                {
                    clusterPw = pw;
                    clusterFreq = f;
                }
                prevFreq = f;
            }
            clustered[clusterFreq] = clusterPw;
        }

        std::vector<PowerMeasurement> out;
        out.reserve(clustered.size());
        for (const auto &kv : clustered)
        {
            const double rawF = kv.first;
            const double pw = kv.second;
            if (rawF < cm.bandStartFreqHz || rawF > cm.bandEndFreqHz)
                continue;
            out.push_back({rawF, pw + cm.powerCalOffsetDb});
        }
        return out;
    }

    ComplexVec bytesToIqSamples(const uint8_t *bytes, int byteCount)
    {
        const int n = byteCount / 2;
        ComplexVec out(n);
        for (int i = 0; i < n; ++i)
        {
            const int8_t i8 = (int8_t)bytes[i * 2];
            const int8_t q8 = (int8_t)bytes[i * 2 + 1];
            out[i] = Complex((double)i8 / 128.0, (double)q8 / 128.0);
        }
        return out;
    }

}