mod clicks;
mod dock;

use std::net::{Ipv4Addr, SocketAddr};
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::Mutex;
use std::{thread, time::Duration};

use tauri::menu::{CheckMenuItem, Menu, MenuItem, PredefinedMenuItem};
use tauri::{AppHandle, Manager, RunEvent, WebviewUrl, WebviewWindow, WebviewWindowBuilder};
use tauri_plugin_autostart::{MacosLauncher, ManagerExt};
use tauri_plugin_opener::OpenerExt;
use windows::Win32::Foundation::HWND;
use windows::Win32::UI::WindowsAndMessaging::SetForegroundWindow;

const DASHBOARD_HOST: &str = "analytics.claudecode.localhost";
const DASHBOARD_URL: &str = "http://analytics.claudecode.localhost/";
const WIDGET_API_URL: &str = "http://analytics.claudecode.localhost/api/widget";
const FETCH_TIMEOUT: Duration = Duration::from_secs(10);
const WATCH_EVERY: Duration = Duration::from_secs(3);

/// A GPU process alone costs about 50 MB, for a readout of two bars. This
/// replaces Tauri's own default (`--disable-features=...`), so that is repeated.
const BROWSER_ARGS: &str =
    "--disable-gpu --in-process-gpu --disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection";

const MENU_OPEN: &str = "open";
const MENU_AUTOSTART: &str = "autostart";
const MENU_QUIT: &str = "quit";

/// Label of the live window. A window dies with the taskbar it is a child of
/// and Tauri keeps its label registered, so each new window gets a new label.
struct Current(Mutex<Option<String>>);

/// The only request the widget can make. Windows does not resolve `*.localhost`
/// (browsers special-case it), so the host is pinned to loopback, where Traefik
/// listens; the `Host` header stays the real one for its routing.
#[tauri::command]
async fn fetch_widget() -> Result<String, String> {
    let client = reqwest::Client::builder()
        .resolve(DASHBOARD_HOST, SocketAddr::from((Ipv4Addr::LOCALHOST, 80)))
        .redirect(reqwest::redirect::Policy::none())
        .timeout(FETCH_TIMEOUT)
        .build()
        .map_err(|e| e.to_string())?;
    let response = client
        .get(WIDGET_API_URL)
        .send()
        .await
        .map_err(|e| e.to_string())?;
    if !response.status().is_success() {
        return Err(format!("HTTP {}", response.status()));
    }
    response.text().await.map_err(|e| e.to_string())
}

fn open_dashboard(app: &AppHandle) {
    if let Err(error) = app.opener().open_url(DASHBOARD_URL, None::<&str>) {
        eprintln!("cannot open the dashboard: {error}");
    }
}

/// Right-click menu of the readout; there is no tray icon.
fn show_menu(window: &WebviewWindow) -> tauri::Result<()> {
    let app = window.app_handle();
    let open = MenuItem::with_id(app, MENU_OPEN, "Open the dashboard", true, None::<&str>)?;
    let autostart = CheckMenuItem::with_id(
        app,
        MENU_AUTOSTART,
        "Start with Windows",
        true,
        app.autolaunch().is_enabled().unwrap_or(false),
        None::<&str>,
    )?;
    let quit = MenuItem::with_id(app, MENU_QUIT, "Quit", true, None::<&str>)?;
    let separator = PredefinedMenuItem::separator(app)?;
    let menu = Menu::with_items(app, &[&open, &autostart, &separator, &quit])?;
    // A menu closes at once unless its owner is the foreground window; the
    // click that would have made it so is swallowed by the hook.
    if let Ok(hwnd) = window.hwnd() {
        let _ = unsafe { SetForegroundWindow(HWND(hwnd.0 as _)) };
    }
    clicks::set_menu_open(true);
    let shown = window.popup_menu(&menu);
    clicks::set_menu_open(false);
    shown
}

fn on_menu_event(app: &AppHandle, id: &str) {
    match id {
        MENU_OPEN => open_dashboard(app),
        MENU_AUTOSTART => {
            let launcher = app.autolaunch();
            let _ = if launcher.is_enabled().unwrap_or(false) {
                launcher.disable()
            } else {
                launcher.enable()
            };
        }
        MENU_QUIT => app.exit(0),
        _ => {}
    }
}

fn live_window(app: &AppHandle) -> Option<WebviewWindow> {
    let label = app.state::<Current>().0.lock().unwrap().clone()?;
    app.get_webview_window(&label)
}

/// A click on the readout: left opens the dashboard, right shows the menu.
fn on_click(app: &AppHandle, left: bool) {
    if left {
        open_dashboard(app);
    } else if let Some(window) = live_window(app) {
        if let Err(error) = show_menu(&window) {
            eprintln!("cannot show the menu: {error}");
        }
    }
}

/// Created hidden: `dock` shows it once it sits in the taskbar, so it never
/// flashes on the desktop, and an Explorer that is not running just delays it.
fn create_window(app: &AppHandle) -> tauri::Result<()> {
    static NEXT: AtomicU32 = AtomicU32::new(1);
    let label = format!("widget-{}", NEXT.fetch_add(1, Ordering::Relaxed));
    let window = WebviewWindowBuilder::new(app, &label, WebviewUrl::default())
        .title("Claude Code Analytics Widget")
        .inner_size(190.0, 48.0)
        .additional_browser_args(BROWSER_ARGS)
        .decorations(false)
        .resizable(false)
        .skip_taskbar(true)
        .focused(false)
        .shadow(false)
        .transparent(true)
        .visible(false)
        .build()?;
    if let Ok(hwnd) = window.hwnd() {
        clicks::set_target(HWND(hwnd.0 as _));
    }
    *app.state::<Current>().0.lock().unwrap() = Some(label);
    if let Err(error) = dock::dock(&window) {
        eprintln!("cannot dock the widget yet: {error}");
    }
    Ok(())
}

/// Follows the tray area, and brings the window back after Explorer restarts.
fn watch(app: &AppHandle) {
    let window = live_window(app);
    match window {
        Some(window) if dock::is_alive(&window) => {
            if let Err(error) = dock::dock(&window) {
                eprintln!("watch: cannot dock: {error}");
            }
        }
        dead => {
            eprintln!("watch: the window is gone, recreating it");
            if let Some(window) = dead {
                let _ = window.destroy();
            }
            if let Err(error) = create_window(app) {
                eprintln!("watch: cannot recreate the window: {error}");
            }
        }
    }
}

pub fn run() {
    tauri::Builder::default()
        // First: a second launch exits at once, so there is one widget and one mouse hook.
        .plugin(tauri_plugin_single_instance::init(|_app, _args, _cwd| {}))
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_autostart::init(
            MacosLauncher::LaunchAgent,
            None,
        ))
        .manage(Current(Mutex::new(None)))
        .invoke_handler(tauri::generate_handler![fetch_widget])
        .on_menu_event(|app, event| on_menu_event(app, event.id().as_ref()))
        .setup(|app| {
            let handle = app.handle().clone();
            create_window(&handle)?;
            clicks::start(handle.clone(), on_click);
            thread::spawn(move || loop {
                thread::sleep(WATCH_EVERY);
                let on_main = handle.clone();
                let _ = handle.run_on_main_thread(move || watch(&on_main));
            });
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building the widget")
        .run(|_app, event| {
            // Losing the window (Explorer restart) must not end the app; only Quit does.
            if let RunEvent::ExitRequested { api, code, .. } = event {
                if code.is_none() {
                    api.prevent_exit();
                }
            }
        });
}
