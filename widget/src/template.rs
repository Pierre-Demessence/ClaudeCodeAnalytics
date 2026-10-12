//! Fills `widget.svg` from a readout: the look is in the file, the values here.

use crate::view::{Readout, RowReadout};

/// Width of the bars in the template, in logical pixels.
const BAR_WIDTH: f64 = 64.0;

struct Palette {
    text: &'static str,
    accent: &'static str,
    limit: &'static str,
}

const LIGHT: Palette = Palette {
    text: "#1a1a1a",
    accent: "#1f6feb",
    limit: "#d9480f",
};
const DARK: Palette = Palette {
    text: "#ffffff",
    accent: "#58a6ff",
    limit: "#ff922b",
};

fn escape(text: &str) -> String {
    text.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
}

fn fill(template: &str, values: &[(String, String)]) -> String {
    values.iter().fold(template.to_string(), |svg, (key, value)| {
        svg.replace(&format!("{{{{{key}}}}}"), &escape(value))
    })
}

fn row_values(index: usize, row: &RowReadout, palette: &Palette) -> Vec<(String, String)> {
    let key = |name: &str| format!("{name}_{}", index + 1);
    vec![
        (key("fill"), format!("{:.2}", BAR_WIDTH * row.fill / 100.0)),
        (
            key("paint"),
            if row.at_limit { "url(#hatch)" } else { palette.accent }.to_string(),
        ),
        (key("weight"), if row.at_limit { "700" } else { "400" }.to_string()),
        (key("percent"), row.percent.clone()),
        (key("reset"), row.reset.clone()),
    ]
}

/// The SVG of the widget for a readout, in the colors of the taskbar's theme.
pub fn svg(template: &str, readout: &Readout, dark: bool) -> String {
    let palette = if dark { &DARK } else { &LIGHT };
    let mut values = vec![
        ("text".to_string(), palette.text.to_string()),
        ("accent".to_string(), palette.accent.to_string()),
        ("limit".to_string(), palette.limit.to_string()),
        (
            "rows_opacity".to_string(),
            if readout.offline { "0.55" } else { "1" }.to_string(),
        ),
        (
            "offline_opacity".to_string(),
            if readout.offline { "1" } else { "0" }.to_string(),
        ),
    ];
    for (index, row) in readout.rows.iter().enumerate() {
        values.extend(row_values(index, row, palette));
    }
    fill(template, &values)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::view::{readout, State, WidgetRow, WidgetView};

    const TEMPLATE: &str = include_str!("../widget.svg");

    fn state(percent: f64, offline: bool) -> State {
        let row = WidgetRow {
            estimated: false,
            limit: 95.0,
            percent: Some(percent),
            resets_at_ms: Some(2 * 3_600_000),
        };
        State {
            offline,
            view: Some(WidgetView {
                five_hour: row.clone(),
                weekly: row,
            }),
        }
    }

    #[test]
    fn leaves_no_placeholder_behind() {
        for dark in [false, true] {
            for state in [state(42.0, false), state(100.0, true), State::default()] {
                let out = svg(TEMPLATE, &readout(&state, 0), dark);
                assert!(!out.contains("{{"), "left over: {out}");
            }
        }
    }

    #[test]
    fn sizes_the_fill_by_the_percent_of_the_bar() {
        let out = svg(TEMPLATE, &readout(&state(50.0, false), 0), false);
        assert!(out.contains(r##"width="32.00" height="9" rx="2" fill="#1f6feb""##));
    }

    #[test]
    fn hatches_and_bolds_a_window_at_its_limit() {
        let out = svg(TEMPLATE, &readout(&state(96.0, false), 0), false);
        assert!(out.contains(r#"fill="url(#hatch)""#));
        assert!(out.contains(r#"font-weight="700""#));
        let out = svg(TEMPLATE, &readout(&state(42.0, false), 0), false);
        assert!(!out.contains(r#"fill="url(#hatch)""#));
        assert!(!out.contains(r#"font-weight="700""#));
    }

    #[test]
    fn dims_the_rows_and_shows_the_icon_only_when_offline() {
        let online = svg(TEMPLATE, &readout(&state(42.0, false), 0), false);
        assert!(online.contains(r#"opacity="1">"#));
        assert!(online.contains(r#"<g opacity="0" transform"#));
        let offline = svg(TEMPLATE, &readout(&state(42.0, true), 0), false);
        assert!(offline.contains(r#"opacity="0.55">"#));
        assert!(offline.contains(r#"<g opacity="1" transform"#));
    }

    #[test]
    fn follows_the_taskbar_theme() {
        let readout = readout(&state(42.0, false), 0);
        assert!(svg(TEMPLATE, &readout, true).contains("#ffffff"));
        assert!(svg(TEMPLATE, &readout, false).contains("#1a1a1a"));
    }

    #[test]
    fn escapes_the_texts_it_puts_in_the_markup() {
        let out = svg(TEMPLATE, &readout(&state(42.0, false), 3 * 3_600_000), false);
        assert!(out.contains("&lt;1m"), "a reset in the past reads <1m");
        assert!(!out.contains("<1m"));
    }
}
