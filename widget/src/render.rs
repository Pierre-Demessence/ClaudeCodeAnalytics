//! Draws the widget's SVG into the pixels of a layered window.
//!
//! `resvg` renders on the CPU, with real transparency and antialiased text, which
//! is what a layered window takes; no GPU, no webview.

use std::path::PathBuf;
use std::sync::{Arc, OnceLock};

use resvg::{tiny_skia, usvg};

/// Size of the template in logical pixels; the window is scaled by the display's DPI.
pub const LOGICAL_WIDTH: f32 = 200.0;
pub const LOGICAL_HEIGHT: f32 = 48.0;

/// Segoe UI Variable is the font of Windows 11; Segoe UI is older and always there.
const FONT_FILES: [&str; 3] = ["SegUIVar.ttf", "segoeui.ttf", "segoeuib.ttf"];

/// Premultiplied BGRA rows, top to bottom: what `UpdateLayeredWindow` takes.
pub struct Frame {
    pub bgra: Vec<u8>,
    pub height: u32,
    pub width: u32,
}

/// Only the fonts the template names, instead of every font of the system: scanning
/// them all costs memory for a readout that uses two.
fn fonts() -> Arc<usvg::fontdb::Database> {
    static FONTS: OnceLock<Arc<usvg::fontdb::Database>> = OnceLock::new();
    FONTS
        .get_or_init(|| {
            let mut database = usvg::fontdb::Database::new();
            let windows = std::env::var_os("WINDIR").map_or_else(|| PathBuf::from(r"C:\Windows"), PathBuf::from);
            for file in FONT_FILES {
                if let Err(error) = database.load_font_file(windows.join("Fonts").join(file)) {
                    eprintln!("cannot load the font {file}: {error}");
                }
            }
            Arc::new(database)
        })
        .clone()
}

fn tree(svg: &str) -> Result<usvg::Tree, String> {
    let options = usvg::Options {
        fontdb: fonts(),
        ..usvg::Options::default()
    };
    usvg::Tree::from_str(svg, &options).map_err(|error| error.to_string())
}

fn draw(svg: &str, width: u32, height: u32) -> Result<tiny_skia::Pixmap, String> {
    let tree = tree(svg)?;
    let mut pixmap = tiny_skia::Pixmap::new(width, height).ok_or("empty window")?;
    let scale = width as f32 / LOGICAL_WIDTH;
    // The taskbar is taller or shorter than the template depending on its size: center it.
    let top = (height as f32 - LOGICAL_HEIGHT * scale) / 2.0;
    resvg::render(
        &tree,
        tiny_skia::Transform::from_scale(scale, scale).post_translate(0.0, top),
        &mut pixmap.as_mut(),
    );
    Ok(pixmap)
}

pub fn render(svg: &str, width: u32, height: u32) -> Result<Frame, String> {
    let mut bgra = draw(svg, width, height)?.take();
    for pixel in bgra.as_chunks_mut::<4>().0 {
        pixel.swap(0, 2);
    }
    Ok(Frame { bgra, height, width })
}

#[cfg(test)]
mod tests {
    use std::fs;
    use std::path::Path;

    use super::*;
    use crate::template;
    use crate::view::{readout, State, WidgetRow, WidgetView};

    const TEMPLATE: &str = include_str!("../widget.svg");
    const NOW: i64 = 1_791_817_200_000;
    const HOUR: i64 = 3_600_000;

    fn row(percent: f64, limit: f64, estimated: bool, resets_in: i64) -> WidgetRow {
        WidgetRow {
            estimated,
            limit,
            none: false,
            percent: Some(percent),
            resets_at_ms: Some(NOW + resets_in),
        }
    }

    fn normal() -> State {
        State {
            offline: false,
            view: Some(WidgetView {
                five_hour: row(42.0, 95.0, false, 2 * HOUR + 59 * 60_000),
                weekly: row(7.0, 98.0, false, 53 * HOUR),
            }),
        }
    }

    fn at_limit() -> State {
        State {
            offline: false,
            view: Some(WidgetView {
                five_hour: row(96.0, 95.0, true, 45 * 60_000),
                weekly: row(61.5, 98.0, true, 30 * HOUR),
            }),
        }
    }

