#include "dsp.h"

#include <algorithm>
#include <cmath>
#include <cstring>
#include <mutex>
#include <unordered_map>

extern "C"
{
#include "kiss_fft.h"
}

namespace locarc
{
    namespace dsp
    {

        namespace
        {
            constexpr double PI = 3.14159265358979323846;

            struct PlanCache
            {
                std::unordered_map<int, kiss_fft_cfg> plans;
                std::mutex mu;

                kiss_fft_cfg get(int n)
                {
                    std::lock_guard<std::mutex> lk(mu);
                    auto it = plans.find(n);
                    if (it != plans.end())
                        return it->second;
                    kiss_fft_cfg cfg = kiss_fft_alloc(n, 0, nullptr, nullptr);
                    plans[n] = cfg;
                    return cfg;
                }
            };
            PlanCache &planCache()
            {
                static PlanCache pc;
                return pc;
            }
        }

        FilterCoeffs butter(int order, double cutoff, bool highPass)
        {
            FilterCoeffs c;
            const double wc = std::tan(PI * cutoff);

            if (order == 1)
            {
                if (highPass)
                {
                    const double d = 1.0 + wc;
                    c.b = {1.0 / d, -1.0 / d};
                    c.a = {1.0, (wc - 1.0) / d};
                }
                else
                {
                    const double d = 1.0 + wc;
                    c.b = {wc / d, wc / d};
                    c.a = {1.0, (wc - 1.0) / d};
                }
            }
            else if (order == 2)
            {
                const double s2 = std::sqrt(2.0);
                const double wc2 = wc * wc;
                const double d = 1.0 + s2 * wc + wc2;
                c.b = {wc2 / d, 2.0 * wc2 / d, wc2 / d};
                c.a = {1.0, 2.0 * (wc2 - 1.0) / d, (1.0 - s2 * wc + wc2) / d};
            }
            else
            {
                const double d = 1.0 + wc;
                c.b = {wc / d, wc / d};
                c.a = {1.0, (wc - 1.0) / d};
            }
            return c;
        }

        ComplexVec filtfilt(const FilterCoeffs &c, const ComplexVec &input)
        {
            const int n = (int)input.size();
            if (n == 0)
                return {};
            ComplexVec fwd(n);
            const auto &b = c.b;
            const auto &a = c.a;

            fwd[0] = input[0] * b[0];
            for (int i = 1; i < n; ++i)
            {
                Complex acc(0.0, 0.0);
                for (size_t j = 0; j < b.size(); ++j)
                {
                    if ((int)j <= i)
                        acc += input[i - j] * b[j];
                }
                for (size_t j = 1; j < a.size(); ++j)
                {
                    if ((int)j <= i)
                        acc -= fwd[i - j] * a[j];
                }
                fwd[i] = acc;
            }

            ComplexVec out(n);
            out[n - 1] = fwd[n - 1] * b[0];
            for (int i = n - 2; i >= 0; --i)
            {
                Complex acc(0.0, 0.0);
                for (size_t j = 0; j < b.size(); ++j)
                {
                    if (i + (int)j < n)
                        acc += fwd[i + j] * b[j];
                }
                for (size_t j = 1; j < a.size(); ++j)
                {
                    if (i + (int)j < n)
                        acc -= out[i + j] * a[j];
                }
                out[i] = acc;
            }
            return out;
        }

        ComplexVec decimate(const ComplexVec &signal, int factor)
        {
            if (factor <= 1)
                return signal;
            const int n = (int)signal.size();
            const int outSize = (n + factor - 1) / factor;
            ComplexVec out(outSize);
            for (int i = 0; i < outSize; ++i)
                out[i] = signal[i * factor];
            return out;
        }

        ComplexVec lpfAndDownsample(int order, double cutoff, const ComplexVec &signal,
                                    double currentSr, double newSr)
        {
            auto c = butter(order, cutoff, false);
            auto filtered = filtfilt(c, signal);
            const int r = std::max(1, (int)(currentSr / newSr));
            return decimate(filtered, r);
        }

        double besselI0(double x)
        {
            double sum = 1.0;
            double term = 1.0;
            const double xHalfSq = (x / 2.0) * (x / 2.0);
            for (int k = 1; k < 50; ++k)
            {
                term *= xHalfSq / ((double)k * (double)k);
                sum += term;
                if (term < 1e-12 * sum)
                    break;
            }
            return sum;
        }

        RealVec kaiserWindow(int n, double beta)
        {
            RealVec w(n);
            const double alpha = (n - 1) / 2.0;
            const double denom = besselI0(beta);
            for (int i = 0; i < n; ++i)
            {
                const double arg = (i - alpha) / alpha;
                const double x = beta * std::sqrt(1.0 - arg * arg);
                w[i] = besselI0(x) / denom;
            }
            return w;
        }

