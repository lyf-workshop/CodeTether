use serde::Serialize;

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum AppState {
    Starting,
    Ready,
    Quitting,
    Failed,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum WindowState {
    Visible,
    Minimized,
    Hidden,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum SystemState {
    Active,
    Suspending,
    Suspended,
    Resuming,
    SessionEnding,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum RuntimeState {
    HostReady,
    Reconnecting,
    Unavailable,
    ShuttingDown,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum SessionState {
    Unlocked,
    Locked,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum MainWindowCloseAction {
    Hide,
    Prevent,
    Allow,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum ResumeDecision {
    Ignored,
    StartupDeferred,
    Reconcile(u64),
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LifecycleSnapshot {
    pub(crate) app: AppState,
    pub(crate) window: WindowState,
    pub(crate) system: SystemState,
    pub(crate) runtime: RuntimeState,
    pub(crate) session: SessionState,
}

#[derive(Debug)]
pub(crate) struct DesktopLifecycle {
    snapshot: LifecycleSnapshot,
    shutdown_claimed: bool,
    exit_allowed: bool,
    resume_checked_for_cycle: bool,
    resume_generation: u64,
    active_resume: Option<u64>,
    system_before_session_end: Option<SystemState>,
}

impl DesktopLifecycle {
    pub(crate) fn new() -> Self {
        Self {
            snapshot: LifecycleSnapshot {
                app: AppState::Starting,
                window: WindowState::Hidden,
                system: SystemState::Active,
                runtime: RuntimeState::Reconnecting,
                session: SessionState::Unlocked,
            },
            shutdown_claimed: false,
            exit_allowed: false,
            resume_checked_for_cycle: true,
            resume_generation: 0,
            active_resume: None,
            system_before_session_end: None,
        }
    }

    pub(crate) fn snapshot(&self) -> LifecycleSnapshot {
        self.snapshot
    }

    pub(crate) fn mark_ready(&mut self) {
        if !self.shutdown_claimed {
            self.snapshot.app = AppState::Ready;
            self.snapshot.runtime = RuntimeState::HostReady;
        }
    }

    pub(crate) fn is_ready(&self) -> bool {
        self.snapshot.app == AppState::Ready && !self.shutdown_claimed
    }

    pub(crate) fn is_shutting_down(&self) -> bool {
        self.shutdown_claimed
    }

    pub(crate) fn begin_shutdown(&mut self) -> bool {
        if self.shutdown_claimed {
            return false;
        }
        self.shutdown_claimed = true;
        self.snapshot.app = AppState::Quitting;
        self.snapshot.runtime = RuntimeState::ShuttingDown;
        true
    }

    pub(crate) fn begin_failure_shutdown(&mut self) -> bool {
        if self.shutdown_claimed {
            return false;
        }
        self.shutdown_claimed = true;
        self.snapshot.app = AppState::Failed;
        self.snapshot.runtime = RuntimeState::Unavailable;
        true
    }

    pub(crate) fn allow_exit(&mut self) {
        self.exit_allowed = true;
    }

    pub(crate) fn should_prevent_exit(&self) -> bool {
        !self.exit_allowed
    }

    pub(crate) fn can_restore_main_window(&self) -> bool {
        self.is_ready() && self.snapshot.system != SystemState::SessionEnding
    }

    pub(crate) fn main_window_close_action(&self) -> MainWindowCloseAction {
        if self.exit_allowed || self.snapshot.system == SystemState::SessionEnding {
            return MainWindowCloseAction::Allow;
        }
        if self.shutdown_claimed {
            return MainWindowCloseAction::Prevent;
        }
        MainWindowCloseAction::Hide
    }

    pub(crate) fn mark_window_visible(&mut self) {
        self.snapshot.window = WindowState::Visible;
    }

    pub(crate) fn mark_window_minimized(&mut self) {
        self.snapshot.window = WindowState::Minimized;
    }

    pub(crate) fn mark_window_hidden(&mut self) {
        self.snapshot.window = WindowState::Hidden;
    }

    pub(crate) fn begin_suspend(&mut self) {
        if self.snapshot.system != SystemState::SessionEnding && !self.shutdown_claimed {
            self.snapshot.system = SystemState::Suspending;
            self.resume_checked_for_cycle = false;
            self.active_resume = None;
        }
    }

    pub(crate) fn mark_suspended(&mut self) {
        if self.snapshot.system != SystemState::SessionEnding && !self.shutdown_claimed {
            self.snapshot.system = SystemState::Suspended;
            self.resume_checked_for_cycle = false;
            self.active_resume = None;
        }
    }

    pub(crate) fn begin_resume(&mut self) -> ResumeDecision {
        if self.snapshot.system == SystemState::SessionEnding || self.shutdown_claimed {
            return ResumeDecision::Ignored;
        }
        if self.snapshot.app == AppState::Starting {
            // Startup owns its own bounded readiness validation and has not
            // published an epoch yet. A wake here only ends the power cycle;
            // it must not spawn or fail a second Host health path.
            self.snapshot.system = SystemState::Active;
            self.resume_checked_for_cycle = true;
            self.active_resume = None;
            return ResumeDecision::StartupDeferred;
        }
        if self.resume_checked_for_cycle {
            return ResumeDecision::Ignored;
        }
        self.resume_checked_for_cycle = true;
        self.resume_generation = self.resume_generation.wrapping_add(1);
        let generation = self.resume_generation;
        self.active_resume = Some(generation);
        self.snapshot.system = SystemState::Resuming;
        self.snapshot.runtime = RuntimeState::Reconnecting;
        ResumeDecision::Reconcile(generation)
    }

    pub(crate) fn finish_resume(&mut self, generation: u64, healthy: bool) -> bool {
        let finishing_behind_session_query = self.snapshot.system == SystemState::SessionEnding
            && self.system_before_session_end == Some(SystemState::Resuming);
        if (self.snapshot.system != SystemState::Resuming && !finishing_behind_session_query)
            || self.shutdown_claimed
            || self.active_resume != Some(generation)
        {
            return false;
        }
        self.active_resume = None;
        self.snapshot.runtime = if healthy {
            RuntimeState::HostReady
        } else {
            RuntimeState::Unavailable
        };
        if finishing_behind_session_query {
            // QUERY can still be cancelled. Consume the completed worker now
            // while retaining the session-ending guard, then restore Active
            // rather than a workerless Resuming state on END(FALSE).
            self.system_before_session_end = Some(SystemState::Active);
        } else {
            self.snapshot.system = SystemState::Active;
        }
        true
    }

    pub(crate) fn mark_session_locked(&mut self, locked: bool) {
        if self.snapshot.system != SystemState::SessionEnding && !self.shutdown_claimed {
            self.snapshot.session = if locked {
                SessionState::Locked
            } else {
                SessionState::Unlocked
            };
        }
    }

    pub(crate) fn query_session_end(&mut self) -> bool {
        let changed = self.snapshot.system != SystemState::SessionEnding;
        if changed {
            self.system_before_session_end = Some(self.snapshot.system);
        }
        self.snapshot.system = SystemState::SessionEnding;
        changed
    }

    pub(crate) fn cancel_session_end(&mut self) -> bool {
        if self.snapshot.system != SystemState::SessionEnding || self.shutdown_claimed {
            return false;
        }
        self.snapshot.system = self
            .system_before_session_end
            .take()
            .unwrap_or(SystemState::Active);
        true
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn lifecycle_models_app_window_system_and_runtime_independently() {
        let mut lifecycle = DesktopLifecycle::new();
        assert_eq!(lifecycle.snapshot().app, AppState::Starting);
        assert_eq!(lifecycle.snapshot().window, WindowState::Hidden);
        assert_eq!(lifecycle.snapshot().system, SystemState::Active);
        assert_eq!(lifecycle.snapshot().runtime, RuntimeState::Reconnecting);

        lifecycle.mark_ready();
        lifecycle.mark_window_visible();
        assert_eq!(lifecycle.snapshot().app, AppState::Ready);
        assert_eq!(lifecycle.snapshot().window, WindowState::Visible);
        assert_eq!(lifecycle.snapshot().runtime, RuntimeState::HostReady);
    }

    #[test]
    fn one_suspend_cycle_requests_exactly_one_resume_reconciliation() {
        let mut lifecycle = DesktopLifecycle::new();
        lifecycle.mark_ready();
        lifecycle.begin_suspend();
        lifecycle.mark_suspended();
        let ResumeDecision::Reconcile(generation) = lifecycle.begin_resume() else {
            panic!("a suspended ready lifecycle must reconcile")
        };
        assert_eq!(lifecycle.begin_resume(), ResumeDecision::Ignored);
        assert!(lifecycle.finish_resume(generation, true));
        assert_eq!(lifecycle.snapshot().system, SystemState::Active);
        assert_eq!(lifecycle.snapshot().runtime, RuntimeState::HostReady);
    }

    #[test]
    fn resume_is_ignored_while_quitting() {
        let mut lifecycle = DesktopLifecycle::new();
        lifecycle.mark_ready();
        lifecycle.mark_suspended();
        assert!(lifecycle.begin_shutdown());
        assert_eq!(lifecycle.begin_resume(), ResumeDecision::Ignored);
        assert_eq!(lifecycle.snapshot().app, AppState::Quitting);
        assert_eq!(lifecycle.snapshot().runtime, RuntimeState::ShuttingDown);
    }

    #[test]
    fn resume_during_startup_defers_to_the_existing_readiness_worker() {
        let mut lifecycle = DesktopLifecycle::new();
        lifecycle.mark_suspended();
        assert_eq!(lifecycle.begin_resume(), ResumeDecision::StartupDeferred);
        assert_eq!(lifecycle.snapshot().app, AppState::Starting);
        assert_eq!(lifecycle.snapshot().system, SystemState::Active);
        assert_eq!(lifecycle.snapshot().runtime, RuntimeState::Reconnecting);

        lifecycle.mark_ready();
        assert_eq!(lifecycle.snapshot().app, AppState::Ready);
        assert_eq!(lifecycle.snapshot().runtime, RuntimeState::HostReady);
    }

    #[test]
    fn session_query_allows_windows_close_and_cancellation_restores_normal_close() {
        let mut lifecycle = DesktopLifecycle::new();
        lifecycle.mark_ready();
        lifecycle.mark_window_hidden();
        assert!(lifecycle.query_session_end());
        assert_eq!(
            lifecycle.main_window_close_action(),
            MainWindowCloseAction::Allow
        );
        assert!(lifecycle.cancel_session_end());
        assert_eq!(lifecycle.snapshot().system, SystemState::Active);
        assert_eq!(
            lifecycle.main_window_close_action(),
            MainWindowCloseAction::Hide
        );
    }

    #[test]
    fn duplicate_session_query_preserves_the_pre_query_system_state() {
        let mut lifecycle = DesktopLifecycle::new();
        lifecycle.mark_ready();
        lifecycle.mark_suspended();
        assert!(lifecycle.query_session_end());
        assert!(!lifecycle.query_session_end());
        assert!(lifecycle.cancel_session_end());
        assert_eq!(lifecycle.snapshot().system, SystemState::Suspended);
    }

    #[test]
    fn confirmed_quit_cannot_be_rolled_back_by_a_late_session_cancel() {
        let mut lifecycle = DesktopLifecycle::new();
        lifecycle.mark_ready();
        lifecycle.query_session_end();
        assert!(lifecycle.begin_shutdown());
        assert!(!lifecycle.cancel_session_end());
        assert_eq!(lifecycle.snapshot().app, AppState::Quitting);
        assert_eq!(lifecycle.snapshot().system, SystemState::SessionEnding);
    }

    #[test]
    fn resume_completion_during_session_query_survives_session_cancellation() {
        let mut lifecycle = DesktopLifecycle::new();
        lifecycle.mark_ready();
        lifecycle.mark_suspended();
        let ResumeDecision::Reconcile(generation) = lifecycle.begin_resume() else {
            panic!("a suspended ready lifecycle must reconcile")
        };
        lifecycle.query_session_end();

        assert!(lifecycle.finish_resume(generation, true));
        assert_eq!(lifecycle.snapshot().system, SystemState::SessionEnding);
        assert_eq!(lifecycle.snapshot().runtime, RuntimeState::HostReady);
        assert!(lifecycle.cancel_session_end());
        assert_eq!(lifecycle.snapshot().system, SystemState::Active);
        assert_eq!(lifecycle.snapshot().runtime, RuntimeState::HostReady);
    }

    #[test]
    fn failure_has_precedence_over_duplicate_quit_and_resume() {
        let mut lifecycle = DesktopLifecycle::new();
        lifecycle.mark_ready();
        lifecycle.mark_suspended();
        assert!(lifecycle.begin_failure_shutdown());
        assert!(!lifecycle.begin_shutdown());
        assert_eq!(lifecycle.begin_resume(), ResumeDecision::Ignored);
        assert_eq!(lifecycle.snapshot().app, AppState::Failed);
        assert_eq!(lifecycle.snapshot().runtime, RuntimeState::Unavailable);
    }

    #[test]
    fn lock_and_unlock_do_not_change_runtime_or_window_state() {
        let mut lifecycle = DesktopLifecycle::new();
        lifecycle.mark_ready();
        lifecycle.mark_window_minimized();
        lifecycle.mark_session_locked(true);
        assert_eq!(lifecycle.snapshot().session, SessionState::Locked);
        assert_eq!(lifecycle.snapshot().window, WindowState::Minimized);
        assert_eq!(lifecycle.snapshot().runtime, RuntimeState::HostReady);
        lifecycle.mark_session_locked(false);
        assert_eq!(lifecycle.snapshot().session, SessionState::Unlocked);
    }

    #[test]
    fn stale_resume_completion_cannot_overwrite_a_new_cycle() {
        let mut lifecycle = DesktopLifecycle::new();
        lifecycle.mark_ready();
        lifecycle.mark_suspended();
        let ResumeDecision::Reconcile(first) = lifecycle.begin_resume() else {
            panic!("the first cycle must reconcile")
        };
        lifecycle.mark_suspended();
        let ResumeDecision::Reconcile(second) = lifecycle.begin_resume() else {
            panic!("the second cycle must reconcile")
        };
        assert!(!lifecycle.finish_resume(first, false));
        assert!(lifecycle.finish_resume(second, true));
        assert_eq!(lifecycle.snapshot().runtime, RuntimeState::HostReady);
    }
}
