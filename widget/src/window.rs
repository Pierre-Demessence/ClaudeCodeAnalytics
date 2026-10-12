//! The widget's window: a layered window whose pixels come from `render`.
//!
//! As a child of the taskbar it gets real mouse messages, and being on top of
//! the taskbar, its right click never reaches the taskbar's own menu.

use std::mem;
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

use windows::core::{w, PCWSTR};
use windows::Win32::Foundation::{COLORREF, HWND, LPARAM, LRESULT, POINT, RECT, SIZE, WPARAM};
use windows::Win32::Graphics::Gdi::{
    CreateCompatibleDC, CreateDIBSection, DeleteDC, DeleteObject, GetDC, ReleaseDC, SelectObject,
    AC_SRC_ALPHA, AC_SRC_OVER, BITMAPINFO, BITMAPINFOHEADER, BI_RGB, BLENDFUNCTION,
    DIB_RGB_COLORS, HGDIOBJ,
};
use windows::Win32::System::LibraryLoader::GetModuleHandleW;
use windows::Win32::UI::Shell::ShellExecuteW;
use windows::Win32::UI::WindowsAndMessaging::{
    AppendMenuW, CreatePopupMenu, CreateWindowExW, DefWindowProcW, DestroyMenu, GetCursorPos,
    GetWindowRect, LoadCursorW, PostMessageW, PostQuitMessage, RegisterClassW, SetCursor,
    SetForegroundWindow, SetWindowTextW, ShowWindow, TrackPopupMenu, UpdateLayeredWindow,
    IDC_HAND, MA_NOACTIVATE, MF_CHECKED, MF_SEPARATOR, MF_STRING, SW_SHOWNOACTIVATE,
    SW_SHOWNORMAL, TPM_BOTTOMALIGN, TPM_RETURNCMD, TPM_RIGHTBUTTON, ULW_ALPHA, WM_LBUTTONUP,
    WM_MOUSEACTIVATE, WM_NULL, WM_RBUTTONUP, WM_SETCURSOR, WNDCLASSW, WS_EX_LAYERED,
    WS_EX_NOACTIVATE, WS_EX_TOOLWINDOW, WS_POPUP,
};

use crate::render::{self, Frame};
use crate::view::{self, State};
use crate::{autostart, source, template, theme};

pub const DASHBOARD_URL: &str = "http://analytics.claudecode.localhost/";
const CLASS: PCWSTR = w!("ClaudeCodeAnalyticsWidget");
const TITLE: PCWSTR = w!("Claude Code Analytics Widget");

const MENU_OPEN: usize = 1;
const MENU_AUTOSTART: usize = 2;
const MENU_QUIT: usize = 3;

pub fn register() -> Result<(), String> {
    unsafe {
        let instance = GetModuleHandleW(None).map_err(|e| e.to_string())?;
        let class = WNDCLASSW {
            lpfnWndProc: Some(procedure),
            hInstance: instance.into(),
            lpszClassName: CLASS,
            ..Default::default()
        };
        if RegisterClassW(&class) == 0 {
            return Err("cannot register the window class".to_string());
        }
    }
    Ok(())
}

/// Created hidden and unparented: `dock` places it in the taskbar and `redraw`
/// shows it once it has pixels, so it never flashes on the desktop, and an Explorer
/// that is not running just delays it.
pub fn create() -> Result<HWND, String> {
    unsafe {
        let instance = GetModuleHandleW(None).map_err(|e| e.to_string())?;
        CreateWindowExW(
            WS_EX_LAYERED | WS_EX_TOOLWINDOW | WS_EX_NOACTIVATE,
            CLASS,
            TITLE,
            WS_POPUP,
            0,
            0,
            10,
            10,
            None,
            None,
            Some(instance.into()),
            None,
        )
        .map_err(|e| e.to_string())
    }
}

fn open_dashboard() {
    let wide: Vec<u16> = DASHBOARD_URL.encode_utf16().chain(Some(0)).collect();
    // A value over 32 means success; there is nothing to do about a failure here.
    unsafe {
        ShellExecuteW(None, w!("open"), PCWSTR(wide.as_ptr()), None, None, SW_SHOWNORMAL);
    }
}

/// Right-click menu of the readout; there is no tray icon.
fn show_menu(hwnd: HWND) {
    unsafe {
        let Ok(menu) = CreatePopupMenu() else { return };
        let autostart = autostart::is_enabled();
        let _ = AppendMenuW(menu, MF_STRING, MENU_OPEN, w!("Open the dashboard"));
        let _ = AppendMenuW(
            menu,
            MF_STRING | if autostart { MF_CHECKED } else { Default::default() },
            MENU_AUTOSTART,
            w!("Start with Windows"),
        );
        let _ = AppendMenuW(menu, MF_SEPARATOR, 0, PCWSTR::null());
        let _ = AppendMenuW(menu, MF_STRING, MENU_QUIT, w!("Quit"));

        let mut point = POINT::default();
        let _ = GetCursorPos(&mut point);
        // A menu closes at once unless its owner is the foreground window, and a
        // click outside dismisses it only after the `WM_NULL` below.
        let _ = SetForegroundWindow(hwnd);
        let chosen = TrackPopupMenu(
            menu,
            TPM_RETURNCMD | TPM_RIGHTBUTTON | TPM_BOTTOMALIGN,
            point.x,
            point.y,
            None,
            hwnd,
            None,
        );
        let _ = PostMessageW(Some(hwnd), WM_NULL, WPARAM(0), LPARAM(0));
        let _ = DestroyMenu(menu);

        match chosen.0 as usize {
            MENU_OPEN => open_dashboard(),
            MENU_AUTOSTART => {
                if let Err(error) = autostart::set(!autostart) {
                    eprintln!("cannot change the autostart: {error}");
                }
            }
            MENU_QUIT => PostQuitMessage(0),
            _ => {}
        }
    }
}