        std::vector<int> findPeaks(const RealVec &data, double height, int distance)
        {
            std::vector<int> peaks;
            const int n = (int)data.size();
            for (int i = 1; i < n - 1; ++i)
            {
                if (data[i] > height && data[i] >= data[i - 1] && data[i] >= data[i + 1])
                {
                    if (data[i] > data[i - 1] || data[i] > data[i + 1])
                    {
                        peaks.push_back(i);
                    }
                }
            }
            if (distance > 0 && !peaks.empty())
            {
                std::vector<char> keep(peaks.size(), 1);
                for (size_t i = 0; i < peaks.size(); ++i)
                {
                    if (!keep[i])
                        continue;
                    for (size_t j = i + 1; j < peaks.size(); ++j)
                    {
                        if (std::abs(peaks[j] - peaks[i]) < distance)
                        {
                            if (data[peaks[j]] > data[peaks[i]])
                            {
                                keep[i] = 0;
                                break;
                            }
                            else
                            {
                                keep[j] = 0;
                            }
                        }
                    }
                }
                std::vector<int> out;
                out.reserve(peaks.size());
                for (size_t i = 0; i < peaks.size(); ++i)
                    if (keep[i])
                        out.push_back(peaks[i]);
                return out;
            }
            return peaks;
        }

        ComplexVec frequencyShift(const ComplexVec &signal, double sampleRate, double freqShift)
        {
            const int n = (int)signal.size();
            ComplexVec out(n);
            for (int i = 0; i < n; ++i)
            {
                const double t = (double)i / sampleRate;
                const double phase = 2.0 * PI * freqShift * t;
                out[i] = signal[i] * Complex(std::cos(phase), std::sin(phase));
            }
            return out;
        }

        Frames generateOverlappingFrames(double overlapFraction, const ComplexVec &frame, int m)
        {
            Frames f{};
            f.m = m;
            const int frameSize = (int)frame.size();
            const int overlap = (int)std::round(overlapFraction * m);
            const int stepSize = m - overlap;
            if (stepSize <= 0 || m <= 0 || frameSize < m)
            {
                f.numFragments = 0;
                return f;
            }

            int numFragments = (int)std::floor((double)(frameSize - m) / stepSize) + 2;

            if (overlapFraction != 0.0)
            {
                f.data.resize((size_t)numFragments * m);
                for (int i = 1; i < numFragments; ++i)
                {
                    const int start = (i - 1) * stepSize;
                    for (int j = 0; j < m; ++j)
                    {
                        f.data[(i - 1) * (size_t)m + j] =
                            (start + j < frameSize) ? frame[start + j] : Complex(0.0, 0.0);
                    }
                }
                const int lastRow = numFragments - 1;
                for (int j = 0; j < m; ++j)
                {
                    f.data[lastRow * (size_t)m + j] = frame[frameSize - m + j];
                }
            }
            else
            {
                numFragments -= 1;
                f.data.resize((size_t)numFragments * m);
                for (int i = 1; i <= numFragments; ++i)
                {
                    const int start = (i - 1) * stepSize;
                    for (int j = 0; j < m; ++j)
                    {
                        f.data[(i - 1) * (size_t)m + j] =
                            (start + j < frameSize) ? frame[start + j] : Complex(0.0, 0.0);
                    }
                }
            }
            f.numFragments = numFragments;
            return f;
        }

        void fftForward(ComplexVec &data)
        {
            const int n = (int)data.size();
            if (n <= 0)
                return;
            kiss_fft_cfg cfg = planCache().get(n);
            kiss_fft(cfg, reinterpret_cast<const kiss_fft_cpx *>(data.data()),
                     reinterpret_cast<kiss_fft_cpx *>(data.data()));
        }

        ComplexVec fftShifted(const ComplexVec &input, int totalSize)
        {
            ComplexVec padded(totalSize, Complex(0.0, 0.0));
            const int n = std::min((int)input.size(), totalSize);
            for (int i = 0; i < n; ++i)
                padded[i] = input[i];

            fftForward(padded);

            ComplexVec shifted(totalSize);
            const int half = totalSize / 2;
            for (int i = 0; i < totalSize; ++i)
            {
                shifted[(i + half) % totalSize] = padded[i];
            }
            return shifted;
        }

        int nextPowerOf2(int n)
        {
            if (n <= 1)
                return 1;
            int p = 1;
            while (p < n)
                p <<= 1;
            return p;
        }

    }
}
