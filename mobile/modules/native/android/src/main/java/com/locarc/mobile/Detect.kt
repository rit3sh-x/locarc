package com.locarc.mobile

import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.hardware.usb.UsbDevice
import android.hardware.usb.UsbManager
import android.os.Build
import android.util.Log
import androidx.core.content.ContextCompat

object Detect {
    private const val TAG = "hackrf_android"
    private const val USB_PERMISSION = "com.locarc.mobile.USB_PERMISSION"

    const val VENDOR_ID = 7504
    const val PRODUCT_ID_HACKRF_ONE = 24713
    const val PRODUCT_ID_RAD1O = 52245
    const val PRODUCT_ID_JAWBREAKER = 24651

    private val KNOWN_PRODUCT_IDS = setOf(
        PRODUCT_ID_HACKRF_ONE,
        PRODUCT_ID_RAD1O,
        PRODUCT_ID_JAWBREAKER
    )

    fun isConnected(context: Context): Boolean {
        val manager = context.getSystemService(Context.USB_SERVICE) as? UsbManager
            ?: return false.also { Log.e(TAG, "UsbManager unavailable") }

        val found = manager.deviceList.values.any { device ->
            device.vendorId == VENDOR_ID && device.productId in KNOWN_PRODUCT_IDS
        }

        Log.d(TAG, "isConnected = $found (${manager.deviceList.size} USB devices enumerated)")
        return found
    }

    fun getDeviceName(context: Context): String? {
        val manager = context.getSystemService(Context.USB_SERVICE) as? UsbManager ?: return null

        return manager.deviceList.values
            .firstOrNull { it.vendorId == VENDOR_ID && it.productId in KNOWN_PRODUCT_IDS }
            ?.let { device ->
                when (device.productId) {
                    PRODUCT_ID_HACKRF_ONE -> "HackRF One"
                    PRODUCT_ID_RAD1O -> "rad1o"
                    PRODUCT_ID_JAWBREAKER -> "HackRF Jawbreaker"
                    else -> "Unknown HackRF"
                }.also { Log.d(TAG, "Detected: $it at ${device.deviceName}") }
            }
    }

    fun initHackrf(
        context: Context,
        queueSize: Int,
        onResult: (Result<Hackrf>) -> Unit
    ): Boolean {
        val usbManager = context.getSystemService(Context.USB_SERVICE) as? UsbManager
        if (usbManager == null) {
            Log.e(TAG, "initHackrf: Couldn't get UsbManager")
            return false
        }

        val deviceList = usbManager.deviceList
        Log.i(TAG, "initHackrf: Found ${deviceList.size} USB devices.")

        val hackrfUsbDevice = deviceList.values.firstOrNull { device ->
            device.vendorId == VENDOR_ID && device.productId in KNOWN_PRODUCT_IDS
        }

        if (hackrfUsbDevice == null) {
            Log.e(TAG, "initHackrf: No HackRF device found.")
            return false
        }

        if (usbManager.hasPermission(hackrfUsbDevice)) {
            Log.d(TAG, "initHackrf: Permission already granted for ${hackrfUsbDevice.deviceName}")
            openDevice(usbManager, hackrfUsbDevice, queueSize, onResult)
            return true
        }

        val permissionReceiver = object : BroadcastReceiver() {
            override fun onReceive(ctx: Context, intent: Intent) {
                ctx.unregisterReceiver(this)
                if (USB_PERMISSION != intent.action) return

                val device: UsbDevice? = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                    intent.getParcelableExtra(UsbManager.EXTRA_DEVICE, UsbDevice::class.java)
                } else {
                    @Suppress("DEPRECATION")
                    intent.getParcelableExtra(UsbManager.EXTRA_DEVICE)
                }

                if (intent.getBooleanExtra(UsbManager.EXTRA_PERMISSION_GRANTED, false) && device != null) {
                    Log.d(TAG, "initHackrf: Permission granted for ${device.deviceName}")
                    openDevice(usbManager, device, queueSize, onResult)
                } else if (device != null) {
                    Log.e(TAG, "initHackrf: Permission denied for ${device.deviceName}")
                    onResult(Result.failure(UsbException("Permission denied for ${device.deviceName}")))
                } else {
                    Log.e(TAG, "initHackrf: Error with USB Permission Intent.")
                    onResult(Result.failure(UsbException("Error with USB Permission Intent")))
                }
            }
        }

        val permissionIntent = PendingIntent.getBroadcast(
            context, 0,
            Intent(USB_PERMISSION).also { it.setPackage(context.packageName) },
            PendingIntent.FLAG_MUTABLE
        )

        ContextCompat.registerReceiver(
            context, permissionReceiver,
            IntentFilter(USB_PERMISSION),
            ContextCompat.RECEIVER_NOT_EXPORTED
        )

        usbManager.requestPermission(hackrfUsbDevice, permissionIntent)
        Log.d(TAG, "Permission request for ${hackrfUsbDevice.deviceName} was sent.")
        return true
    }

    private fun openDevice(
        usbManager: UsbManager,
        device: UsbDevice,
        queueSize: Int,
        onResult: (Result<Hackrf>) -> Unit
    ) {
        try {
            val hackrf = Hackrf(usbManager, device, queueSize)
            onResult(Result.success(hackrf))
        } catch (e: UsbException) {
            Log.e(TAG, "initHackrf: Couldn't open ${device.deviceName}", e)
            onResult(Result.failure(e))
        }
    }
}
