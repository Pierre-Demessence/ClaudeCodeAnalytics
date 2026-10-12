//! Where the widget's SVG comes from: embedded in the exe, or, in a debug build,
//! read from the file again at every redraw, so saving it redraws the widget.

use std::time::SystemTime;

pub const EMBEDDED: &str = include_str!("../widget.svg");

#[cfg(debug_assertions)]
const FILE: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/widget.svg");

#[cfg(debug_assertions)]
pub fn current() -> String {
    std::fs::read_to_string(FILE).unwrap_or_else(|_| EMBEDDED.to_string())
}

#[cfg(debug_assertions)]
pub fn modified() -> Option<SystemTime> {
    std::fs::metadata(FILE).and_then(|meta| meta.modified()).ok()
}

#[cfg(not(debug_assertions))]
pub fn current() -> String {
    EMBEDDED.to_string()
}

#[cfg(not(debug_assertions))]
pub fn modified() -> Option<SystemTime> {
    None
}
