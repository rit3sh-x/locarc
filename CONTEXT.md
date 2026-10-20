# LocArc

LocArc localizes RF transmitters using a fleet of phone-hosted SDR receivers. Each Receiver measures signal power, and the backend combines these measurements to estimate transmitter positions.

## Glossary

- **Organization** : The team that owns a deployment. Each deployment has exactly one Organization, which owns all Operators, Receivers, configuration, and data.

- **Operator** : A person who uses the website to manage Receivers, run Scans, and view Fixes. Access is invite-only. Every Operator has the same permissions.

- **Receiver** : An Android phone connected to a HackRF One over USB OTG, running the LocArc app. Each Receiver has its own GPS position, RF configuration, and health state. *Avoid: controller, node, device.*

- **Setup gap** : A phone setting required for unattended operation that has not yet been granted or configured. Examples include background location, unrestricted battery usage, opening the app when HackRF is connected, notifications, and autostart. The website displays these as **Setup incomplete**. A setup gap does not stop the Receiver from scanning.

- **Health state** : A Receiver's current condition, derived from its heartbeats. One of: Awaiting pairing, Offline, Needs attention, Paused, Degraded, Scanning, or Idle (the Organization has stopped scanning). Always display the state alongside its primary reason.

- **Sweep plan** : The Organization-wide configuration defining the frequency segments to scan and the Channel raster to use. Every Receiver follows the same plan, repeatedly sweeping its configured segments during each Listening window. The default is a bug-hunting preset, but the plan can cover any frequency range from 1 MHz to 6 GHz.

- **Channel** : A slot on the Sweep plan's frequency raster, with a width of either 12.5 or 25 kHz. Each Channel is identified by its centre frequency. Its channel number is the centre frequency divided by the raster width, measured from 0 Hz. For example, 433.925 MHz on a 12.5 kHz raster is Channel 34714. Channel numbers remain stable when the Sweep plan's frequency segments change. Emitters are measured in Channels and named by one of them. *Avoid: frequency bin.*

- **Run** : A continuous period of scanning under a single Sweep plan and scan cadence. Starting scanning opens a Run; stopping scanning or changing the plan or cadence ends it.

- **Scan** : One clock-aligned time slot within a Run. During its Listening window, every Receiver repeatedly sweeps the Sweep plan. The backend combines the resulting Readings to localize Emitters. *Avoid: job, batch, jobBatch.*

- **Listening window** : The portion of each Scan, starting at its boundary, during which Receivers repeatedly sweep the Sweep plan. A longer window can capture more short transmissions but increases phone heat; a shorter window reduces the listening time.

- **Emitter** : One transmitter as observed by the Receivers during a single Scan. It is represented by a contiguous run of neighbouring Channels that are active together. A narrowband transmitter may occupy one or two Channels, while Wi-Fi can occupy hundreds. Each Emitter has one identifying Channel within its span, chosen in this order: the matching Watchlist entry's frequency, its previous identifying frequency, or its strongest Channel. This keeps a wideband Emitter's identity stable across Scans. *Avoid: cluster, peak, signal.*

- **Reading** : The measurements one Receiver records for each Emitter detected during a Scan's Listening window. A Reading includes the Emitter's Channel span, strongest Channel, average power, peak power, and Occupancy. *Avoid: measurement, sdrMeasurement.*

- **Occupancy** : The proportion of sweeps within a Listening window in which an Emitter was detected as active. A continuous broadcaster has occupancy near 100%; a bursty or voice-activated transmitter has lower occupancy.

- **Fix** : An estimated position for one Emitter in one Scan, including its centre and uncertainty bounds. The backend attempts localization for every Emitter heard by at least three Receivers in that Scan. A Fix is retained only when it is new or has changed, or as an hourly refresh. *Avoid: location, which refers specifically to a Receiver's GPS position.*

- **Watchlist entry** : A record for a known Emitter, identified by a frequency and containing a name, notes, and custom alert rules for Heard, Moved, and Silent conditions. It matches any Emitter whose Channel span includes that frequency. Known Emitters do not trigger New alerts.

- **Alert** : An issue or event an Operator should review, associated with a Receiver or Emitter. Alerts are classified as critical or warning. Condition alerts, such as Receiver health issues and Silent conditions, resolve automatically when the condition clears. Event alerts, such as New, Heard, and Moved, remain open until acknowledged. *Avoid: notification, which refers to the delivery mechanism rather than the Alert itself.*