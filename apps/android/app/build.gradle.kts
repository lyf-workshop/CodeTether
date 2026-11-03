import org.jetbrains.kotlin.gradle.dsl.JvmTarget

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.kotlin.plugin.compose")
}

// cargo-ndk prints its environment on failure. Keep build settings and tokens out.
val nativeEnvironmentNames = setOf(
    "PATH", "SYSTEMROOT", "SYSTEMDRIVE", "WINDIR", "COMSPEC", "PATHEXT",
    "TEMP", "TMP", "USERPROFILE", "HOME", "LOCALAPPDATA", "APPDATA",
    "CARGO_HOME", "RUSTUP_HOME", "INCLUDE", "LIB", "LIBPATH",
    "VCINSTALLDIR", "VCTOOLSINSTALLDIR", "WINDOWSSDKDIR", "WINDOWSSDKVERSION",
)
val nativeEnvironment = System.getenv().filterKeys { it.uppercase() in nativeEnvironmentNames }

val nativeNdkVersion = "27.2.12479018"
val nativeMinApi = 31
val rustProject = rootProject.layout.projectDirectory.dir("../../packages/supervisor-mobile")
val nativeSources = fileTree(rustProject) {
    include("Cargo.toml", "Cargo.lock", "uniffi.toml", "src/**")
}
val hostCargoTarget = layout.buildDirectory.dir("rust-host")
val androidCargoTarget = layout.buildDirectory.dir("rust-android")
val uniffiConfig = rootProject.layout.projectDirectory.file("uniffi-android.toml")
val generatedKotlin = layout.buildDirectory.dir("generated/uniffi")
val generatedJni = layout.buildDirectory.dir("generated/jniLibs")
val hostLibraryName = when {
    System.getProperty("os.name").startsWith("Windows") -> "supervisor_mobile.dll"
    System.getProperty("os.name").startsWith("Mac") -> "libsupervisor_mobile.dylib"
    else -> "libsupervisor_mobile.so"
}
val hostLibrary = hostCargoTarget.map { it.file("debug/$hostLibraryName") }
val hostBindgenName = if (hostLibraryName.endsWith(".dll")) "uniffi-bindgen.exe" else "uniffi-bindgen"
val hostBindgen = hostCargoTarget.map { it.file("debug/$hostBindgenName") }
val hostBuild by tasks.registering(Exec::class) {
    workingDir(rustProject)
    setEnvironment(nativeEnvironment)
    environment("CARGO_TARGET_DIR", hostCargoTarget.get().asFile.absolutePath)
    commandLine("cargo", "build", "--locked", "--features", "bindgen", "--lib", "--bin", "uniffi-bindgen")
    inputs.files(nativeSources)
    outputs.files(hostLibrary, hostBindgen)
}
val generateSupervisorBindings by tasks.registering(Exec::class) {
    dependsOn(hostBuild)
    workingDir(rustProject)
    setEnvironment(nativeEnvironment)
    commandLine(
        hostBindgen.get().asFile.absolutePath, "generate", "--library", hostLibrary.get().asFile.absolutePath,
        "--language", "kotlin", "--no-format", "--config", uniffiConfig.asFile.absolutePath,
        "--out-dir", generatedKotlin.get().asFile.absolutePath,
    )
    inputs.files(hostLibrary, hostBindgen, uniffiConfig)
    outputs.dir(generatedKotlin)
}
val sdkDirectory = androidComponents.sdkComponents.sdkDirectory
val buildSupervisorNative by tasks.registering(Exec::class) {
    workingDir(rustProject)
    setEnvironment(nativeEnvironment)
    environment("CARGO_TARGET_DIR", androidCargoTarget.get().asFile.absolutePath)
    doFirst {
        environment("ANDROID_NDK_HOME", sdkDirectory.get().dir("ndk/$nativeNdkVersion").asFile.absolutePath)
    }
    commandLine(
        "cargo", "ndk", "-t", "arm64-v8a", "-t", "x86_64", "--platform", nativeMinApi.toString(),
        "-o", generatedJni.get().asFile.absolutePath, "build", "--lib", "--release", "--locked",
    )
    inputs.files(nativeSources)
    inputs.property("ndkVersion", nativeNdkVersion)
    outputs.dir(generatedJni)
}
tasks.named("preBuild") {
    dependsOn(generateSupervisorBindings, buildSupervisorNative)
}

fun quotedBuildConfig(value: String): String {
    require(value.none { it.isISOControl() }) { "Build configuration contains an invalid character." }
    return "\"" + value.replace("\\", "\\\\").replace("\"", "\\\"") + "\""
}

android {
    namespace = "org.codetether.app"
    compileSdk = 36
    ndkVersion = nativeNdkVersion

    defaultConfig {
        applicationId = "org.codetether.app"
        minSdk = nativeMinApi
        targetSdk = 36
        versionCode = 1
        versionName = "0.1.0-alpha.0"
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
        ndk {
            abiFilters += setOf("arm64-v8a", "x86_64")
        }
        val buildEnvironment = mapOf(
            "CONTROL_PLANE_URL" to "VITE_CODETETHER_CONTROL_PLANE_URL",
            "SUPABASE_URL" to "VITE_SUPABASE_URL",
            "SUPABASE_PUBLISHABLE_KEY" to "VITE_SUPABASE_PUBLISHABLE_KEY",
            "RELAY_ENDPOINT" to "CODETETHER_SUPERVISOR_RELAY_ENDPOINT",
            "RELAY_ID" to "CODETETHER_SUPERVISOR_RELAY_ID",
            "RELAY_FINGERPRINT" to "CODETETHER_SUPERVISOR_RELAY_FINGERPRINT",
        )
        buildEnvironment.forEach { (field, variable) ->
            buildConfigField("String", field, quotedBuildConfig(providers.environmentVariable(variable).orElse("").get()))
        }
    }

    buildFeatures {
        compose = true
        buildConfig = true
    }
    sourceSets["main"].apply {
        java.srcDir(generatedKotlin)
        jniLibs.srcDir(generatedJni)
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}
kotlin.compilerOptions.jvmTarget.set(JvmTarget.JVM_17)

dependencies {
    implementation(platform("androidx.compose:compose-bom:2025.10.01"))
    implementation("androidx.activity:activity-compose:1.11.0")
    implementation("androidx.lifecycle:lifecycle-runtime-compose:2.9.4")
    implementation("androidx.lifecycle:lifecycle-viewmodel-compose:2.9.4")
    implementation("androidx.compose.foundation:foundation")
    implementation("androidx.compose.material3:material3")
    implementation("androidx.compose.material:material-icons-core")
    implementation("androidx.compose.ui:ui")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.10.2")
    implementation("net.java.dev.jna:jna:5.17.0@aar")
    implementation("com.squareup.okhttp3:okhttp:4.12.0")

    testImplementation("junit:junit:4.13.2")
    androidTestImplementation(platform("androidx.compose:compose-bom:2025.10.01"))
    androidTestImplementation("androidx.compose.ui:ui-test-junit4")
    androidTestImplementation("androidx.test.ext:junit:1.3.0")
    androidTestImplementation("androidx.test:runner:1.7.0")
    debugImplementation("androidx.compose.ui:ui-test-manifest")
}
