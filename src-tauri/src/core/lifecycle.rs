#[allow(dead_code)]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LifecycleState {
    Starting,
    Recovering,
    Initialized,
    Stopped,
}

impl LifecycleState {
    #[allow(dead_code)]
    pub fn allows_requests(self) -> bool {
        matches!(self, Self::Initialized)
    }
}

#[cfg(test)]
mod tests {
    use super::LifecycleState;

    #[test]
    fn initialized_state_allows_requests() {
        assert!(LifecycleState::Initialized.allows_requests());
    }

    #[test]
    fn non_initialized_states_block_requests() {
        assert!(!LifecycleState::Starting.allows_requests());
        assert!(!LifecycleState::Recovering.allows_requests());
        assert!(!LifecycleState::Stopped.allows_requests());
    }
}
