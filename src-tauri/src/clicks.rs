//! Real mouse clicks on the readout.
//!
//! The web page of a window docked in the taskbar never receives real mouse
//! input (hover, click, right-click), though the same events posted as window
//! messages reach it. A low-level mouse hook sees the real clicks instead, so
//! the click is handled here, in Rust, and the page only draws.

use std::sync::atomic::{AtomicBool, AtomicIsize, Ordering};
use std::sync::OnceLock;
use std::thread;

use tauri::AppHandle;
use windows::Win32::Foundation::{HWND, LPARAM, LRESULT, POINT, WPARAM};
use windows::Win32::UI::WindowsAndMessaging::{
    CallNextHookEx, GetMessageW, IsChild, SetWindowsHookExW, WindowFromPoint, MSG, MSLLHOOKSTRUCT,
    WH_MOUSE_LL, WM_LBUTTONDOWN, WM_LBUTTONUP, WM_RBUTTONDOWN, WM_RBUTTONUP,
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

/// Whether the last press of each button landed on the widget: its release is
/// then ours too, wherever the pointer is by then.
static LEFT_PRESSED_ON_WIDGET: AtomicBool = AtomicBool::new(false);
static RIGHT_PRESSED_ON_WIDGET: AtomicBool = AtomicBool::new(false);
/// While the menu is up its own loop must see every click, or a click on the
/// widget would neither dismiss it nor be safe to act on.
static MENU_OPEN: AtomicBool = AtomicBool::new(false);

pub fn set_menu_open(open: bool) {
    MENU_OPEN.store(open, Ordering::Relaxed);
}

/// Clicks on the widget are swallowed (the hook does not pass them on): the
/// taskbar below it would otherwise open its own context menu on a right click.
unsafe extern "system" fn hook(code: i32, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
    let message = wparam.0 as u32;
    let pressed = match message {
        WM_LBUTTONDOWN | WM_LBUTTONUP => Some(&LEFT_PRESSED_ON_WIDGET),
        WM_RBUTTONDOWN | WM_RBUTTONUP => Some(&RIGHT_PRESSED_ON_WIDGET),
        _ => None,
    };
    if let (true, false, Some(pressed)) = (code >= 0, MENU_OPEN.load(Ordering::Relaxed), pressed) {
        let info = &*(lparam.0 as *const MSLLHOOKSTRUCT);
        if message == WM_LBUTTONDOWN || message == WM_RBUTTONDOWN {
            let over = over_widget(info.pt);
            pressed.store(over, Ordering::Relaxed);
            if over {
                return LRESULT(1);
            }
        } else if pressed.swap(false, Ordering::Relaxed) {
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
            return LRESULT(1);
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
