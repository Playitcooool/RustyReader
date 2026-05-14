use tauri::{
    menu::{MenuBuilder, PredefinedMenuItem, SubmenuBuilder},
    App, Emitter,
};

pub(crate) fn install_menu(app: &mut App) -> Result<(), Box<dyn std::error::Error>> {
    let file_menu = SubmenuBuilder::new(&*app, "File")
        .text("import_documents", "Import Documents")
        .text("import_citations", "Import Citations")
        .separator()
        .quit()
        .build()?;
    let app_menu = SubmenuBuilder::new(&*app, "Paper Reader")
        .text("app_import_documents", "Import")
        .separator()
        .text("open_settings", "Settings…")
        .build()?;
    let edit_menu = SubmenuBuilder::new(&*app, "Edit")
        .item(&PredefinedMenuItem::undo(&*app, None)?)
        .item(&PredefinedMenuItem::redo(&*app, None)?)
        .separator()
        .item(&PredefinedMenuItem::cut(&*app, None)?)
        .item(&PredefinedMenuItem::copy(&*app, None)?)
        .item(&PredefinedMenuItem::paste(&*app, None)?)
        .item(&PredefinedMenuItem::select_all(&*app, None)?)
        .build()?;
    let menu = MenuBuilder::new(&*app)
        .item(&app_menu)
        .item(&file_menu)
        .item(&edit_menu)
        .build()?;
    app.set_menu(menu)?;
    app.on_menu_event(|app_handle, event| match event.id().0.as_str() {
        "app_import_documents" | "import_documents" => {
            let _ = app_handle.emit("menu:import-documents", ());
        }
        "import_citations" => {
            let _ = app_handle.emit("menu:import-citations", ());
        }
        "open_settings" => {
            let _ = app_handle.emit("menu:open-settings", ());
        }
        _ => {}
    });

    Ok(())
}
