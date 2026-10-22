//! Trading hours of the exchange (EIX, https://european-investor-exchange.com/de/handelszeiten):
//! Monday to Friday, 06:00 to 23:00 Europe/Berlin time, except on its trading calendar days: closed
//! on 1 January, Good Friday, Easter Monday, 1 May, 15 August, 3 October, 31 October, 1 November and
//! 24, 25, 26 and 31 December; from 07:30 on 6 January, Rosenmontag, Ascension, Whit Monday and
//! Corpus Christi; until 14:00 on 30 December.

use std::time::{SystemTime, UNIX_EPOCH};

const OPENS: i64 = 6 * 60;
const LATE_OPENS: i64 = 7 * 60 + 30;
const CLOSES: i64 = 23 * 60;
const SHORT_CLOSES: i64 = 14 * 60;

/// Days since 1970-01-01 of a civil date (proleptic Gregorian).
fn days_from_civil(year: i64, month: i64, day: i64) -> i64 {
    let year = if month <= 2 { year - 1 } else { year };
    let era = year.div_euclid(400);
    let year_of_era = year - era * 400;
    let day_of_year = (153 * (month + if month > 2 { -3 } else { 9 }) + 2) / 5 + day - 1;
    let day_of_era = year_of_era * 365 + year_of_era / 4 - year_of_era / 100 + day_of_year;
    era * 146_097 + day_of_era - 719_468
}

/// The calendar year, month and day of a day count since 1970-01-01.
fn civil_from_days(days: i64) -> (i64, i64, i64) {
    let shifted = days + 719_468;
    let era = shifted.div_euclid(146_097);
    let day_of_era = shifted - era * 146_097;
    let year_of_era =
        (day_of_era - day_of_era / 1460 + day_of_era / 36_524 - day_of_era / 146_096) / 365;
    let day_of_year = day_of_era - (365 * year_of_era + year_of_era / 4 - year_of_era / 100);
    let month_index = (5 * day_of_year + 2) / 153;
    let month = if month_index < 10 {
        month_index + 3
    } else {
        month_index - 9
    };
    let day = day_of_year - (153 * month_index + 2) / 5 + 1;
    (year_of_era + era * 400 + i64::from(month <= 2), month, day)
}

/// Easter Sunday as a day count (anonymous Gregorian algorithm).
fn easter_sunday(year: i64) -> i64 {
    let a = year % 19;
    let b = year / 100;
    let c = year % 100;
    let d = b / 4;
    let e = b % 4;
    let f = (b + 8) / 25;
    let g = (b - f + 1) / 3;
    let h = (19 * a + b - d - g + 15) % 30;
    let i = c / 4;
    let k = c % 4;
    let l = (32 + 2 * e + 2 * i - h - k) % 7;
    let m = (a + 11 * h + 22 * l) / 451;
    let month = (h + l - 7 * m + 114) / 31;
    let day = (h + l - 7 * m + 114) % 31 + 1;
    days_from_civil(year, month, day)
}

/// The trading window of a day as minutes since midnight, or `None` when the exchange is closed.
fn trading_window(days: i64) -> Option<(i64, i64)> {
    if weekday(days) >= 5 {
        return None;
    }
    let (year, month, day) = civil_from_days(days);
    let easter = easter_sunday(year);
    let closed = matches!(
        (month, day),
        (1, 1) | (5, 1) | (8, 15) | (10, 3) | (10, 31) | (11, 1) | (12, 24 | 25 | 26 | 31)
    ) || days == easter - 2
        || days == easter + 1;
    if closed {
        return None;
    }
    let late = (month, day) == (1, 6)
        || [-48, 39, 50, 60]
            .iter()
            .any(|offset| days == easter + offset);
    let opens = if late { LATE_OPENS } else { OPENS };
    let closes = if (month, day) == (12, 30) {
        SHORT_CLOSES
    } else {
        CLOSES
    };
    Some((opens, closes))
}

/// 1970-01-01 was a Thursday; 0 is Monday.
fn weekday(days: i64) -> i64 {
    (days + 3).rem_euclid(7)
}

/// The UTC second of 01:00 UTC on the last Sunday of `month` (EU summer time changes).
fn last_sunday_switch(year: i64, month: i64) -> i64 {
    let last_day = days_from_civil(year, month, 31);
    (last_day - (weekday(last_day) + 1).rem_euclid(7)) * 86_400 + 3_600
}

