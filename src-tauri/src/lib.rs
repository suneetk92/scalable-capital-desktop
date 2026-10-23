mod auth;
mod background;
mod diagnostics;
mod files;
mod logging;
mod mcp;
mod notify;
mod updates;

// The extensions: build.rs writes their modules and the module that combines them.
include!(concat!(env!("OUT_DIR"), "/extensions.rs"));

use tauri::Manager;

fn core_handler() -> impl Fn(tauri::ipc::Invoke<tauri::Wry>) -> bool + Send + Sync + 'static {
    tauri::generate_handler![
        auth::begin_login,
        auth::login_status,
        auth::logout,
        auth::get_access_token,
        auth::get_session_info,
        auth::refresh_session,
        mcp::dashboard::load_dashboard,
        mcp::session::invalidate_session,
        mcp::dashboard::reload_groups,
        mcp::dashboard::reload_watchlist,
        mcp::dashboard::load_tool_schemas,
        mcp::trading::call_tools,
        mcp::trading::set_trading_enabled,
        mcp::trading::search_securities,
        mcp::trading::preview_order,
        mcp::trading::submit_order,
        mcp::savings::preview_savings_plan,
        mcp::savings::submit_savings_plan,
        background::get_background,
        background::set_background,
        notify::show_notification,
        updates::check_for_update,
        updates::install_update,
        diagnostics::export_diagnostics,
        diagnostics::open_log_folder,
    ]
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let extension_handler = extensions::handler();
    let result = tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            background::on_second_instance(app)
        }))
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            Some(vec![background::AUTOSTART_FLAG]),
        ))
        .manage(background::BackgroundState::default())
        .manage(auth::AuthState::default())
        .manage(mcp::trading::TradeState::default())
        .manage(mcp::savings::SavingsState::default())
        .manage(mcp::trading::TradingGate::default())
        .manage(mcp::session::SessionPool::default())
        .manage(updates::PendingUpdate::default())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .invoke_handler(move |invoke: tauri::ipc::Invoke<tauri::Wry>| {
            if extensions::handles(invoke.message.command()) {
                return extension_handler(invoke);
            }
            let core = core_handler();
            core(invoke)
        })
        .on_window_event(background::on_window_event)
        .setup(|app| {
            if let Ok(dir) = app.path().app_log_dir() {
                logging::init(dir);
            }
            logging::log_event(
                logging::Level::Info,
                "app",
                &format!("started version {}", env!("CARGO_PKG_VERSION")),
            );
            notify::register_app_id(app.handle());
            extensions::setup(app.handle());
            Ok(background::setup(app.handle())?)
        })
        .run(tauri::generate_context!());
    if let Err(error) = result {
        eprintln!("error while running Scalable Capital Desktop: {error}");
        std::process::exit(1);
    }
}