unsafe extern "system" fn procedure(hwnd: HWND, message: u32, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
    match message {
        WM_LBUTTONUP => {
            open_dashboard();
            LRESULT(0)
        }
        WM_RBUTTONUP => {
            show_menu(hwnd);
            LRESULT(0)
        }
        WM_SETCURSOR => {
            if let Ok(hand) = unsafe { LoadCursorW(None, IDC_HAND) } {
                unsafe { SetCursor(Some(hand)) };
            }
            LRESULT(1)
        }
        WM_MOUSEACTIVATE => LRESULT(MA_NOACTIVATE as isize),
        _ => unsafe { DefWindowProcW(hwnd, message, wparam, lparam) },
    }
}

/// Shows `frame` as the window's content, with its own transparency.
fn present(hwnd: HWND, frame: &Frame) -> Result<(), String> {
    let (width, height) = (frame.width as i32, frame.height as i32);
    unsafe {
        let screen = GetDC(None);
        let memory = CreateCompatibleDC(Some(screen));
        let info = BITMAPINFO {
            bmiHeader: BITMAPINFOHEADER {
                biSize: mem::size_of::<BITMAPINFOHEADER>() as u32,
                biWidth: width,
                // Negative: rows run top to bottom, as `resvg` writes them.
                biHeight: -height,
                biPlanes: 1,
                biBitCount: 32,
                biCompression: BI_RGB.0,
                ..Default::default()
            },
            ..Default::default()
        };
        let mut bits: *mut core::ffi::c_void = std::ptr::null_mut();
        let bitmap = CreateDIBSection(Some(memory), &info, DIB_RGB_COLORS, &mut bits, None, 0);
        let result = match bitmap {
            Ok(bitmap) => {
                std::ptr::copy_nonoverlapping(frame.bgra.as_ptr(), bits as *mut u8, frame.bgra.len());
                let previous = SelectObject(memory, HGDIOBJ(bitmap.0));
                let size = SIZE { cx: width, cy: height };
                let origin = POINT::default();
                let blend = BLENDFUNCTION {
                    BlendOp: AC_SRC_OVER as u8,
                    BlendFlags: 0,
                    SourceConstantAlpha: 255,
                    AlphaFormat: AC_SRC_ALPHA as u8,
                };
                let shown = UpdateLayeredWindow(
                    hwnd,
                    Some(screen),
                    None,
                    Some(&size),
                    Some(memory),
                    Some(&origin),
                    COLORREF(0),
                    Some(&blend),
                    ULW_ALPHA,
                );
                SelectObject(memory, previous);
                let _ = DeleteObject(HGDIOBJ(bitmap.0));
                shown.map_err(|e| e.to_string())
            }
            Err(error) => Err(error.to_string()),
        };
        let _ = DeleteDC(memory);
        ReleaseDC(None, screen);
        result
    }
}

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |elapsed| elapsed.as_millis() as i64)
}

/// The last template that rendered, kept for a debug build whose file is mid-edit.
static LAST_GOOD: Mutex<Option<String>> = Mutex::new(None);

fn draw(readout: &view::Readout, dark: bool, width: u32, height: u32) -> Result<Frame, String> {
    let template = source::current();
    match render::render(&template::svg(&template, readout, dark), width, height) {
        Ok(frame) => {
            *LAST_GOOD.lock().unwrap() = Some(template);
            Ok(frame)
        }
        Err(error) => {
            let good = LAST_GOOD.lock().unwrap().clone();
            match good {
                Some(good) if good != template => {
                    eprintln!("widget.svg: {error}; keeping the last good one");
                    render::render(&template::svg(&good, readout, dark), width, height)
                }
                _ if template != source::EMBEDDED => {
                    eprintln!("widget.svg: {error}; using the embedded one");
                    render::render(&template::svg(source::EMBEDDED, readout, dark), width, height)
                }
                _ => Err(error),
            }
        }
    }
}

/// Draws the state at the window's current size and shows the window.
pub fn redraw(hwnd: HWND, state: &State) {
    let mut rect = RECT::default();
    if unsafe { GetWindowRect(hwnd, &mut rect) }.is_err() {
        return;
    }
    let (width, height) = ((rect.right - rect.left) as u32, (rect.bottom - rect.top) as u32);
    let readout = view::readout(state, now_ms());
    match draw(&readout, theme::is_dark(), width, height) {
        Ok(frame) => {
            if let Err(error) = present(hwnd, &frame) {
                eprintln!("cannot show the widget: {error}");
                return;
            }
            let text: Vec<u16> = view::describe(&readout).encode_utf16().chain(Some(0)).collect();
            unsafe {
                let _ = SetWindowTextW(hwnd, PCWSTR(text.as_ptr()));
                let _ = ShowWindow(hwnd, SW_SHOWNOACTIVATE);
            }
        }
        Err(error) => eprintln!("cannot draw the widget: {error}"),
    }
}
