fn main() {
    // tauri-build only watches tauri.conf.json, which reads the app version from package.json.
    println!("cargo:rerun-if-changed=../package.json");
    tauri_build::build();
}
