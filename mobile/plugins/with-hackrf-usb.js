const { withAndroidManifest } = require('@expo/config-plugins')

const USB_ATTACHED_ACTION = 'android.hardware.usb.action.USB_DEVICE_ATTACHED'
const DEVICE_FILTER_RESOURCE = '@xml/usb_device_filter'

function findMainActivity(androidManifest) {
    const application = androidManifest?.manifest?.application?.[0]
    if (!application?.activity) return null
    return (
        application.activity.find(
            (a) => a?.$?.['android:name'] === '.MainActivity',
        ) ?? null
    )
}

function ensureUsbAttachedIntentFilter(activity) {
    if (!Array.isArray(activity['intent-filter'])) {
        activity['intent-filter'] = []
    }

    const alreadyPresent = activity['intent-filter'].some((filter) =>
        filter?.action?.some(
            (action) => action?.$?.['android:name'] === USB_ATTACHED_ACTION,
        ),
    )

    if (!alreadyPresent) {
        activity['intent-filter'].push({
            action: [{ $: { 'android:name': USB_ATTACHED_ACTION } }],
        })
    }
}

function ensureUsbDeviceFilterMetadata(activity) {
    if (!Array.isArray(activity['meta-data'])) {
        activity['meta-data'] = []
    }

    const alreadyPresent = activity['meta-data'].some(
        (meta) => meta?.$?.['android:name'] === USB_ATTACHED_ACTION,
    )

    if (!alreadyPresent) {
        activity['meta-data'].push({
            $: {
                'android:name': USB_ATTACHED_ACTION,
                'android:resource': DEVICE_FILTER_RESOURCE,
            },
        })
    }
}

const withHackrfUsb = (config) => {
    return withAndroidManifest(config, (config) => {
        const mainActivity = findMainActivity(config.modResults)
        if (!mainActivity) {
            console.warn(
                '[with-hackrf-usb] MainActivity not found in AndroidManifest — skipping USB intent filter injection.',
            )
            return config
        }

        ensureUsbAttachedIntentFilter(mainActivity)
        ensureUsbDeviceFilterMetadata(mainActivity)

        return config
    })
}

module.exports = withHackrfUsb