fn berlin_offset_seconds(unix: i64) -> i64 {
    let (year, _, _) = civil_from_days(unix.div_euclid(86_400));
    let summer = unix >= last_sunday_switch(year, 3) && unix < last_sunday_switch(year, 10);
    if summer {
        7_200
    } else {
        3_600
    }
}

/// Whether the exchange is open at `unix` seconds since the epoch.
fn is_open_at(unix: i64) -> bool {
    let local = unix + berlin_offset_seconds(unix);
    let minute = local.rem_euclid(86_400) / 60;
    trading_window(local.div_euclid(86_400))
        .is_some_and(|(opens, closes)| (opens..closes).contains(&minute))
}

/// Whether the exchange is open right now. Tests that need the gate on run at any hour.
pub(super) fn exchange_open() -> bool {
    if cfg!(test) {
        return true;
    }
    let seconds = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |elapsed| elapsed.as_secs());
    is_open_at(i64::try_from(seconds).unwrap_or(0))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn at(year: i64, month: i64, day: i64, hour: i64, minute: i64) -> i64 {
        days_from_civil(year, month, day) * 86_400 + hour * 3_600 + minute * 60
    }

    #[test]
    fn open_from_six_to_before_eleven_berlin_time_on_weekdays() {
        // Thursday 22 October 2026 is summer time (UTC+2).
        assert!(!is_open_at(at(2026, 10, 22, 3, 59)));
        assert!(is_open_at(at(2026, 10, 22, 4, 0)));
        assert!(is_open_at(at(2026, 10, 22, 20, 59)));
        assert!(!is_open_at(at(2026, 10, 22, 21, 0)));
        // Winter time (UTC+1).
        assert!(!is_open_at(at(2026, 12, 3, 4, 59)));
        assert!(is_open_at(at(2026, 12, 3, 5, 0)));
        assert!(is_open_at(at(2026, 12, 3, 21, 59)));
        assert!(!is_open_at(at(2026, 12, 3, 22, 0)));
    }

    #[test]
    fn closed_on_weekends() {
        assert!(!is_open_at(at(2026, 10, 24, 12, 0)));
        assert!(!is_open_at(at(2026, 10, 25, 12, 0)));
        assert!(is_open_at(at(2026, 10, 26, 12, 0)));
        assert!(!is_open_at(at(2026, 10, 23, 21, 30)));
    }

    #[test]
    fn follows_the_trading_calendar() {
        // Easter Sunday 2026 is 5 April.
        assert!(!is_open_at(at(2026, 4, 3, 12, 0)));
        assert!(!is_open_at(at(2026, 4, 6, 12, 0)));
        assert!(is_open_at(at(2026, 4, 7, 12, 0)));
        assert!(!is_open_at(at(2026, 1, 1, 12, 0)));
        assert!(!is_open_at(at(2026, 5, 1, 12, 0)));
        assert!(!is_open_at(at(2026, 12, 24, 12, 0)));
        assert!(!is_open_at(at(2026, 12, 31, 12, 0)));
        assert!(is_open_at(at(2026, 12, 23, 12, 0)));
        // Late opening at 07:30 Berlin time: 6 January, Rosenmontag, Ascension, Whit Monday, Corpus Christi.
        for (month, day) in [(1, 6), (2, 16), (5, 14), (5, 25), (6, 4)] {
            let offset = if month == 1 || month == 2 { 1 } else { 2 };
            assert!(
                !is_open_at(at(2026, month, day, 7 - offset, 29)),
                "{month}-{day}"
            );
            assert!(
                is_open_at(at(2026, month, day, 7 - offset, 30)),
                "{month}-{day}"
            );
        }
        // 30 December closes at 14:00.
        assert!(is_open_at(at(2026, 12, 30, 12, 59)));
        assert!(!is_open_at(at(2026, 12, 30, 13, 0)));
        assert_eq!(civil_from_days(days_from_civil(2028, 2, 29)), (2028, 2, 29));
    }

    #[test]
    fn follows_the_european_summer_time_switches() {
        // 2026: summer time starts Sunday 29 March and ends Sunday 25 October.
        assert_eq!(berlin_offset_seconds(at(2026, 3, 29, 0, 59)), 3_600);
        assert_eq!(berlin_offset_seconds(at(2026, 3, 29, 1, 0)), 7_200);
        assert_eq!(berlin_offset_seconds(at(2026, 10, 25, 0, 59)), 7_200);
        assert_eq!(berlin_offset_seconds(at(2026, 10, 25, 1, 0)), 3_600);
    }
}
