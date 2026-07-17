fn main() {
    // Apple Speech framework (SFSpeechRecognizer / SFSpeechURLRecognitionRequest)
    // symbols live in Speech.framework. Required by voice/apple_speech.rs FFI.
    // ponytail: unconditional on macOS — matches openless pattern; Windows builds skip this block.
    #[cfg(target_os = "macos")]
    println!("cargo:rustc-link-lib=framework=Speech");

    tauri_build::build()
}
