#pragma once

#include <cstdint>
#include <libusb.h>

namespace locarc
{

    class HackrfDriver
    {
    public:
        static constexpr int TRANSCEIVER_MODE_OFF = 0;
        static constexpr int TRANSCEIVER_MODE_RECEIVE = 1;

        HackrfDriver();
        ~HackrfDriver();
        HackrfDriver(const HackrfDriver &) = delete;
        HackrfDriver &operator=(const HackrfDriver &) = delete;

        int open(int fd);
        void close();

        bool isOpen() const { return dev_ != nullptr; }

        int setSampleRate(uint32_t hz, uint32_t divider);
        int setBasebandFilterBandwidth(uint32_t hz);
        int setFrequency(uint64_t hz);
        int setLnaGain(uint8_t db);
        int setVgaGain(uint8_t db);
        int setAmpEnable(bool enable);
        int setTransceiverMode(int mode);

        int readSamples(uint8_t *dst, int totalBytes, int timeoutMs);

        void flushPipe();

    private:
        int controlOut(uint8_t request, uint16_t value, uint16_t index,
                       const uint8_t *data, int len);
        int controlIn(uint8_t request, uint16_t value, uint16_t index,
                      uint8_t *data, int len);

        libusb_context *ctx_ = nullptr;
        libusb_device_handle *dev_ = nullptr;
        int interfaceNumber_ = 0;
        int transceiverMode_ = TRANSCEIVER_MODE_OFF;
    };

}