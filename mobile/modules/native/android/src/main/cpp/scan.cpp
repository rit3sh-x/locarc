#include "scan.h"

#include <android/log.h>
#include <algorithm>
#include <chrono>
#include <cmath>
#include <thread>
#include <unordered_set>

#define LOG_TAG "Scan"
#define LOGI(...) __android_log_print(ANDROID_LOG_INFO, LOG_TAG, __VA_ARGS__)
#define LOGW(...) __android_log_print(ANDROID_LOG_WARN, LOG_TAG, __VA_ARGS__)
#define LOGE(...) __android_log_print(ANDROID_LOG_ERROR, LOG_TAG, __VA_ARGS__)

namespace locarc
{

    namespace
    {

        constexpr int TUNE_SETTLE_MS = 40;
        constexpr int READ_TIMEOUT_MS = 5000;
        constexpr int BULK_TIMEOUT_SHORT_MS = 200;

        const int BASEBAND_BW[] = {
            1'750'000, 2'500'000, 3'500'000, 5'000'000, 5'500'000,
            6'000'000, 7'000'000, 8'000'000, 9'000'000, 10'000'000,
            12'000'000, 14'000'000, 15'000'000, 20'000'000, 24'000'000, 28'000'000};

        std::vector<PowerMeasurement> rejectAliases(
            const std::vector<PowerMeasurement> &in, int sampleRateHz)
        {
            const double fs = sampleRateHz;
            const double tol = 200'000.0;
            const double thrDb = 3.0;
            const double eqEpsDb = 0.5;

            const double offsets[] = {fs, 2.0 * fs};
            std::unordered_set<size_t> dropped;

            for (size_t i = 0; i < in.size(); ++i)
            {
                if (dropped.count(i))
                    continue;
                for (size_t j = 0; j < in.size(); ++j)
                {
                    if (i == j || dropped.count(j))
                        continue;
                    const double dp = in[j].powerDbm - in[i].powerDbm;
                    if (dp <= thrDb)
                        continue;
                    if (std::abs(dp) < eqEpsDb)
                        continue;
                    const double delta = std::abs(in[i].frequencyHz - in[j].frequencyHz);
                    for (double off : offsets)
                    {
                        if (std::abs(delta - off) <= tol)
                        {
                            dropped.insert(i);
                            break;
                        }
                    }
                }
            }

            if (dropped.empty())
                return in;
            std::vector<PowerMeasurement> out;
            out.reserve(in.size() - dropped.size());
            for (size_t i = 0; i < in.size(); ++i)
            {
                if (!dropped.count(i))
                    out.push_back(in[i]);
            }
            LOGI("rejectAliases: dropped %zu aliases", dropped.size());
            return out;
        }

    }

    int computeBasebandFilterBandwidth(int sampleRateHz)
    {
        int bw = BASEBAND_BW[0];
        for (int cand : BASEBAND_BW)
        {
            if (sampleRateHz < cand)
                break;
            bw = cand;
        }
        return bw;
    }

    std::vector<PowerMeasurement> runFullScan(
        HackrfDriver &drv,
        const ScanParams &sp,
        const AlgoConfig &cfg,
        std::atomic<bool> &cancel)
    {

        auto scanStart = std::chrono::steady_clock::now();

        drv.flushPipe();

        drv.setSampleRate((uint32_t)sp.sampleRateHz, 1);
        const int targetBb = (int)(sp.sampleRateHz * 0.75);
        const int bbFilter = computeBasebandFilterBandwidth(std::max(1, targetBb));
        drv.setBasebandFilterBandwidth((uint32_t)bbFilter);
        drv.setLnaGain((uint8_t)sp.lnaGainDb);
        drv.setVgaGain((uint8_t)sp.vgaGainDb);
        LOGI("configured: sr=%d Hz bb=%d Hz lna=%d vga=%d",
             sp.sampleRateHz, bbFilter, sp.lnaGainDb, sp.vgaGainDb);

        const int64_t stepHz = std::max<int64_t>(1, sp.sampleRateHz / 2);
        std::vector<PowerMeasurement> all;
        std::vector<uint8_t> buf(sp.perStepBytes);

        int stepIdx = 0;
        for (int64_t f = sp.minFrequencyHz; f <= sp.maxFrequencyHz; f += stepHz, ++stepIdx)
        {
            if (cancel.load())
            {
                LOGW("scan cancelled at step %d", stepIdx);
                break;
            }

            const auto stepStart = std::chrono::steady_clock::now();
            LOGI("sweep[%d]: tune to %.3f MHz", stepIdx, f / 1e6);

            if (drv.setFrequency((uint64_t)f) != 8)
                continue;
            std::this_thread::sleep_for(std::chrono::milliseconds(TUNE_SETTLE_MS));

            if (drv.setTransceiverMode(HackrfDriver::TRANSCEIVER_MODE_RECEIVE) != 0)
            {
                LOGE("sweep[%d]: startRx failed", stepIdx);
                continue;
            }

            int got = drv.readSamples(buf.data(), sp.perStepBytes, READ_TIMEOUT_MS);
            drv.setTransceiverMode(HackrfDriver::TRANSCEIVER_MODE_OFF);

            if (got < sp.perStepBytes)
            {
                LOGW("sweep[%d]: short read %d/%d; skipping", stepIdx, got, sp.perStepBytes);
                continue;
            }

            bool anyNonZero = false;
            for (int i = 0; i < std::min(got, 16); ++i)
            {
                if (buf[i] != 0)
                {
                    anyNonZero = true;
                    break;
                }
            }
            if (!anyNonZero)
            {
                LOGW("sweep[%d]: zero-filled buffer; skipping", stepIdx);
                continue;
            }

            auto iq = bytesToIqSamples(buf.data(), got);
            SpectrumAnalyzer an((double)f, (double)sp.sampleRateHz, cfg);
            auto m = an.analyze(iq);

            for (auto &x : m)
                all.push_back(x);

            const auto stepEnd = std::chrono::steady_clock::now();
            const auto ms = std::chrono::duration_cast<std::chrono::milliseconds>(
                                stepEnd - stepStart)
                                .count();
            LOGI("sweep[%d]: %zu measurements in %lld ms",
                 stepIdx, m.size(), (long long)ms);
        }

        auto filtered = rejectAliases(all, sp.sampleRateHz);

        drv.flushPipe();

        const auto scanEnd = std::chrono::steady_clock::now();
        const auto totalMs = std::chrono::duration_cast<std::chrono::milliseconds>(
                                 scanEnd - scanStart)
                                 .count();
        LOGI("runFullScan DONE: %d steps, %zu measurements, %lld ms",
             stepIdx, filtered.size(), (long long)totalMs);

        return filtered;
    }

}