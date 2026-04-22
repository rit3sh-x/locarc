#include <jni.h>
#include <android/log.h>
#include <atomic>
#include "driver.h"
#include "spectrum.h"
#include "algo_config.h"
#include "scan.h"

#define LOG_TAG "HackrfJni"
#define LOGI(...) __android_log_print(ANDROID_LOG_INFO, LOG_TAG, __VA_ARGS__)
#define LOGE(...) __android_log_print(ANDROID_LOG_ERROR, LOG_TAG, __VA_ARGS__)

using locarc::HackrfDriver;

static inline HackrfDriver *drv(jlong handle)
{
    return reinterpret_cast<HackrfDriver *>(handle);
}

static std::atomic<bool> g_scanCancel{false};
static std::atomic<bool> g_deviceWasReset{false};

extern "C"
{

    JNIEXPORT jlong JNICALL
    Java_com_locarc_mobile_HackrfNative_nativeOpen(JNIEnv *env, jclass, jint fd)
    {
        auto *d = new HackrfDriver();
        int rc = d->open(fd);
        if (rc != 0)
        {
            delete d;
            return 0;
        }
        return reinterpret_cast<jlong>(d);
    }

    JNIEXPORT void JNICALL
    Java_com_locarc_mobile_HackrfNative_nativeClose(JNIEnv *, jclass, jlong h)
    {
        auto *d = drv(h);
        if (!d)
            return;
        d->close();
        delete d;
    }

    JNIEXPORT jint JNICALL
    Java_com_locarc_mobile_HackrfNative_nativeSetSampleRate(JNIEnv *, jclass, jlong h, jint hz)
    {
        auto *d = drv(h);
        if (!d)
            return -1;
        return d->setSampleRate((uint32_t)hz, 1);
    }

    JNIEXPORT jint JNICALL
    Java_com_locarc_mobile_HackrfNative_nativeSetBasebandFilter(JNIEnv *, jclass, jlong h, jint hz)
    {
        auto *d = drv(h);
        if (!d)
            return -1;
        return d->setBasebandFilterBandwidth((uint32_t)hz);
    }

    JNIEXPORT jint JNICALL
    Java_com_locarc_mobile_HackrfNative_nativeSetFrequency(JNIEnv *, jclass, jlong h, jlong hz)
    {
        auto *d = drv(h);
        if (!d)
            return -1;
        return d->setFrequency((uint64_t)hz);
    }

    JNIEXPORT jint JNICALL
    Java_com_locarc_mobile_HackrfNative_nativeSetLnaGain(JNIEnv *, jclass, jlong h, jint db)
    {
        auto *d = drv(h);
        if (!d)
            return -1;
        return d->setLnaGain((uint8_t)db);
    }

    JNIEXPORT jint JNICALL
    Java_com_locarc_mobile_HackrfNative_nativeSetVgaGain(JNIEnv *, jclass, jlong h, jint db)
    {
        auto *d = drv(h);
        if (!d)
            return -1;
        return d->setVgaGain((uint8_t)db);
    }

    JNIEXPORT jint JNICALL
    Java_com_locarc_mobile_HackrfNative_nativeSetAmpEnable(JNIEnv *, jclass, jlong h, jboolean enable)
    {
        auto *d = drv(h);
        if (!d)
            return -1;
        return d->setAmpEnable(enable == JNI_TRUE);
    }

    JNIEXPORT jint JNICALL
    Java_com_locarc_mobile_HackrfNative_nativeStartRx(JNIEnv *, jclass, jlong h)
    {
        auto *d = drv(h);
        if (!d)
            return -1;
        return d->setTransceiverMode(HackrfDriver::TRANSCEIVER_MODE_RECEIVE);
    }

    JNIEXPORT jint JNICALL
    Java_com_locarc_mobile_HackrfNative_nativeStopRx(JNIEnv *, jclass, jlong h)
    {
        auto *d = drv(h);
        if (!d)
            return -1;
        return d->setTransceiverMode(HackrfDriver::TRANSCEIVER_MODE_OFF);
    }

    JNIEXPORT jint JNICALL
    Java_com_locarc_mobile_HackrfNative_nativeReadSamples(
        JNIEnv *env, jclass, jlong h, jbyteArray dst, jint off, jint len, jint timeoutMs)
    {
        auto *d = drv(h);
        if (!d)
            return -1;

        jbyte *buf = env->GetByteArrayElements(dst, nullptr);
        if (!buf)
            return -1;

        int filled = d->readSamples(
            reinterpret_cast<uint8_t *>(buf) + off, len, timeoutMs);

        env->ReleaseByteArrayElements(dst, buf, 0);
        return filled;
    }

    JNIEXPORT jdoubleArray JNICALL
    Java_com_locarc_mobile_HackrfNative_nativeRunFullScan(
        JNIEnv *env, jclass, jlong h,
        jlong minFreqHz, jlong maxFreqHz,
        jint sampleRateHz, jint lnaGainDb, jint vgaGainDb,
        jint perStepBytes,
        jdoubleArray algoDoubles, jintArray algoInts)
    {
        auto *d = drv(h);
        if (!d)
            return env->NewDoubleArray(0);

        jdouble *dArr = env->GetDoubleArrayElements(algoDoubles, nullptr);
        jint *iArr = env->GetIntArrayElements(algoInts, nullptr);
        if (!dArr || !iArr)
        {
            if (dArr)
                env->ReleaseDoubleArrayElements(algoDoubles, dArr, JNI_ABORT);
            if (iArr)
                env->ReleaseIntArrayElements(algoInts, iArr, JNI_ABORT);
            return env->NewDoubleArray(0);
        }

        auto cfg = locarc::AlgoConfig::fromArrays(
            reinterpret_cast<const double *>(dArr),
            reinterpret_cast<const int *>(iArr));
        env->ReleaseDoubleArrayElements(algoDoubles, dArr, JNI_ABORT);
        env->ReleaseIntArrayElements(algoInts, iArr, JNI_ABORT);

        locarc::ScanParams sp{
            (int64_t)minFreqHz, (int64_t)maxFreqHz,
            (int)sampleRateHz, (int)lnaGainDb, (int)vgaGainDb,
            (int)perStepBytes};

        g_scanCancel.store(false);
        auto results = locarc::runFullScan(*d, sp, cfg, g_scanCancel);
        if (!d->isOpen())
        {
            LOGE("nativeRunFullScan: device closed (reset fired) — flagging wrapper for recycle");
            g_deviceWasReset.store(true);
        }

        const jsize n = (jsize)results.size() * 2;
        jdoubleArray out = env->NewDoubleArray(n);
        if (n > 0)
        {
            std::vector<double> flat(n);
            for (size_t i = 0; i < results.size(); ++i)
            {
                flat[2 * i] = results[i].frequencyHz;
                flat[2 * i + 1] = results[i].powerDbm;
            }
            env->SetDoubleArrayRegion(out, 0, n, flat.data());
        }
        return out;
    }

    JNIEXPORT void JNICALL
    Java_com_locarc_mobile_HackrfNative_nativeCancelScan(JNIEnv *, jclass)
    {
        g_scanCancel.store(true);
    }

    JNIEXPORT jint JNICALL
    Java_com_locarc_mobile_HackrfNative_nativeReset(JNIEnv *, jclass, jlong h)
    {
        auto *d = drv(h);
        if (!d)
            return -1;
        int rc = d->reset();
        g_deviceWasReset.store(true);
        return rc;
    }

    JNIEXPORT jboolean JNICALL
    Java_com_locarc_mobile_HackrfNative_nativeConsumeResetFlag(JNIEnv *, jclass)
    {
        return g_deviceWasReset.exchange(false) ? JNI_TRUE : JNI_FALSE;
    }
}