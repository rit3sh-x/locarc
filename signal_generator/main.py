import numpy as np
import adi
import signal
import sys
import time


def generate_tone(fs: int, freq: float, duration: float, amplitude: float = 2**14):
    t = np.arange(0, duration, 1 / fs)
    iq = amplitude * np.exp(2j * np.pi * freq * t)
    return iq.astype(np.complex64)


def main():
    fs = 2_000_000
    fc = 920_000_000
    tone_freq = 500_000
    gain = 0

    sdr = adi.Pluto("ip:192.168.2.1")

    sdr.sample_rate = fs
    sdr.tx_rf_bandwidth = fs
    sdr.tx_lo = fc
    sdr.tx_hardwaregain_chan0 = gain
    sdr.tx_cyclic_buffer = True

    iq = generate_tone(fs, tone_freq, duration=1.0)

    sdr.tx(iq)
    print(f"Transmitting at {(fc + tone_freq) / 1e6:.3f} MHz. Ctrl+C to stop.")

    def handle_exit(sig=None, frame=None):
        print("\nStopping transmission...")
        sdr.tx_destroy_buffer()
        sys.exit(0)

    signal.signal(signal.SIGINT, handle_exit)

    try:
        while True:
            time.sleep(1)
    except KeyboardInterrupt:
        handle_exit()


if __name__ == "__main__":
    main()