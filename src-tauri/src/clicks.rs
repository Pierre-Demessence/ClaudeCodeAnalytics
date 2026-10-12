//! Real mouse clicks on the readout.
//!
//! The web page of a window docked in the taskbar never receives real mouse
//! input (hover, click, right-click), though the same events posted as window
//! messages reach it. A low-level mouse hook sees the real clicks instead, so
//! the click is handled here, in Rust, and the page only draws.

use std::sync::atomic::{AtomicIsize, Ordering};
use std::sync::OnceLock;
use std::thread;

use tauri::AppHandle;
use windows::Win32::Foundation::{HWND, LPARAM, LRESULT, POINT, WPARAM};
use windows::Win32::UI::WindowsAndMessaging::{
    CallNextHookEx, GetMessageW, IsChild, SetWindowsHookExW, WindowFromPoint, MSG, MSLLHOOKSTRUCT,
    WH_MOUSE_LL, WM_LBUTTONUP, WM_RBUTTONUP,
};

type OnClick = fn(&AppHandle, bool);

static APP: OnceLock<(AppHandle, OnClick)> = OnceLock::new();
/// The live window; clicks count only when they land on it or on its web view,
/// so a click at the same spot while a full-screen app covers it does nothing.
static TARGET: AtomicIsize = AtomicIsize::new(0);

pub fn set_target(hwnd: HWND) {
    TARGET.store(hwnd.0 as isize, Ordering::Relaxed);
}

fn over_widget(point: POINT) -> bool {
    let target = HWND(TARGET.load(Ordering::Relaxed) as _);
    if target.0.is_null() {
        return false;
    }
    let hit = unsafe { WindowFromPoint(point) };
    hit == target || unsafe { IsChild(target, hit) }.as_bool()
}

unsafe extern "system" fn hook(code: i32, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
    let message = wparam.0 as u32;
    if code >= 0 && (message == WM_LBUTTONUP || message == WM_RBUTTONUP) {
        let info = &*(lparam.0 as *const MSLLHOOKSTRUCT);
        if over_widget(info.pt) {
            if let Some((app, on_click)) = APP.get() {
                // The hook must return fast (Windows drops slow hooks): hand off to the main thread.
                let app = app.clone();
                let on_click = *on_click;
                let _ = app
                    .clone()
                    .run_on_main_thread(move || on_click(&app, message == WM_LBUTTONUP));
            }
        }
    }
    CallNextHookEx(None, code, wparam, lparam)
}

/// Calls `on_click(app, is_left_button)` on the main thread for each click on the widget.
pub fn start(app: AppHandle, on_click: OnClick) {
    if APP.set((app, on_click)).is_err() {
        return;
    }
    thread::spawn(|| unsafe {
        if SetWindowsHookExW(WH_MOUSE_LL, Some(hook), None, 0).is_err() {
            eprintln!("cannot hook the mouse: clicks on the widget will do nothing");
            return;
        }
        let mut message = MSG::default();
        while GetMessageW(&mut message, None, 0, 0).as_bool() {}
    });
}
