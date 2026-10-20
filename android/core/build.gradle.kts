// Plain Kotlin/JVM, no Android imports: the measuring, timing, outbox, sync and HackRF logic,
// all tested on the JVM.
plugins {
    alias(libs.plugins.kotlin.jvm)
}

kotlin { jvmToolchain(17) }

dependencies {
    api(libs.coroutines.core)
    api(libs.serialization.json)
    testImplementation(kotlin("test"))
    testImplementation(libs.coroutines.test)
    testImplementation(libs.junit)
    testRuntimeOnly(libs.junit.launcher)
}

// The wire golden files are the backend's: these tests read the same bytes the TypeScript ones do.
sourceSets.test {
    resources.srcDir(rootProject.layout.projectDirectory.dir("../convex/lib/wire"))
}

tasks.test {
    useJUnitPlatform()
    maxHeapSize = "2g"
    testLogging {
        events("failed")
        exceptionFormat = org.gradle.api.tasks.testing.logging.TestExceptionFormat.FULL
        showStandardStreams = true
    }
}
