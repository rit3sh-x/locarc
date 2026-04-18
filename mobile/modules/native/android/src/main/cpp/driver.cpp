#include "driver.h"

#include <android/log.h>
#include <algorithm>
#include <cstring>

#define LOG_TAG "HackrfDriver"
#define LOGI(...) __android_log_print(ANDROID_LOG_INFO, LOG_TAG, __VA_ARGS__)
#define LOGW(...) __android_log_print(ANDROID_LOG_WARN, LOG_TAG, __VA_ARGS__)
#define LOGE(...) __android_log_print(ANDROID_LOG_ERROR, LOG_TAG, __VA_ARGS__)

namespace locarc
{

    namespace
    {
        constexpr uint8_t ENDPOINT_IN = 0x81;
        constexpr int CONTROL_TIMEOUT_MS = 1000;
        constexpr int BULK_CHUNK_BYTES = 256 * 1024;

        enum VendorRequest : uint8_t
        {
            SET_TRANSCEIVER_MODE = 1,
            SAMPLE_RATE_SET = 6,
            BASEBAND_FILTER_BW_SET = 7,
            SET_FREQ = 16,
            AMP_ENABLE = 17,
            SET_LNA_GAIN = 19,
            SET_VGA_GAIN = 20,
        };

        inline uint8_t CTRL_OUT()
        {
            return LIBUSB_ENDPOINT_OUT | LIBUSB_REQUEST_TYPE_VENDOR | LIBUSB_RECIPIENT_DEVICE;
        }
        inline uint8_t CTRL_IN()
        {
            return LIBUSB_ENDPOINT_IN | LIBUSB_REQUEST_TYPE_VENDOR | LIBUSB_RECIPIENT_DEVICE;
        }
    }

    HackrfDriver::HackrfDriver() = default;

    HackrfDriver::~HackrfDriver()
    {
        close();
    }

    int HackrfDriver::open(int fd)
    {
        if (dev_)
        {
            LOGW("open: already open, closing first");
            close();
        }

        libusb_set_option(nullptr, LIBUSB_OPTION_NO_DEVICE_DISCOVERY);

        int rc = libusb_init(&ctx_);
        if (rc != LIBUSB_SUCCESS)
        {
            LOGE("libusb_init failed: %d (%s)", rc, libusb_error_name(rc));
            return rc;
        }

        rc = libusb_wrap_sys_device(ctx_, (intptr_t)fd, &dev_);
        if (rc != LIBUSB_SUCCESS || !dev_)
        {
            LOGE("libusb_wrap_sys_device failed: %d (%s)", rc, libusb_error_name(rc));
            libusb_exit(ctx_);
            ctx_ = nullptr;
            dev_ = nullptr;
            return rc;
        }

        rc = libusb_claim_interface(dev_, interfaceNumber_);
        if (rc != LIBUSB_SUCCESS)
        {
            LOGE("claim_interface failed: %d (%s)", rc, libusb_error_name(rc));
            libusb_close(dev_);
            dev_ = nullptr;
            libusb_exit(ctx_);
            ctx_ = nullptr;
            return rc;
        }

        LOGI("HackRF opened via fd=%d", fd);
        return LIBUSB_SUCCESS;
    }

    void HackrfDriver::close()
    {
        if (dev_)
        {
            if (transceiverMode_ != TRANSCEIVER_MODE_OFF)
            {
                setTransceiverMode(TRANSCEIVER_MODE_OFF);
            }
            libusb_release_interface(dev_, interfaceNumber_);
            libusb_close(dev_);
            dev_ = nullptr;
        }
        if (ctx_)
        {
            libusb_exit(ctx_);
            ctx_ = nullptr;
        }
        transceiverMode_ = TRANSCEIVER_MODE_OFF;
    }

    int HackrfDriver::controlOut(uint8_t request, uint16_t value, uint16_t index,
                                 const uint8_t *data, int len)
    {
        if (!dev_)
            return LIBUSB_ERROR_NO_DEVICE;
        return libusb_control_transfer(dev_, CTRL_OUT(), request, value, index,
                                       const_cast<uint8_t *>(data), len, CONTROL_TIMEOUT_MS);
    }

    int HackrfDriver::controlIn(uint8_t request, uint16_t value, uint16_t index,
                                uint8_t *data, int len)
    {
        if (!dev_)
            return LIBUSB_ERROR_NO_DEVICE;
        return libusb_control_transfer(dev_, CTRL_IN(), request, value, index,
                                       data, len, CONTROL_TIMEOUT_MS);
    }

