#pragma once

#include <complex>
#include <vector>

namespace locarc
{

    using Complex = std::complex<double>;
    using ComplexVec = std::vector<Complex>;
    using RealVec = std::vector<double>;

    struct FilterCoeffs
    {
        RealVec b;
        RealVec a;
    };

    namespace dsp
    {

        FilterCoeffs butter(int order, double cutoff, bool highPass);

        ComplexVec filtfilt(const FilterCoeffs &c, const ComplexVec &input);

        ComplexVec decimate(const ComplexVec &signal, int factor);
        ComplexVec lpfAndDownsample(int order, double cutoff, const ComplexVec &signal,
                                    double currentSr, double newSr);

        RealVec kaiserWindow(int n, double beta);
        double besselI0(double x);

        std::vector<int> findPeaks(const RealVec &data, double height, int distance);

        ComplexVec frequencyShift(const ComplexVec &signal, double sampleRate, double freqShift);

        struct Frames
        {
            ComplexVec data;
            int numFragments;
            int m;
        };
        Frames generateOverlappingFrames(double overlapFraction, const ComplexVec &frame, int m);

        void fftForward(ComplexVec &data);

        ComplexVec fftShifted(const ComplexVec &input, int totalSize);

        int nextPowerOf2(int n);

    }
}
