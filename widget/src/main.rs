// Hides the console window in release builds on Windows.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod autostart;
mod dock;
mod fetch;
mod render;
mod source;
mod template;
mod theme;
mod view;
mod window;

use std::sync::Mutex;
use std::thread;
use std::time::{Duration, SystemTime};

use windows::core::w;
use windows::Win32::Foundation::{GetLastError, ERROR_ALREADY_EXISTS, HWND, LPARAM, WPARAM};
use windows::Win32::System::Threading::{CreateMutexW, GetCurrentThreadId};
use windows::Win32::UI::WindowsAndMessaging::{
    DestroyWindow, DispatchMessageW, GetMessageW, PostThreadMessageW, SetTimer, TranslateMessage,
    MSG, WM_APP, WM_TIMER,
};

use view::State;

/// Posted to the main thread when the state or the theme changed: redraw.
pub const WM_REFRESH: u32 = WM_APP + 1;

const FETCH_EVERY: Duration = Duration::from_secs(60);
/// Follows the tray area, and brings the window back after Explorer restarts.
const WATCH_EVERY_MS: u32 = 3_000;
/// Redraws for the countdown of the resets.
const TICK_EVERY_MS: u32 = 30_000;
/// Debug builds only: looks for a saved `widget.svg`.
const RELOAD_EVERY_MS: u32 = 500;

static STATE: Mutex<State> = Mutex::new(State {
    offline: false,
    view: None,
});

struct App {
    /// Set once the window is docked: before that it has no place to draw in.
    docked: bool,
    hwnd: Option<HWND>,
}

impl App {
    fn redraw(&self) {
        if let (Some(hwnd), true) = (self.hwnd, self.docked) {
            let state = STATE.lock().unwrap().clone();
            window::redraw(hwnd, &state);
        }
    }

    /// Creates the window if it is missing, docks it and redraws when it moved.
    fn watch(&mut self) {
        let alive = self.hwnd.is_some_and(dock::is_alive);
        if !alive {
            if let Some(hwnd) = self.hwnd.take() {
                eprintln!("watch: the window is gone, recreating it");
                let _ = unsafe { DestroyWindow(hwnd) };
            }
            self.docked = false;
            match window::create() {
                Ok(hwnd) => self.hwnd = Some(hwnd),
                Err(error) => {
                    eprintln!("watch: cannot create the window: {error}");
                    return;
                }
            }
        }
        let Some(hwnd) = self.hwnd else { return };
        match dock::dock(hwnd) {
            Ok(changed) => {
                self.docked = true;
                if changed {
                    self.redraw();
                }
            }
            Err(error) => eprintln!("watch: cannot dock yet: {error}"),
        }
    }
}

/// Polls the dashboard; the result is shared through `STATE`.
fn poll(thread_id: u32) {
    thread::spawn(move || loop {
        match fetch::fetch() {
            Ok(view) => {
                let mut state = STATE.lock().unwrap();
                state.view = Some(view);
                state.offline = false;
            }
            Err(error) => {
                eprintln!("fetch: {error}");
                STATE.lock().unwrap().offline = true;
            }
        }
        let _ = unsafe { PostThreadMessageW(thread_id, WM_REFRESH, WPARAM(0), LPARAM(0)) };
        thread::sleep(FETCH_EVERY);
    });
}

fn main() {
    // A second launch exits at once, so there is one widget.
    let single_instance = unsafe { CreateMutexW(None, true, w!(r"Local\ClaudeCodeAnalyticsWidget")) };
    if single_instance.is_err() || unsafe { GetLastError() } == ERROR_ALREADY_EXISTS {
        return;
    }
    if let Err(error) = window::register() {
        eprintln!("{error}");
        return;
    }

    let mut app = App {
        docked: false,
        hwnd: None,
    };
    app.watch();

    // Thread timers have no window: the system picks their ids.
    let (watch_timer, tick_timer, reload_timer) = unsafe {
        (
            SetTimer(None, 0, WATCH_EVERY_MS, None),
            SetTimer(None, 0, TICK_EVERY_MS, None),
            if cfg!(debug_assertions) {
                SetTimer(None, 0, RELOAD_EVERY_MS, None)
            } else {
                0
            },
        )
    };
    let thread_id = unsafe { GetCurrentThreadId() };
    poll(thread_id);
    theme::watch(thread_id, WM_REFRESH);

    let mut template_modified: Option<SystemTime> = source::modified();
    let mut message = MSG::default();
    while unsafe { GetMessageW(&mut message, None, 0, 0) }.0 > 0 {
        let on_thread = message.hwnd.0.is_null();
        if on_thread && message.message == WM_REFRESH {
            app.redraw();
        } else if on_thread && message.message == WM_TIMER {
            let id = message.wParam.0;
            if id == watch_timer {
                app.watch();
            } else if id == tick_timer {
                app.redraw();
            } else if id == reload_timer && reload_timer != 0 {
                let modified = source::modified();
                if modified != template_modified {
                    template_modified = modified;
                    app.redraw();
                }
            }
        } else {
            let _ = unsafe { TranslateMessage(&message) };
            unsafe { DispatchMessageW(&message) };
        }
    }
}
