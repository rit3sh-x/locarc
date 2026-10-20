// The Android shell: foreground service, USB driver, location, Keystore secret, updater, screens.
// Build contract with .github/workflows/android.yml: -PversionCode, -PversionName,
// -PdeploymentUrl, release signing from LOCARC_KEYSTORE_FILE / _PASSWORD and
// LOCARC_KEY_ALIAS / _PASSWORD, one arm64 APK.
plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.compose)
}

val keystore: String? = System.getenv("LOCARC_KEYSTORE_FILE")

android {
    namespace = "dev.locarc.app"
    compileSdk = 37
    defaultConfig {
        applicationId = "dev.locarc.receiver"
        minSdk = 29
        targetSdk = 36
        versionCode = (findProperty("versionCode") as String?)?.toInt() ?: 1
        versionName = (findProperty("versionName") as String?) ?: "dev"
        // Typed pairing codes use this deployment; a QR carries its own.
        buildConfigField("String", "DEPLOYMENT_URL", "\"${findProperty("deploymentUrl") ?: ""}\"")
        ndk { abiFilters += "arm64-v8a" }
    }
    signingConfigs {
        if (keystore != null) {
            create("release") {
                storeFile = file(keystore)
                storePassword = System.getenv("LOCARC_KEYSTORE_PASSWORD")
                keyAlias = System.getenv("LOCARC_KEY_ALIAS")
                keyPassword = System.getenv("LOCARC_KEY_PASSWORD")
            }
        }
    }
    buildTypes {
        release {
            isMinifyEnabled = false
            signingConfig = signingConfigs.findByName("release")
        }
        // DSP timing as release code runs it: ART slows debuggable apps down.
        debug { isDebuggable = false }
    }
    buildFeatures {
        compose = true
        buildConfig = true
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}

dependencies {
    implementation(project(":core"))
    implementation(libs.coroutines.android)
    implementation(platform(libs.compose.bom))
    implementation(libs.compose.ui)
    implementation(libs.compose.material3)
    implementation(libs.activity.compose)
    implementation(libs.lifecycle.runtime.compose)
    implementation(libs.core.ktx)
    implementation(libs.play.location)
    implementation(libs.play.code.scanner)
    implementation(libs.maplibre)
    implementation(libs.convex)
    // Convex 0.8.0 pulls JNA 5.14, whose native library crashes 16 KB-page phones at launch.
    implementation(libs.jna) { artifact { type = "aar" } }
}
