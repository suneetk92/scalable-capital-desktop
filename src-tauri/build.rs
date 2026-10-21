use std::{env, fs, path::Path};

fn main() {
    println!("cargo:rerun-if-env-changed=APP_EXTENSION_DIR");
    if env::var_os("CARGO_FEATURE_EXTENSION").is_some() {
        extension();
    }
    tauri_build::build()
}

/// With the `extension` feature, `lib.rs` includes a generated `mod extension;` that points at
/// `src-tauri/mod.rs` in the folder named by APP_EXTENSION_DIR (relative to the repository root).
fn extension() {
    let dir = env::var("APP_EXTENSION_DIR")
        .expect("the extension feature needs APP_EXTENSION_DIR, the folder of the extension");
    let manifest = env::var("CARGO_MANIFEST_DIR").unwrap();
    let module = Path::new(&manifest)
        .join("..")
        .join(dir)
        .join("src-tauri/mod.rs");
    let module = module
        .canonicalize()
        .unwrap_or_else(|error| panic!("no extension module at {}: {error}", module.display()));
    let out = Path::new(&env::var("OUT_DIR").unwrap()).join("extension.rs");
    let source = format!("#[path = {:?}]\nmod extension;\n", module.to_string_lossy());
    fs::write(out, source).unwrap();
}
