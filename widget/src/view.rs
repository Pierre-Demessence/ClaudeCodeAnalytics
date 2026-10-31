//! What the widget shows: the API's answer and the clock turned into the texts,
//! the bar fills and the flags that the template is filled with.

use serde::Deserialize;

const MINUTE_MS: i64 = 60_000;
const HOUR_MS: i64 = 60 * MINUTE_MS;
const DAY_MS: i64 = 24 * HOUR_MS;

/// One window of the answer of `GET /api/widget`; no `percent` means no reading yet.
#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct WidgetRow {
    pub estimated: bool,
    /// % from which the window counts as having hit the limit.
    pub limit: f64,
    /// The account has no such limit: the row reads `none`.
    #[serde(default)]
    pub none: bool,
    pub percent: Option<f64>,
    /// Epoch milliseconds; absent for an idle or unknown window.
    pub resets_at_ms: Option<i64>,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct WidgetView {
    pub five_hour: WidgetRow,
    pub weekly: WidgetRow,
}

/// What the widget last learned from the dashboard.
#[derive(Clone, Debug, Default)]
pub struct State {
    /// The last request failed: the values shown are old.
    pub offline: bool,
    /// The last answer; absent until the API has answered once.
    pub view: Option<WidgetView>,
}

#[derive(Clone, Debug, PartialEq)]
pub struct RowReadout {
    pub label: &'static str,
    /// 0 to 100: how much of the bar is filled.
    pub fill: f64,
    pub at_limit: bool,
    /// `42%`, `~42%` for an estimate, `none` without such a limit, `–` without a reading.
    pub percent: String,
    pub reset: String,
}

#[derive(Clone, Debug, PartialEq)]
pub struct Readout {
    pub offline: bool,
    pub rows: [RowReadout; 2],
}

/// Time left as `2d05h`, `2h59m` or `45m`, rounded down: a bare `2h` would hide
/// whether 2h59 or 2h00 is left.
pub fn format_reset_in(ms: i64) -> String {
    if ms < MINUTE_MS {
        "<1m".to_string()
    } else if ms >= DAY_MS {
        format!("{}d{:02}h", ms / DAY_MS, (ms % DAY_MS) / HOUR_MS)
    } else if ms >= HOUR_MS {
        format!("{}h{:02}m", ms / HOUR_MS, (ms % HOUR_MS) / MINUTE_MS)
    } else {
        format!("{}m", ms / MINUTE_MS)
    }
}

fn row_readout(label: &'static str, row: Option<&WidgetRow>, now_ms: i64) -> RowReadout {
    let percent = row.and_then(|row| row.percent);
    RowReadout {
        label,
        fill: percent.map_or(0.0, |p| p.clamp(0.0, 100.0)),
        at_limit: match (row, percent) {
            (Some(row), Some(p)) => row.limit > 0.0 && p >= row.limit,
            _ => false,
        },
        percent: match (row, percent) {
            (Some(row), _) if row.none => "none".to_string(),
            (Some(row), Some(p)) => format!("{}{}%", if row.estimated { "~" } else { "" }, p.round()),
            _ => "–".to_string(),
        },
        reset: row
            .and_then(|row| row.resets_at_ms)
            .map_or_else(|| "–".to_string(), |at| format_reset_in(at - now_ms)),
    }
}

pub fn readout(state: &State, now_ms: i64) -> Readout {
    let view = state.view.as_ref();
    Readout {
        offline: state.offline,
        rows: [
            row_readout("5h", view.map(|v| &v.five_hour), now_ms),
            row_readout("7d", view.map(|v| &v.weekly), now_ms),
        ],
    }
}

/// The readout in words, for the window's text (screen readers, tooltips of tools).
pub fn describe(readout: &Readout) -> String {
    let rows: Vec<String> = readout
        .rows
        .iter()
        .map(|row| format!("{}: {}, resets in {}", row.label, row.percent, row.reset))
        .collect();
    let mut text = rows.join("; ");
    if readout.offline {
        text.push_str(" (offline)");
    }
    text
}

#[cfg(test)]
mod tests {
    use super::*;

    const NOW: i64 = 1_791_817_200_000;
    const HOUR: i64 = HOUR_MS;

    fn view() -> WidgetView {
        WidgetView {
            five_hour: WidgetRow {
                estimated: false,
                limit: 95.0,
                none: false,
                percent: Some(42.0),
                resets_at_ms: Some(NOW + 2 * HOUR + 59 * MINUTE_MS),
            },
            weekly: WidgetRow {
                estimated: false,
                limit: 98.0,
                none: false,
                percent: Some(7.0),
                resets_at_ms: Some(NOW + 53 * HOUR),
            },
        }
    }

    fn shown(view: WidgetView, offline: bool, now: i64) -> Readout {
        readout(
            &State {
                offline,
                view: Some(view),
            },
            now,
        )
    }

    #[test]
    fn reset_keeps_hours_and_minutes_rounding_down() {
        assert_eq!(format_reset_in(2 * HOUR + 59 * MINUTE_MS + 40_000), "2h59m");
        assert_eq!(format_reset_in(HOUR), "1h00m");
    }

    #[test]
    fn reset_keeps_days_and_hours_from_one_day() {
        assert_eq!(format_reset_in(2 * DAY_MS + 5 * HOUR + 59 * MINUTE_MS), "2d05h");
        assert_eq!(format_reset_in(DAY_MS), "1d00h");
        assert_eq!(format_reset_in(DAY_MS - 1), "23h59m");
    }

