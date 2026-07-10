//! Live-transcription helpers (SPEC3): the pass-interval controller and the
//! capture buffer. Both are pure so R10 can prove the guarantees — snapshots
//! never disturb capture, and slow hardware stretches the cadence instead of
//! breaking recordings.

use std::time::Duration;

pub const BASE_INTERVAL_MS: u64 = 1000;
pub const MAX_INTERVAL_MS: u64 = 4000;
/// A pass costing more than this fraction of the interval stretches it.
const STRETCH_THRESHOLD: f64 = 0.6;
/// A pass costing less than this fraction lets the interval recover.
const RECOVER_THRESHOLD: f64 = 0.3;

/// Adaptive cadence for live passes (SPEC3 FR-L2 perf guard).
#[derive(Debug)]
pub struct LiveInterval {
    current_ms: u64,
    stretched_logged: bool,
}

impl Default for LiveInterval {
    fn default() -> Self {
        Self {
            current_ms: BASE_INTERVAL_MS,
            stretched_logged: false,
        }
    }
}

impl LiveInterval {
    pub fn current(&self) -> Duration {
        Duration::from_millis(self.current_ms)
    }

    /// Feed the duration of a completed pass; adjusts the next interval.
    pub fn on_pass(&mut self, pass: Duration) {
        let pass_ms = pass.as_millis() as f64;
        let current = self.current_ms as f64;
        if pass_ms > current * STRETCH_THRESHOLD {
            let stretched = ((self.current_ms * 3) / 2).min(MAX_INTERVAL_MS);
            if stretched > self.current_ms && !self.stretched_logged {
                log::info!(
                    "live pass took {pass_ms:.0}ms; stretching live interval to {stretched}ms"
                );
                self.stretched_logged = true;
            }
            self.current_ms = stretched;
        } else if pass_ms < current * RECOVER_THRESHOLD {
            self.current_ms = ((self.current_ms * 2) / 3).max(BASE_INTERVAL_MS);
        }
    }
}

/// Accumulates mono samples during a recording. Snapshots are non-destructive
/// (SPEC3 FR-L2: capture must not hiccup); `take` drains for the final pass.
#[derive(Debug, Default)]
pub struct CaptureBuffer {
    samples: Vec<f32>,
}

impl CaptureBuffer {
    pub fn push_chunk(&mut self, chunk: &[f32]) {
        self.samples.extend_from_slice(chunk);
    }

    /// Copy of everything captured so far; capture continues untouched.
    pub fn snapshot(&self) -> Vec<f32> {
        self.samples.clone()
    }

    pub fn take(&mut self) -> Vec<f32> {
        std::mem::take(&mut self.samples)
    }

    pub fn clear(&mut self) {
        self.samples.clear();
    }

    pub fn len(&self) -> usize {
        self.samples.len()
    }

    pub fn is_empty(&self) -> bool {
        self.samples.is_empty()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // R10: interval controller — stretch on slow passes, cap, recovery.
    #[test]
    fn r10_interval_stretches_on_slow_passes() {
        let mut interval = LiveInterval::default();
        assert_eq!(interval.current(), Duration::from_millis(1000));
        interval.on_pass(Duration::from_millis(700)); // > 60% of 1000
        assert_eq!(interval.current(), Duration::from_millis(1500));
        interval.on_pass(Duration::from_millis(1200));
        assert_eq!(interval.current(), Duration::from_millis(2250));
    }

    #[test]
    fn r10_interval_caps_at_four_seconds() {
        let mut interval = LiveInterval::default();
        for _ in 0..10 {
            interval.on_pass(Duration::from_millis(10_000));
        }
        assert_eq!(interval.current(), Duration::from_millis(MAX_INTERVAL_MS));
    }

    #[test]
    fn r10_interval_recovers_when_passes_get_fast() {
        let mut interval = LiveInterval::default();
        for _ in 0..10 {
            interval.on_pass(Duration::from_millis(10_000));
        }
        for _ in 0..20 {
            interval.on_pass(Duration::from_millis(100)); // < 30% of anything ≥ 1000
        }
        assert_eq!(interval.current(), Duration::from_millis(BASE_INTERVAL_MS));
    }

    #[test]
    fn r10_interval_stable_in_the_comfortable_band() {
        let mut interval = LiveInterval::default();
        interval.on_pass(Duration::from_millis(450)); // between 30% and 60%
        assert_eq!(interval.current(), Duration::from_millis(1000));
    }

    // R10: snapshots never disturb capture — snapshot twice, second is longer.
    #[test]
    fn r10_snapshot_is_non_destructive_and_capture_continues() {
        let mut buffer = CaptureBuffer::default();
        buffer.push_chunk(&[0.1, 0.2, 0.3]);
        let first = buffer.snapshot();
        assert_eq!(first.len(), 3);

        buffer.push_chunk(&[0.4, 0.5]);
        let second = buffer.snapshot();
        assert_eq!(second.len(), 5, "capture continued after snapshot");
        assert_eq!(second[..3], first[..], "earlier audio unchanged");

        let taken = buffer.take();
        assert_eq!(taken.len(), 5);
        assert!(buffer.is_empty(), "take drains for the final pass");
    }
}
