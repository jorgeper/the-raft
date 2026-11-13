fn main() {
    // The bundled .app carries libsherpa-onnx-c-api / libonnxruntime in
    // Contents/Frameworks (see scripts/collect-dylibs.sh); this rpath lets
    // dyld find them there. Harmless for dev builds.
    #[cfg(target_os = "macos")]
    println!("cargo:rustc-link-arg=-Wl,-rpath,@executable_path/../Frameworks");

    tauri_build::build()
}