    #[test]
    fn reset_shows_minutes_alone_below_an_hour_and_under_a_minute_below_that() {
        assert_eq!(format_reset_in(45 * MINUTE_MS + 59_000), "45m");
        assert_eq!(format_reset_in(MINUTE_MS), "1m");
        assert_eq!(format_reset_in(MINUTE_MS - 1), "<1m");
        assert_eq!(format_reset_in(0), "<1m");
        assert_eq!(format_reset_in(-5 * MINUTE_MS), "<1m");
    }

    #[test]
    fn shows_the_percent_and_the_time_left_of_both_windows() {
        let readout = shown(view(), false, NOW);
        assert_eq!(readout.rows[0].label, "5h");
        assert_eq!(readout.rows[0].percent, "42%");
        assert_eq!(readout.rows[0].reset, "2h59m");
        assert_eq!(readout.rows[1].label, "7d");
        assert_eq!(readout.rows[1].percent, "7%");
        assert_eq!(readout.rows[1].reset, "2d05h");
        assert!(!readout.offline);
    }

    #[test]
    fn fills_the_bar_by_the_percent_within_0_and_100() {
        let mut view = view();
        assert_eq!(shown(view.clone(), false, NOW).rows[0].fill, 42.0);
        view.five_hour.percent = Some(130.0);
        view.weekly.percent = Some(-3.0);
        let readout = shown(view, false, NOW);
        assert_eq!(readout.rows[0].fill, 100.0);
        assert_eq!(readout.rows[1].fill, 0.0);
    }

    #[test]
    fn counts_the_time_down_between_two_fetches() {
        let readout = shown(view(), false, NOW + 30 * MINUTE_MS);
        assert_eq!(readout.rows[0].reset, "2h29m");
    }

    #[test]
    fn prefixes_an_estimate_with_a_tilde() {
        let mut view = view();
        view.weekly.estimated = true;
        view.weekly.percent = Some(61.0);
        assert_eq!(shown(view, false, NOW).rows[1].percent, "~61%");
    }

    #[test]
    fn rounds_the_percent_to_the_nearest_whole_number() {
        let mut view = view();
        view.five_hour.percent = Some(41.5);
        view.weekly.percent = Some(6.4);
        let readout = shown(view, false, NOW);
        assert_eq!(readout.rows[0].percent, "42%");
        assert_eq!(readout.rows[1].percent, "6%");
    }

    #[test]
    fn flags_a_window_at_its_limit() {
        let mut view = view();
        view.five_hour.percent = Some(96.0);
        let readout = shown(view, false, NOW);
        assert!(readout.rows[0].at_limit);
        assert!(!readout.rows[1].at_limit);
    }

    #[test]
    fn a_limit_of_zero_is_never_reached() {
        let mut view = view();
        view.five_hour.limit = 0.0;
        view.five_hour.percent = Some(100.0);
        assert!(!shown(view, false, NOW).rows[0].at_limit);
    }

    #[test]
    fn shows_an_idle_window_as_0_percent_with_a_dash_for_the_reset() {
        let mut view = view();
        view.five_hour.percent = Some(0.0);
        view.five_hour.resets_at_ms = None;
        let readout = shown(view, false, NOW);
        assert_eq!(readout.rows[0].percent, "0%");
        assert_eq!(readout.rows[0].reset, "–");
    }

    #[test]
    fn shows_none_for_a_window_the_account_does_not_have() {
        let mut view = view();
        view.five_hour = WidgetRow {
            none: true,
            percent: None,
            resets_at_ms: None,
            ..view.five_hour
        };
        let readout = shown(view, false, NOW);
        assert_eq!(readout.rows[0].percent, "none");
        assert_eq!(readout.rows[0].reset, "–");
        assert_eq!(readout.rows[0].fill, 0.0);
        assert!(!readout.rows[0].at_limit);
        assert_eq!(readout.rows[1].percent, "7%");
    }

    #[test]
    fn shows_dashes_before_the_api_has_ever_answered_and_flags_it_offline() {
        let readout = readout(
            &State {
                offline: true,
                view: None,
            },
            NOW,
        );
        assert_eq!(readout.rows[0].percent, "–");
        assert_eq!(readout.rows[1].reset, "–");
        assert_eq!(readout.rows[0].fill, 0.0);
        assert!(readout.offline);
    }

    #[test]
    fn keeps_the_last_values_when_it_goes_offline() {
        let readout = shown(view(), true, NOW);
        assert_eq!(readout.rows[0].percent, "42%");
        assert!(readout.offline);
    }

    #[test]
    fn describes_the_readout_in_words() {
        let text = describe(&shown(view(), true, NOW));
        assert_eq!(text, "5h: 42%, resets in 2h59m; 7d: 7%, resets in 2d05h (offline)");
    }

    #[test]
    fn reads_the_answer_of_the_api() {
        let json = r#"{
            "fiveHour": { "estimated": false, "limit": 95, "percent": 42.5, "resetsAtMs": 1791824340000 },
            "generatedAt": "2026-10-12T15:00:00.000Z",
            "weekly": { "estimated": true, "limit": 98 }
        }"#;
        let view: WidgetView = serde_json::from_str(json).unwrap();
        assert_eq!(view.five_hour.percent, Some(42.5));
        assert!(!view.five_hour.none);
        assert_eq!(view.five_hour.resets_at_ms, Some(1_791_824_340_000));
        assert!(view.weekly.estimated);
        assert_eq!(view.weekly.percent, None);
    }

    #[test]
    fn rejects_an_answer_of_the_wrong_shape() {
        assert!(serde_json::from_str::<WidgetView>(r#"{"fiveHour": 1}"#).is_err());
        assert!(serde_json::from_str::<WidgetView>("<html>").is_err());
    }
}
