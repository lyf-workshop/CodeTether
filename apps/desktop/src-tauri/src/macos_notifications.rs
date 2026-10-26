use std::{
    collections::{HashMap, VecDeque},
    ptr::NonNull,
    sync::atomic::{AtomicBool, Ordering},
    sync::{Arc, Mutex},
};

use block2::RcBlock;
use objc2::{
    AnyThread, DefinedClass, define_class, msg_send, rc::Retained, runtime::ProtocolObject,
};
use objc2_foundation::{NSError, NSObject, NSObjectProtocol, NSString};
use objc2_user_notifications::{
    UNAuthorizationOptions, UNAuthorizationStatus, UNMutableNotificationContent, UNNotification,
    UNNotificationPresentationOptions, UNNotificationRequest, UNNotificationResponse,
    UNNotificationSettings, UNUserNotificationCenter, UNUserNotificationCenterDelegate,
};
use tauri::{AppHandle, Manager};

use crate::attention_notifications::{
    AttentionNotificationState, AttentionNotificationType, NotificationIntent,
};

const MAX_PENDING_NOTIFICATIONS: usize = 256;
const PERMISSION_DENIED: &str = "macOS notification permission is not granted";

type Completion = Box<dyn FnOnce(Result<(), String>) + Send + 'static>;

fn authorization_result_log(granted: bool, has_error: bool) -> &'static str {
    if has_error {
        "[codetether:desktop] macOS notification authorization result=error"
    } else if granted {
        "[codetether:desktop] macOS notification authorization result=granted"
    } else {
        "[codetether:desktop] macOS notification authorization result=denied"
    }
}

fn authorization_status_log(status: UNAuthorizationStatus) -> String {
    let status = match status {
        UNAuthorizationStatus::NotDetermined => "notDetermined",
        UNAuthorizationStatus::Denied => "denied",
        UNAuthorizationStatus::Authorized => "authorized",
        UNAuthorizationStatus::Provisional => "provisional",
        UNAuthorizationStatus::Ephemeral => "ephemeral",
        _ => "unknown",
    };
    format!("[codetether:desktop] macOS notification authorization status={status}")
}

fn notification_shown_log(attention_type: &AttentionNotificationType) -> String {
    let attention_type = match attention_type {
        AttentionNotificationType::Approval => "approval",
        AttentionNotificationType::CompletedReview => "completed_review",
        AttentionNotificationType::Failed => "failed",
    };
    format!("[codetether:desktop] notification shown type={attention_type} platform=macos")
}

fn attention_id_from_identifier(identifier: &str) -> Option<&str> {
    identifier
        .strip_prefix("codetether-attention-")
        .filter(|attention_id| crate::attention_notifications::is_public_id(attention_id, "attn_"))
}

struct NotificationDelegateIvars {
    app: AppHandle,
    delivery: Arc<DeliveryInner>,
}

define_class!(
    // SAFETY: NSObject has no subclassing requirements and this class does
    // not implement Drop. Its AppHandle ivar is safe to use from callbacks.
    #[unsafe(super = NSObject)]
    #[name = "CodeTetherNotificationCenterDelegate"]
    #[ivars = NotificationDelegateIvars]
    struct NotificationDelegate;

    // SAFETY: NSObjectProtocol has no additional safety requirements.
    unsafe impl NSObjectProtocol for NotificationDelegate {}

    // SAFETY: The implemented callback signatures match the framework protocol.
    unsafe impl UNUserNotificationCenterDelegate for NotificationDelegate {
        #[allow(non_snake_case)]
        #[unsafe(method(userNotificationCenter:willPresentNotification:withCompletionHandler:))]
        fn userNotificationCenter_willPresentNotification_withCompletionHandler(
            &self,
            _center: &UNUserNotificationCenter,
            _notification: &UNNotification,
            completion_handler: &block2::DynBlock<dyn Fn(UNNotificationPresentationOptions)>,
        ) {
            completion_handler
                .call((UNNotificationPresentationOptions::Banner
                    | UNNotificationPresentationOptions::List,));
        }

        #[allow(non_snake_case)]
        #[unsafe(method(userNotificationCenter:didReceiveNotificationResponse:withCompletionHandler:))]
        fn userNotificationCenter_didReceiveNotificationResponse_withCompletionHandler(
            &self,
            _center: &UNUserNotificationCenter,
            response: &UNNotificationResponse,
            completion_handler: &block2::DynBlock<dyn Fn()>,
        ) {
            let identifier = response.notification().request().identifier().to_string();
            let intent = lock(&self.ivars().delivery.active).remove(&identifier);
            let result = if let Some(intent) = intent {
                crate::attention_notifications::activate_notification(
                    &self.ivars().app,
                    &self.ivars().delivery.attention_state,
                    intent,
                );
                Ok(true)
            } else if let Some(attention_id) = attention_id_from_identifier(&identifier) {
                crate::attention_notifications::activate_notification_link(
                    &self.ivars().app,
                    &self.ivars().delivery.attention_state,
                    attention_id,
                );
                Ok(true)
            } else {
                crate::host_supervisor::show_main_window(&self.ivars().app)
            };
            if let Err(error) = result {
                eprintln!(
                    "[codetether:desktop] could not restore the main window from a macOS notification: {error}"
                );
            }
            completion_handler.call(());
        }
    }
);