    fn no_five_hour_limit() -> State {
        let mut state = normal();
        let view = state.view.as_mut().unwrap();
        view.five_hour = WidgetRow {
            estimated: false,
            limit: 95.0,
            none: true,
            percent: None,
            resets_at_ms: None,
        };
        state
    }

    fn offline() -> State {
        State {
            offline: true,
            ..normal()
        }
    }

    fn straight(pixmap: &tiny_skia::Pixmap) -> Vec<u8> {
        pixmap
            .pixels()
            .iter()
            .flat_map(|pixel| {
                let color = pixel.demultiply();
                [color.red(), color.green(), color.blue(), color.alpha()]
            })
            .collect()
    }

    /// Compares a render with `tests/snapshots/<name>.png`, which is written when
    /// `UPDATE_SNAPSHOTS` is set; a missing one fails. The fonts are Windows' own.
    fn check(name: &str, state: &State, dark: bool, width: u32, height: u32) {
        let svg = template::svg(TEMPLATE, &readout(state, NOW), dark);
        let pixmap = draw(&svg, width, height).unwrap();
        let actual = straight(&pixmap);
        let path = Path::new(env!("CARGO_MANIFEST_DIR")).join(format!("tests/snapshots/{name}.png"));

        if std::env::var_os("UPDATE_SNAPSHOTS").is_some() {
            fs::create_dir_all(path.parent().unwrap()).unwrap();
            let file = fs::File::create(&path).unwrap();
            let mut encoder = png::Encoder::new(std::io::BufWriter::new(file), width, height);
            encoder.set_color(png::ColorType::Rgba);
            encoder.set_depth(png::BitDepth::Eight);
            encoder.write_header().unwrap().write_image_data(&actual).unwrap();
            return;
        }

        let file = fs::File::open(&path).unwrap_or_else(|_| panic!("{name}: no snapshot, run with UPDATE_SNAPSHOTS=1"));
        let mut reader = png::Decoder::new(std::io::BufReader::new(file))
            .read_info()
            .unwrap();
        let mut expected = vec![0; reader.output_buffer_size().unwrap()];
        let info = reader.next_frame(&mut expected).unwrap();
        expected.truncate(info.buffer_size());
        assert_eq!((info.width, info.height), (width, height), "{name}: size");
        let different = actual
            .iter()
            .zip(&expected)
            .filter(|(a, b)| a.abs_diff(**b) > 2)
            .count();
        assert_eq!(different, 0, "{name}: {different} channel values differ from {}", path.display());
    }

    #[test]
    fn normal_light() {
        check("normal-light", &normal(), false, 200, 48);
    }

    #[test]
    fn normal_dark() {
        check("normal-dark", &normal(), true, 200, 48);
    }

    #[test]
    fn at_limit_and_estimated_dark() {
        check("limit-dark", &at_limit(), true, 200, 48);
    }

    #[test]
    fn at_limit_and_estimated_light() {
        check("limit-light", &at_limit(), false, 200, 48);
    }

    #[test]
    fn offline_dark() {
        check("offline-dark", &offline(), true, 200, 48);
    }

    #[test]
    fn no_five_hour_limit_light() {
        check("none-light", &no_five_hour_limit(), false, 200, 48);
    }

    #[test]
    fn no_reading_yet_light() {
        let state = State {
            offline: true,
            view: None,
        };
        check("empty-light", &state, false, 200, 48);
    }

    #[test]
    fn scaled_for_a_125_percent_display_in_a_taller_taskbar() {
        check("normal-dark-125", &normal(), true, 250, 64);
    }

    #[test]
    fn leaves_the_pixels_around_the_texts_almost_transparent_but_clickable() {
        let svg = template::svg(TEMPLATE, &readout(&normal(), NOW), true);
        let frame = render(&svg, 200, 48).unwrap();
        let alpha_at = |x: usize, y: usize| frame.bgra[(y * 200 + x) * 4 + 3];
        // The corner holds no text or bar: a fully transparent pixel would let the click through.
        assert!(alpha_at(0, 0) > 0);
        assert!(alpha_at(199, 47) > 0);
    }

    #[test]
    fn a_broken_template_is_an_error() {
        assert!(render("<svg", 200, 48).is_err());
        assert!(render("<html/>", 200, 48).is_err());
    }
}
