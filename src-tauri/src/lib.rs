mod detection;
mod installer;
mod updates;

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            detection::detect_environment,
            detection::list_wsl_distros,
            detection::delete_skills,
            detection::transfer_skills,
            detection::import_skill,
            detection::install_mcp_server,
            detection::set_mcp_enabled,
            detection::set_all_mcp_enabled,
            detection::launch_client,
            detection::export_client_config,
            detection::import_client_config,
            detection::delete_client_config,
            detection::open_path,
            installer::install_market_skill,
            installer::check_global_packages,
            updates::check_app_update,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