impl NotificationDelegate {
    fn new(app: AppHandle, delivery: Arc<DeliveryInner>) -> Retained<Self> {
        let this = Self::alloc().set_ivars(NotificationDelegateIvars { app, delivery });
        // SAFETY: NSObject's initializer has the declared signature.
        unsafe { msg_send![super(this), init] }
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum AuthorizationState {
    Unknown,
    Requesting,
    Authorized,
    Denied,
}

struct PendingNotification {
    identifier: String,
    title: String,
    body: String,
    activation: Option<NotificationIntent>,
    completion: Completion,
}

enum ScheduleDecision {
    RequestAuthorization,
    Queued,
    Deliver(Box<PendingNotification>),
}

struct DeliveryState {
    authorization: AuthorizationState,
    pending: VecDeque<PendingNotification>,
}

impl Default for DeliveryState {
    fn default() -> Self {
        Self {
            authorization: AuthorizationState::Unknown,
            pending: VecDeque::new(),
        }
    }
}

impl DeliveryState {
    fn schedule(&mut self, notification: PendingNotification) -> Result<ScheduleDecision, String> {
        match self.authorization {
            AuthorizationState::Authorized => {
                return Ok(ScheduleDecision::Deliver(Box::new(notification)));
            }
            AuthorizationState::Denied => return Err(PERMISSION_DENIED.to_owned()),
            AuthorizationState::Unknown | AuthorizationState::Requesting => {}
        }

        if self.pending.len() >= MAX_PENDING_NOTIFICATIONS {
            return Err("macOS notification queue is full".to_owned());
        }
        if self
            .pending
            .iter()
            .any(|pending| pending.identifier == notification.identifier)
        {
            return Err("macOS notification is already queued".to_owned());
        }

        self.pending.push_back(notification);
        if self.authorization == AuthorizationState::Unknown {
            self.authorization = AuthorizationState::Requesting;
            Ok(ScheduleDecision::RequestAuthorization)
        } else {
            Ok(ScheduleDecision::Queued)
        }
    }

    fn finish_authorization(
        &mut self,
        authorization: AuthorizationState,
    ) -> VecDeque<PendingNotification> {
        debug_assert!(matches!(
            authorization,
            AuthorizationState::Unknown
                | AuthorizationState::Authorized
                | AuthorizationState::Denied
        ));
        self.authorization = authorization;
        std::mem::take(&mut self.pending)
    }
}

struct DeliveryInner {
    state: Mutex<DeliveryState>,
    active: Mutex<ActiveNotificationIntents>,
    initialized: AtomicBool,
    attention_state: AttentionNotificationState,
}

pub struct MacOSNotificationState {
    inner: Arc<DeliveryInner>,
    _delegate: Retained<NotificationDelegate>,
}

pub fn install(
    app: &AppHandle,
    attention_state: AttentionNotificationState,
) -> MacOSNotificationState {
    let inner = Arc::new(DeliveryInner {
        state: Mutex::new(DeliveryState::default()),
        active: Mutex::new(ActiveNotificationIntents::default()),
        initialized: AtomicBool::new(false),
        attention_state,
    });
    let delegate = NotificationDelegate::new(app.clone(), inner.clone());
    MacOSNotificationState {
        inner,
        _delegate: delegate,
    }
}

/// AppKit must finish launching before UserNotifications is touched on macOS.
/// Tauri invokes `setup` from the native launch callback, so initialization is
/// deliberately completed from the later `RunEvent::Ready` callback.
pub fn initialize(app: &AppHandle) {
    let Some(state) = app.try_state::<MacOSNotificationState>() else {
        return;
    };
    let state = state.inner();
    if !state.inner.initialized.swap(true, Ordering::AcqRel) {
        let value = UNUserNotificationCenter::currentNotificationCenter();
        value.setDelegate(Some(ProtocolObject::from_ref(&*state._delegate)));
        let completion = RcBlock::new(|settings: NonNull<UNNotificationSettings>| {
            // SAFETY: UserNotifications provides valid settings for this callback.
            let status = unsafe { settings.as_ref() }.authorizationStatus();
            eprintln!("{}", authorization_status_log(status));
        });
        value.getNotificationSettingsWithCompletionHandler(&completion);
    }
}

pub fn show(
    app: &AppHandle,
    identifier: String,
    title: String,
    body: String,
    activation: Option<NotificationIntent>,
    completion: impl FnOnce(Result<(), String>) + Send + 'static,
) -> Result<(), String> {
    let state = app
        .try_state::<MacOSNotificationState>()
        .ok_or_else(|| "macOS notification state is unavailable".to_owned())?;
    if !state.inner().inner.initialized.load(Ordering::Acquire) {
        return Err("macOS notification state is not initialized".to_owned());
    }
    let notification = PendingNotification {
        identifier,
        title,
        body,
        activation,
        completion: Box::new(completion),
    };
    let decision = lock(&state.inner().inner.state).schedule(notification)?;
    let inner = state.inner().inner.clone();

    match decision {
        ScheduleDecision::RequestAuthorization => {
            let app = app.clone();
            app.run_on_main_thread(move || request_authorization(inner))
                .map_err(|error| error.to_string())?;
        }
        ScheduleDecision::Queued => {}
        ScheduleDecision::Deliver(notification) => {
            let app = app.clone();
            app.run_on_main_thread(move || deliver(inner, *notification))
                .map_err(|error| error.to_string())?;
        }
    }
    Ok(())
}

fn request_authorization(inner: Arc<DeliveryInner>) {
    let center = UNUserNotificationCenter::currentNotificationCenter();
    let completion = RcBlock::new(move |granted: objc2::runtime::Bool, error: *mut NSError| {
        eprintln!(
            "{}",
            authorization_result_log(granted.as_bool(), !error.is_null())
        );
        let error = error_description(error);
        let (authorization, failure) = if let Some(error) = error {
            (AuthorizationState::Unknown, Some(error))
        } else if granted.as_bool() {
            (AuthorizationState::Authorized, None)
        } else {
            (
                AuthorizationState::Denied,
                Some(PERMISSION_DENIED.to_owned()),
            )
        };
        let pending = lock(&inner.state).finish_authorization(authorization);
        for notification in pending {
            if let Some(error) = &failure {
                (notification.completion)(Err(error.clone()));
            } else {
                deliver(inner.clone(), notification);
            }
        }
    });
    center.requestAuthorizationWithOptions_completionHandler(
        UNAuthorizationOptions::Alert,
        &completion,
    );
}

fn deliver(inner: Arc<DeliveryInner>, notification: PendingNotification) {
    let center = UNUserNotificationCenter::currentNotificationCenter();
    let content = UNMutableNotificationContent::new();
    content.setTitle(&NSString::from_str(&notification.title));
    content.setBody(&NSString::from_str(&notification.body));
    let request = UNNotificationRequest::requestWithIdentifier_content_trigger(
        &NSString::from_str(&notification.identifier),
        &content,
        None,
    );
    let identifier = notification.identifier;
    let activation = notification.activation;
    let completion = Mutex::new(Some(notification.completion));
    let completion = RcBlock::new(move |error: *mut NSError| {
        let result = error_description(error).map_or(Ok(()), Err);
        if result.is_ok()
            && let Some(intent) = activation.clone()
        {
            eprintln!("{}", notification_shown_log(intent.attention_type()));
            lock(&inner.active).insert(identifier.clone(), intent);
        }
        if let Some(completion) = lock(&completion).take() {
            completion(result);
        }
    });
    center.addNotificationRequest_withCompletionHandler(&request, Some(&completion));
}

#[derive(Default)]
struct ActiveNotificationIntents {
    entries: HashMap<String, NotificationIntent>,
    order: VecDeque<String>,
}

impl ActiveNotificationIntents {
    fn insert(&mut self, identifier: String, intent: NotificationIntent) {
        if self.entries.insert(identifier.clone(), intent).is_some() {
            self.order.retain(|entry| entry != &identifier);
        }
        self.order.push_back(identifier);
        while self.order.len() > MAX_PENDING_NOTIFICATIONS {
            if let Some(expired) = self.order.pop_front() {
                self.entries.remove(&expired);
            }
        }
    }

    fn remove(&mut self, identifier: &str) -> Option<NotificationIntent> {
        let removed = self.entries.remove(identifier);
        if removed.is_some() {
            self.order.retain(|entry| entry != identifier);
        }
        removed
    }
}

fn error_description(error: *mut NSError) -> Option<String> {
    NonNull::new(error).map(|error| {
        // SAFETY: Framework completion handlers provide a valid NSError for
        // the duration of the callback when the pointer is non-null.
        unsafe { error.as_ref() }.localizedDescription().to_string()
    })
}

fn lock<T>(mutex: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    mutex
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn notification(identifier: impl Into<String>) -> PendingNotification {
        PendingNotification {
            identifier: identifier.into(),
            title: "CodeTether".to_owned(),
            body: "Test notification".to_owned(),
            activation: None,
            completion: Box::new(|_| {}),
        }
    }

    fn intent(index: usize) -> NotificationIntent {
        serde_json::from_value(serde_json::json!({
            "attentionId": format!("attn_{index:06}"),
            "type": "completed_review",
            "projectId": "proj_123456",
            "conversationId": "conv_123456",
            "turnId": "turn_123456",
            "title": "CodeTether",
            "body": "Test notification"
        }))
        .unwrap()
    }

    #[test]
    fn diagnostic_logs_use_only_controlled_status_and_type_labels() {
        let mut logs = Vec::new();
        for (granted, has_error, expected) in [
            (true, false, "granted"),
            (false, false, "denied"),
            (true, true, "error"),
            (false, true, "error"),
        ] {
            let log = authorization_result_log(granted, has_error);
            assert_eq!(
                log,
                format!("[codetether:desktop] macOS notification authorization result={expected}")
            );
            logs.push(log.to_owned());
        }
        for (status, expected) in [
            (UNAuthorizationStatus::NotDetermined, "notDetermined"),
            (UNAuthorizationStatus::Denied, "denied"),
            (UNAuthorizationStatus::Authorized, "authorized"),
            (UNAuthorizationStatus::Provisional, "provisional"),
            (UNAuthorizationStatus::Ephemeral, "ephemeral"),
            (UNAuthorizationStatus(999), "unknown"),
        ] {
            let log = authorization_status_log(status);
            assert_eq!(
                log,
                format!("[codetether:desktop] macOS notification authorization status={expected}")
            );
            logs.push(log);
        }
        for (attention_type, expected) in [
            (AttentionNotificationType::Approval, "approval"),
            (
                AttentionNotificationType::CompletedReview,
                "completed_review",
            ),
            (AttentionNotificationType::Failed, "failed"),
        ] {
            let value: NotificationIntent = serde_json::from_value(serde_json::json!({
                "attentionId": "attn_PRIVACY_SENTINEL",
                "type": attention_type,
                "projectId": "proj_PRIVACY_SENTINEL",
                "conversationId": "conv_PRIVACY_SENTINEL",
                "turnId": "turn_PRIVACY_SENTINEL",
                "title": "TITLE_PRIVACY_SENTINEL",
                "body": "DEVICE_PROJECT_PRIVACY_SENTINEL\nBODY_PRIVACY_SENTINEL"
            }))
            .unwrap();
            let log = notification_shown_log(value.attention_type());
            assert_eq!(
                log,
                format!("[codetether:desktop] notification shown type={expected} platform=macos")
            );
            logs.push(log);
        }
        for log in logs {
            assert!(!log.contains("PRIVACY_SENTINEL"));
            assert!(!log.contains('\n'));
        }
    }

    #[test]
    fn notification_identifier_recovers_only_a_valid_public_attention_id() {
        assert_eq!(
            attention_id_from_identifier("codetether-attention-attn_123456"),
            Some("attn_123456")
        );
        for identifier in [
            "other-attention-attn_123456",
            "prefix-codetether-attention-attn_123456",
            "CodeTether-attention-attn_123456",
            "codetether-attention-conv_123456",
            "codetether-attention-attn_short",
            "codetether-attention-attn_123456/path",
            "codetether-attention-attn_123456?turn=123456",
            "codetether-attention-attn_123456\n",
            "codetether-attention-",
            "",
        ] {
            assert_eq!(attention_id_from_identifier(identifier), None);
        }
    }

    #[test]
    fn authorization_request_is_coalesced_while_notifications_are_bounded() {
        let mut state = DeliveryState::default();
        assert!(matches!(
            state.schedule(notification("first")).unwrap(),
            ScheduleDecision::RequestAuthorization
        ));
        assert!(matches!(
            state.schedule(notification("second")).unwrap(),
            ScheduleDecision::Queued
        ));
        for index in 2..MAX_PENDING_NOTIFICATIONS {
            assert!(matches!(
                state
                    .schedule(notification(format!("notification-{index}")))
                    .unwrap(),
                ScheduleDecision::Queued
            ));
        }
        assert_eq!(state.pending.len(), MAX_PENDING_NOTIFICATIONS);
        assert!(state.schedule(notification("overflow")).is_err());
    }

    #[test]
    fn authorization_result_drains_only_the_current_bounded_queue() {
        let mut state = DeliveryState::default();
        state.schedule(notification("first")).unwrap();
        state.schedule(notification("second")).unwrap();

        let pending = state.finish_authorization(AuthorizationState::Authorized);
        assert_eq!(pending.len(), 2);
        assert!(state.pending.is_empty());
        assert!(matches!(
            state.schedule(notification("third")).unwrap(),
            ScheduleDecision::Deliver(_)
        ));
    }

    #[test]
    fn denied_authorization_fails_closed_without_growing_the_queue() {
        let mut state = DeliveryState::default();
        state.schedule(notification("first")).unwrap();
        let pending = state.finish_authorization(AuthorizationState::Denied);
        assert_eq!(pending.len(), 1);
        assert_eq!(
            state.schedule(notification("second")).err().unwrap(),
            PERMISSION_DENIED
        );
        assert!(state.pending.is_empty());
    }

    #[test]
    fn duplicate_pending_identifiers_are_rejected() {
        let mut state = DeliveryState::default();
        state.schedule(notification("same")).unwrap();
        assert_eq!(
            state.schedule(notification("same")).err().unwrap(),
            "macOS notification is already queued"
        );
    }

    #[test]
    fn accepted_attention_activation_mapping_is_bounded_and_consumed_once() {
        let mut active = ActiveNotificationIntents::default();
        for index in 0..=MAX_PENDING_NOTIFICATIONS {
            let identifier = format!("notification-{index}");
            let mut pending = notification(&identifier);
            pending.activation = Some(intent(index));
            active.insert(identifier, pending.activation.unwrap());
        }
        assert_eq!(active.entries.len(), MAX_PENDING_NOTIFICATIONS);
        assert!(active.remove("notification-0").is_none());
        assert!(active.remove("notification-1").is_some());
        assert!(active.remove("notification-1").is_none());
    }
}
