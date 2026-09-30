fn main() {
    println!("cargo:rerun-if-env-changed=MANGAVAULT_BUNDLED_TOOLS_DIR");
    println!("cargo:rerun-if-changed=vendor/windows/tools");
    tauri_build::build();
}
