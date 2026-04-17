const { withAndroidManifest } = require('@expo/config-plugins')

const USB_ATTACHED_ACTION = 'android.hardware.usb.action.USB_DEVICE_ATTACHED'
const USB_HOST_FEATURE = 'android.hardware.usb.host'
const DEVICE_FILTER_RESOURCE = '@xml/usb_device_filter'
const MAIN_ACTIVITY_NAME = '.MainActivity'

function ensureLargeHeap(androidManifest) {
    const application = androidManifest?.manifest?.application?.[0]
    if (!application?.$) return
    application.$['android:largeHeap'] = 'true'
}

function ensureUsbHostFeature(androidManifest) {
    const manifest = androidManifest?.manifest
    if (!manifest) return
    if (!Array.isArray(manifest['uses-feature'])) {
        manifest['uses-feature'] = []
    }
    const alreadyPresent = manifest['uses-feature'].some(
        (feature) => feature?.$?.['android:name'] === USB_HOST_FEATURE,
    )
    if (!alreadyPresent) {
        manifest['uses-feature'].push({
            $: {
                'android:name': USB_HOST_FEATURE,
                'android:required': 'false',
            },
        })
    }
}

function findMainActivity(androidManifest) {
    const application = androidManifest?.manifest?.application?.[0]
    if (!application?.activity) return null
    return (
        application.activity.find(
            (a) => a?.$?.['android:name'] === MAIN_ACTIVITY_NAME,
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
        const manifest = config.modResults

        ensureLargeHeap(manifest)
        ensureUsbHostFeature(manifest)

        const mainActivity = findMainActivity(manifest)
        if (!mainActivity) {
            console.warn(
                '[with-hackrf-usb] MainActivity not found in AndroidManifest — ' +
                    'USB intent filter not injected. Did expo-router create a different activity?',
            )
            return config
        }

        ensureUsbAttachedIntentFilter(mainActivity)
        ensureUsbDeviceFilterMetadata(mainActivity)

        return config
    })
}

module.exports = withHackrfUsb
