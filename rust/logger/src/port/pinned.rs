//! The clock and random numbers the original saw while rust-anything recorded it.
//!
//! Written by `rust-anything record --pin-clock`. Declare it with `mod pinned;` in `port.rs`,
//! then call `pinned::now_ms()` where the original reads the clock and `pinned::random()` where
//! it draws a random number. While `record`, `diff`, `fuzz` and `gate` run, the clock is fixed at
//! `RUST_ANYTHING_NOW_MS` (time zone UTC) and the numbers come from mulberry32 seeded with
//! `RUST_ANYTHING_SEED`, restarted at every case (the drivers change `RUST_ANYTHING_CASE` between
//! cases). Without those variables (in production) the real clock and a clock seed are used.
//!
//! The generator, as the drivers run it, on wrapping `u32` arithmetic:
//!
//! ```text
//! state = state + 0x6D2B79F5
//! t = (state ^ (state >> 15)) * (state | 1)
//! t = t ^ (t + (t ^ (t >> 7)) * (t | 61))
//! next_u32 = t ^ (t >> 14)
//! ```
//!
//! JS `Math.random()` and Python `random.random()` are `next_u32() / 2^32`. Python's
//! `getrandbits(k)` is `next_u32() >> (32 - k)` up to 32 bits and fills wider values 32 bits at a
//! time from the low end; `randint`, `choice`, `shuffle` and the other `random` functions are
//! CPython's own on top of those two, drawing indexes with `randbelow`. `random.seed()` does
//! nothing while pinned. `Date.now()`, `new Date()` and `Date()` read `now_ms()`; `time.time()`,
//! `datetime.now()`, `datetime.utcnow()` and `date.today()` read `now_secs()`.

#![allow(dead_code)]

use std::cell::Cell;
use std::time::{SystemTime, UNIX_EPOCH};

thread_local! {
    static STATE: Cell<(Option<u64>, u32, bool)> = const { Cell::new((None, 0, false)) };
}

fn var<T: std::str::FromStr>(name: &str) -> Option<T> {
    std::env::var(name).ok()?.parse().ok()
}

fn real_ms() -> f64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0.0, |d| d.as_secs_f64() * 1000.0)
}

/// Milliseconds since the Unix epoch, like JS `Date.now()`.
pub fn now_ms() -> f64 {
    var::<i64>("RUST_ANYTHING_NOW_MS").map_or_else(|| real_ms().floor(), |ms| ms as f64)
}

/// Seconds since the Unix epoch, like Python `time.time()`.
pub fn now_secs() -> f64 {
    var::<i64>("RUST_ANYTHING_NOW_MS").map_or_else(|| real_ms() / 1000.0, |ms| ms as f64 / 1000.0)
}

/// The next 32 random bits.
pub fn next_u32() -> u32 {
    let seed = var::<u32>("RUST_ANYTHING_SEED");
    let case = var::<u64>("RUST_ANYTHING_CASE");
    STATE.with(|cell| {
        let (last_case, mut state, started) = cell.get();
        if !started || (seed.is_some() && case != last_case) {
            state = seed.unwrap_or_else(|| real_ms().to_bits() as u32);
        }
        state = state.wrapping_add(0x6D2B_79F5);
        let mut t = (state ^ (state >> 15)).wrapping_mul(state | 1);
        t ^= t.wrapping_add((t ^ (t >> 7)).wrapping_mul(t | 61));
        cell.set((case, state, true));
        t ^ (t >> 14)
    })
}

/// A float in `[0, 1)`, like JS `Math.random()` and Python `random.random()`.
pub fn random() -> f64 {
    f64::from(next_u32()) / 4_294_967_296.0
}

/// Python's `random.getrandbits(k)`, for `k` up to 64.
pub fn getrandbits(k: u32) -> u64 {
    assert!(k <= 64, "getrandbits takes at most 64 bits here");
    match k {
        0 => 0,
        1..=32 => u64::from(next_u32() >> (32 - k)),
        _ => {
            let low = u64::from(next_u32());
            low | (u64::from(next_u32() >> (64 - k)) << 32)
        }
    }
}

/// CPython's `Random._randbelow(n)`: an integer in `[0, n)`, as `randint`, `randrange`,
/// `choice` and `shuffle` draw them.
pub fn randbelow(n: u64) -> u64 {
    if n == 0 {
        return 0;
    }
    let k = 64 - n.leading_zeros();
    loop {
        let r = getrandbits(k);
        if r < n {
            return r;
        }
    }
}
