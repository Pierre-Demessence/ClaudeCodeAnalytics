//! The taskbar's theme, which Windows keeps apart from the apps' one that the
//! page's `prefers-color-scheme` follows.

use std::time::Duration;
use std::{mem, thread};

use tauri::{AppHandle, Emitter};
use windows::core::w;
use windows::Win32::System::Registry::{
    RegCloseKey, RegGetValueW, RegNotifyChangeKeyValue, RegOpenKeyExW, HKEY, HKEY_CURRENT_USER,
    KEY_NOTIFY, REG_NOTIFY_CHANGE_LAST_SET, RRF_RT_REG_DWORD,
};

/// Event the page listens to; its payload is the new theme.
pub const EVENT: &str = "taskbar-theme";
const RETRY_AFTER: Duration = Duration::from_secs(5);

/// `"light"` or `"dark"`. Windows 11 treats a missing value as light.
#[tauri::command]
pub fn taskbar_theme() -> &'static str {
    let mut value: u32 = 1;
    let mut size = mem::size_of::<u32>() as u32;
    let _ = unsafe {
        RegGetValueW(
            HKEY_CURRENT_USER,
            w!(r"Software\Microsoft\Windows\CurrentVersion\Themes\Personalize"),
            w!("SystemUsesLightTheme"),
            RRF_RT_REG_DWORD,
            None,
            Some(&mut value as *mut u32 as *mut _),
            Some(&mut size),
        )
    };
    if value == 0 {
        "dark"
    } else {
        "light"
    }
}

/// Blocks until something under the key changes. The key is opened again on
/// every round, so a key that was deleted and recreated is followed too.
fn wait_for_change() -> Result<(), String> {
    let mut key = HKEY::default();
    unsafe {
        RegOpenKeyExW(
            HKEY_CURRENT_USER,
            w!(r"Software\Microsoft\Windows\CurrentVersion\Themes\Personalize"),
            None,
            KEY_NOTIFY,
            &mut key,
        )
        .ok()
        .map_err(|e| e.to_string())?;
        let waited = RegNotifyChangeKeyValue(key, false, REG_NOTIFY_CHANGE_LAST_SET, None, false);
        let _ = RegCloseKey(key);
        waited.ok().map_err(|e| e.to_string())
    }
}

/// Tells the page the moment the theme changes, so it never has to poll.
pub fn watch(app: AppHandle) {
    thread::spawn(move || loop {
        match wait_for_change() {
            Ok(()) => {
                let _ = app.emit(EVENT, taskbar_theme());
            }
            Err(error) => {
                eprintln!("theme: cannot watch the registry: {error}");
                thread::sleep(RETRY_AFTER);
            }
        }
    });
}
