//! "Start with Windows": a value under the user's `Run` key, which needs no
//! installer and no elevation.

use windows::core::{w, PCWSTR};
use windows::Win32::System::Registry::{
    RegCloseKey, RegDeleteValueW, RegGetValueW, RegOpenKeyExW, RegSetValueExW, HKEY,
    HKEY_CURRENT_USER, KEY_SET_VALUE, REG_SZ, RRF_RT_REG_SZ,
};

const KEY: PCWSTR = w!(r"Software\Microsoft\Windows\CurrentVersion\Run");
const NAME: PCWSTR = w!("Claude Code Analytics Widget");

/// On only when the value starts this exe: a leftover entry of an older install,
/// or of a debug build, would otherwise show as checked while starting something else.
pub fn is_enabled() -> bool {
    let Ok(expected) = command() else { return false };
    let mut stored = [0u16; 1024];
    let mut size = std::mem::size_of_val(&stored) as u32;
    let read = unsafe {
        RegGetValueW(
            HKEY_CURRENT_USER,
            KEY,
            NAME,
            RRF_RT_REG_SZ,
            None,
            Some(stored.as_mut_ptr() as *mut _),
            Some(&mut size),
        )
    };
    let length = (size as usize / 2).min(stored.len());
    read.ok().is_ok() && stored[..length] == expected[..]
}

/// The command stored: the running exe, quoted for paths with spaces.
fn command() -> Result<Vec<u16>, String> {
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    let quoted = format!("\"{}\"", exe.display());
    Ok(quoted.encode_utf16().chain(Some(0)).collect())
}

pub fn set(enabled: bool) -> Result<(), String> {
    let command = command()?;
    let mut key = HKEY::default();
    unsafe {
        RegOpenKeyExW(HKEY_CURRENT_USER, KEY, None, KEY_SET_VALUE, &mut key)
            .ok()
            .map_err(|e| e.to_string())?;
        let result = if enabled {
            let bytes = std::slice::from_raw_parts(command.as_ptr() as *const u8, command.len() * 2);
            RegSetValueExW(key, NAME, None, REG_SZ, Some(bytes))
        } else {
            RegDeleteValueW(key, NAME)
        };
        let _ = RegCloseKey(key);
        result.ok().map_err(|e| e.to_string())
    }
}
