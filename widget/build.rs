fn main() {
    // The manifest declares Windows 8+ support (required for layered child windows)
    // and per-monitor DPI awareness; the icon is the exe's.
    println!("cargo:rerun-if-changed=app.rc");
    println!("cargo:rerun-if-changed=app.manifest");
    embed_resource::compile("app.rc", embed_resource::NONE)
        .manifest_required()
        .unwrap();
}
