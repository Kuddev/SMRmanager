mod detection;
mod installer;
mod updates;

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            detection::detect_environment,
            detection::list_wsl_distros,
            detection::wsl_set_default,
            detection::wsl_terminate,
            detection::wsl_start,
            detection::wsl_open_terminal,
            detection::open_terminal_at,
            detection::launch_client_in_project,
            detection::delete_skills,
            detection::copy_rule_to_client,
            detection::delete_rules,
            detection::transfer_skills,
            detection::adopt_skills_to_library,
            detection::link_skill_to_clients,
            detection::unlink_skill_from_clients,
            detection::import_skill,
            detection::install_mcp_server,
            detection::set_mcp_enabled,
            detection::set_all_mcp_enabled,
            detection::set_project_skill_enabled,
            detection::launch_client,
            detection::export_client_config,
            detection::import_client_config,
            detection::delete_client_config,
            detection::open_path,
            detection::get_notes,
            detection::set_note,
            detection::set_all_notes,
            detection::webdav_put,
            detection::webdav_get,
            installer::install_market_skill,
            installer::check_global_packages,
            installer::git_inspect,
            installer::git_apply,
            updates::check_app_update,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
