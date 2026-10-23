use std::{env, fs, path::Path};

fn main() {
    println!("cargo:rerun-if-env-changed=APP_EXTENSION_DIR");
    println!("cargo:rerun-if-changed=../bundled-extensions.json");
    extensions();
    tauri_build::build()
}

/// The bundled public extensions come from `bundled-extensions.json`; with the `extension` feature the
/// folder named by APP_EXTENSION_DIR joins them. Folders are relative to the repository root. build.rs
/// writes one `mod ext_<name>;` per folder, pointing at its `src-tauri/mod.rs`, plus a module that
/// combines them for `lib.rs`.
fn extensions() {
    let manifest = env::var("CARGO_MANIFEST_DIR").unwrap();
    let root = Path::new(&manifest).join("..");
    let list = fs::read_to_string(root.join("bundled-extensions.json"))
        .expect("bundled-extensions.json is missing");
    let mut dirs: Vec<String> = list
        .split('"')
        .skip(1)
        .step_by(2)
        .map(str::to_owned)
        .collect();
    let private = env::var_os("CARGO_FEATURE_EXTENSION").is_some();
    if private {
        dirs.push(
            env::var("APP_EXTENSION_DIR").expect(
                "the extension feature needs APP_EXTENSION_DIR, the folder of the extension",
            ),
        );
    }

    let mut mods = String::new();
    let mut names = Vec::new();
    for dir in &dirs {
        let module = root.join(dir).join("src-tauri/mod.rs");
        println!("cargo:rerun-if-changed={}", module.display());
        let module = module
            .canonicalize()
            .unwrap_or_else(|error| panic!("no extension module at {}: {error}", module.display()));
        let name: String = Path::new(dir)
            .file_name()
            .unwrap()
            .to_string_lossy()
            .chars()
            .map(|c| if c.is_ascii_alphanumeric() { c } else { '_' })
            .collect();
        let name = format!("ext_{name}");
        mods += &format!("#[path = {:?}]\nmod {name};\n", module.to_string_lossy());
        names.push(name);
    }

    let mut glue = String::from("mod extensions {\n");
    glue += "    pub fn handles(command: &str) -> bool {\n        false";
    for name in &names {
        glue += &format!(" || super::{name}::handles(command)");
    }
    glue += "\n    }\n\n";
    glue += "    pub fn handler() -> impl Fn(tauri::ipc::Invoke<tauri::Wry>) -> bool + Send + Sync + 'static {\n";
    for name in &names {
        glue += &format!("        let {name} = super::{name}::handler();\n");
    }
    glue += "        move |invoke| {\n";
    for name in &names {
        glue += &format!(
            "            if super::{name}::handles(invoke.message.command()) {{\n                return {name}(invoke);\n            }}\n"
        );
    }
    glue += "            false\n        }\n    }\n\n";
    glue += "    pub fn setup(app: &tauri::AppHandle) {\n";
    for name in &names {
        glue += &format!("        super::{name}::setup(app);\n");
    }
    glue += "        let _ = app;\n    }\n\n";
    glue +=
        "    /// Whether an extension is in the middle of something that Quit should wait for.\n";
    glue +=
        "    pub fn busy(app: &tauri::AppHandle) -> bool {\n        let _ = app;\n        false";
    for name in &names {
        glue += &format!(" || super::{name}::busy(app)");
    }
    glue += "\n    }\n";
    if private {
        let last = names.last().unwrap();
        glue += &format!("\n    pub const APP_NAME: &str = super::{last}::APP_NAME;\n");
    }
    glue += "}\n";

    let out = Path::new(&env::var("OUT_DIR").unwrap()).join("extensions.rs");
    fs::write(out, mods + &glue).unwrap();
}
