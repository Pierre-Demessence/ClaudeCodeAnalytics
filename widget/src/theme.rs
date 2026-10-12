//! The taskbar's theme, which Windows keeps apart from the apps' one.

use std::time::Duration;
use std::{mem, thread};

use windows::core::w;
use windows::Win32::Foundation::{LPARAM, WPARAM};
use windows::Win32::System::Registry::{
    RegCloseKey, RegGetValueW, RegNotifyChangeKeyValue, RegOpenKeyExW, HKEY, HKEY_CURRENT_USER,
    KEY_NOTIFY, REG_NOTIFY_CHANGE_LAST_SET, RRF_RT_REG_DWORD,
};
use windows::Win32::UI::WindowsAndMessaging::PostThreadMessageW;

const RETRY_AFTER: Duration = Duration::from_secs(5);

/// Whether the taskbar is dark. Windows 11 treats a missing value as light.
pub fn is_dark() -> bool {
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
    value == 0
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

/// Posts `message` to the thread the moment the theme changes, so nothing polls.
pub fn watch(thread_id: u32, message: u32) {
    thread::spawn(move || loop {
        match wait_for_change() {
            Ok(()) => {
                let _ = unsafe { PostThreadMessageW(thread_id, message, WPARAM(0), LPARAM(0)) };
            }
            Err(error) => {
                eprintln!("theme: cannot watch the registry: {error}");
                thread::sleep(RETRY_AFTER);
            }
        }
    });
}
