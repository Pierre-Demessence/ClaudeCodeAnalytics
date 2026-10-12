//! Docks the widget window inside the Windows taskbar.
//!
//! Windows has no API for this: the window becomes a child of `Shell_TrayWnd`
//! and is placed left of the notification area (`TrayNotifyWnd`), the same way
//! the other taskbar widgets do it. A child dies with its parent, so when
//! Explorer restarts the window is gone and `main.rs` creates it again.

use windows::core::w;
use windows::Win32::Foundation::{HWND, RECT};
use windows::Win32::UI::HiDpi::GetDpiForWindow;
use windows::Win32::UI::WindowsAndMessaging::{
    FindWindowExW, FindWindowW, GetParent, GetWindowLongW, GetWindowRect, IsWindow, SetParent,
    SetWindowLongW, SetWindowPos, GWL_EXSTYLE, GWL_STYLE, HWND_TOP, SWP_FRAMECHANGED,
    SWP_NOACTIVATE, WS_CHILD, WS_CLIPSIBLINGS, WS_EX_LAYERED, WS_EX_NOACTIVATE, WS_EX_TOOLWINDOW,
    WS_EX_TOPMOST, WS_POPUP,
};

use crate::render::LOGICAL_WIDTH;

const BASE_DPI: f32 = 96.0;

fn rect_of(hwnd: HWND) -> Result<RECT, String> {
    let mut rect = RECT::default();
    unsafe { GetWindowRect(hwnd, &mut rect) }.map_err(|e| e.to_string())?;
    Ok(rect)
}

/// False once the taskbar the window was a child of is destroyed (Explorer restart):
/// the handle is then invalid for good.
pub fn is_alive(hwnd: HWND) -> bool {
    unsafe { IsWindow(Some(hwnd)) }.as_bool()
}

/// Docks the window, or does nothing when it already sits where it belongs, so
/// the caller can run it on a timer to follow the tray area as it grows.
/// Returns whether the window moved or changed size, which means a redraw.
pub fn dock(hwnd: HWND) -> Result<bool, String> {
    let taskbar = unsafe { FindWindowW(w!("Shell_TrayWnd"), None) }.map_err(|e| e.to_string())?;
    let tray = unsafe { FindWindowExW(Some(taskbar), None, w!("TrayNotifyWnd"), None) }
        .map_err(|e| e.to_string())?;
    let taskbar_rect = rect_of(taskbar)?;
    let tray_rect = rect_of(tray)?;

    // The taskbar's DPI is the one that counts, and it is known before the window
    // sits on that monitor, which a new window's own DPI is not.
    let dpi = unsafe { GetDpiForWindow(taskbar) };
    let scale = if dpi == 0 { 1.0 } else { dpi as f32 / BASE_DPI };
    let width = (LOGICAL_WIDTH * scale).round() as i32;
    let height = taskbar_rect.bottom - taskbar_rect.top;
    let x = tray_rect.left - taskbar_rect.left - width;

    let current = rect_of(hwnd)?;
    let docked = unsafe { GetParent(hwnd) }.ok() == Some(taskbar)
        && current.left == taskbar_rect.left + x
        && current.top == taskbar_rect.top
        && current.right - current.left == width
        && current.bottom - current.top == height;
    if docked {
        return Ok(false);
    }

    unsafe {
        let ex_style = GetWindowLongW(hwnd, GWL_EXSTYLE) as u32;
        let ex_style =
            (ex_style | WS_EX_LAYERED.0 | WS_EX_TOOLWINDOW.0 | WS_EX_NOACTIVATE.0) & !WS_EX_TOPMOST.0;
        SetWindowLongW(hwnd, GWL_EXSTYLE, ex_style as i32);

        let style = GetWindowLongW(hwnd, GWL_STYLE) as u32;
        let style = (style & !WS_POPUP.0) | WS_CHILD.0 | WS_CLIPSIBLINGS.0;
        SetWindowLongW(hwnd, GWL_STYLE, style as i32);

        if GetParent(hwnd).ok() != Some(taskbar) {
            SetParent(hwnd, Some(taskbar)).map_err(|e| e.to_string())?;
        }
        SetWindowPos(
            hwnd,
            Some(HWND_TOP),
            x,
            0,
            width,
            height,
            SWP_FRAMECHANGED | SWP_NOACTIVATE,
        )
        .map_err(|e| e.to_string())?;
    }
    Ok(true)
}
