#[allow(dead_code)]
#[derive(Debug)]
pub struct RequestIdSource {
    next_id: u64,
}

impl RequestIdSource {
    #[allow(dead_code)]
    pub fn new() -> Self {
        Self { next_id: 1 }
    }

    #[allow(dead_code)]
    pub fn next(&mut self) -> u64 {
        let current = self.next_id;
        self.next_id += 1;
        current
    }
}

impl Default for RequestIdSource {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::RequestIdSource;

    #[test]
    fn request_ids_are_monotonic() {
        let mut ids = RequestIdSource::new();
        assert_eq!(ids.next(), 1);
        assert_eq!(ids.next(), 2);
        assert_eq!(ids.next(), 3);
    }

    #[test]
    fn default_starts_from_one() {
        let mut ids = RequestIdSource::default();
        assert_eq!(ids.next(), 1);
    }
}