    int HackrfDriver::setSampleRate(uint32_t hz, uint32_t divider)
    {
        uint8_t buf[8];
        std::memcpy(buf, &hz, 4);
        std::memcpy(buf + 4, &divider, 4);
        int rc = controlOut(SAMPLE_RATE_SET, 0, 0, buf, 8);
        if (rc != 8)
            LOGE("setSampleRate: rc=%d", rc);
        return rc;
    }

    int HackrfDriver::setBasebandFilterBandwidth(uint32_t hz)
    {
        int rc = controlOut(BASEBAND_FILTER_BW_SET,
                            (uint16_t)(hz & 0xffff),
                            (uint16_t)((hz >> 16) & 0xffff),
                            nullptr, 0);
        if (rc != 0)
            LOGE("setBbFilter: rc=%d", rc);
        return rc;
    }

    int HackrfDriver::setFrequency(uint64_t hz)
    {
        uint32_t mhz = (uint32_t)(hz / 1'000'000ULL);
        uint32_t rem = (uint32_t)(hz % 1'000'000ULL);
        uint8_t buf[8];
        std::memcpy(buf, &mhz, 4);
        std::memcpy(buf + 4, &rem, 4);
        int rc = controlOut(SET_FREQ, 0, 0, buf, 8);
        if (rc != 8)
            LOGE("setFrequency: rc=%d", rc);
        return rc;
    }

    int HackrfDriver::setLnaGain(uint8_t db)
    {
        if (db > 40)
            db = 40;
        db -= db % 8;
        uint8_t ret = 0;
        int rc = controlIn(SET_LNA_GAIN, 0, db, &ret, 1);
        if (rc != 1)
        {
            LOGE("setLnaGain: rc=%d", rc);
            return rc;
        }
        return ret ? 1 : 0;
    }

    int HackrfDriver::setVgaGain(uint8_t db)
    {
        if (db > 62)
            db = 62;
        db -= db % 2;
        uint8_t ret = 0;
        int rc = controlIn(SET_VGA_GAIN, 0, db, &ret, 1);
        if (rc != 1)
        {
            LOGE("setVgaGain: rc=%d", rc);
            return rc;
        }
        return ret ? 1 : 0;
    }

    int HackrfDriver::setAmpEnable(bool enable)
    {
        int rc = controlOut(AMP_ENABLE, enable ? 1 : 0, 0, nullptr, 0);
        if (rc != 0)
            LOGE("setAmp: rc=%d", rc);
        return rc;
    }

    int HackrfDriver::setTransceiverMode(int mode)
    {
        int rc = controlOut(SET_TRANSCEIVER_MODE, (uint16_t)mode, 0, nullptr, 0);
        if (rc == 0)
            transceiverMode_ = mode;
        else
            LOGE("setTransceiverMode(%d): rc=%d", mode, rc);
        return rc;
    }

    void HackrfDriver::flushPipe()
    {
        if (!dev_) return;
        if (transceiverMode_ != TRANSCEIVER_MODE_OFF) {
            controlOut(SET_TRANSCEIVER_MODE, (uint16_t)TRANSCEIVER_MODE_OFF, 0, nullptr, 0);
            transceiverMode_ = TRANSCEIVER_MODE_OFF;
        }
        uint8_t scratch[4096];
        int got = 0;
        int drained = 0;
        for (int i = 0; i < 16; ++i) {
            int rc = libusb_bulk_transfer(dev_, ENDPOINT_IN, scratch, sizeof(scratch),
                                           &got, 50);
            if (rc != LIBUSB_SUCCESS || got <= 0) break;
            drained += got;
        }
        libusb_clear_halt(dev_, ENDPOINT_IN);
        if (drained > 0) {
            LOGI("flushPipe: drained %d stale bytes", drained);
        }
    }

    int HackrfDriver::readSamples(uint8_t *dst, int totalBytes, int timeoutMs)
    {
        if (!dev_)
            return LIBUSB_ERROR_NO_DEVICE;
        int filled = 0;
        while (filled < totalBytes)
        {
            int chunk = std::min(BULK_CHUNK_BYTES, totalBytes - filled);
            int got = 0;
            int rc = libusb_bulk_transfer(dev_, ENDPOINT_IN,
                                          dst + filled, chunk,
                                          &got, timeoutMs);
            if (rc != LIBUSB_SUCCESS)
            {
                LOGE("bulk_transfer failed at %d/%d: %d (%s)",
                     filled, totalBytes, rc, libusb_error_name(rc));
                return filled;
            }
            if (got <= 0)
            {
                LOGW("bulk_transfer returned 0 bytes at %d/%d", filled, totalBytes);
                return filled;
            }
            filled += got;
        }
        return filled;
    }

}
