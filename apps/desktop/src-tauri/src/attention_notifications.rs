use std::{
    collections::{HashSet, VecDeque},
    sync::{Arc, Mutex},
};

#[cfg(any(windows, test))]
use std::collections::HashMap;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, State};

#[cfg(any(windows, target_os = "macos"))]
use tauri::Emitter;

#[cfg(any(windows, target_os = "macos"))]
use crate::host_supervisor::show_main_window;

#[cfg(any(windows, target_os = "macos"))]
const NOTIFICATION_INTENT_EVENT: &str = "codetether://notification-intent";
const MAX_DELIVERED_ATTENTION_IDS: usize = 2_048;
#[cfg(any(windows, target_os = "macos", test))]
const MAX_PENDING_INTENTS: usize = 256;
#[cfg(windows)]
const MAX_ACTIVE_WINDOWS_TOASTS: usize = 256;
const MAX_TITLE_CHARACTERS: usize = 96;
const MAX_BODY_CHARACTERS: usize = 256;

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum AttentionNotificationType {
    Approval,
    CompletedReview,
    Failed,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct NotificationIntent {
    attention_id: String,
    #[serde(rename = "type")]
    attention_type: AttentionNotificationType,
    project_id: String,
    conversation_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    turn_id: Option<String>,
    title: String,
    body: String,
}

impl NotificationIntent {
    fn validate(&self) -> Result<(), &'static str> {
        if !is_public_id(&self.attention_id, "attn_") {
            return Err("attentionId is not a CodeTether Attention identity");
        }
        if !is_public_id(&self.project_id, "proj_") {
            return Err("projectId is not a CodeTether Project identity");
        }
        if !is_public_id(&self.conversation_id, "conv_") {
            return Err("conversationId is not a CodeTether Conversation identity");
        }
        if self
            .turn_id
            .as_deref()
            .is_some_and(|turn_id| !is_public_id(turn_id, "turn_"))
        {
            return Err("turnId is not a CodeTether Turn identity");
        }
        validate_text(&self.title, MAX_TITLE_CHARACTERS, false, "title")?;
        validate_text(&self.body, MAX_BODY_CHARACTERS, true, "body")?;
        if self.body.matches('\n').count() > 1 {
            return Err("body must contain at most two lines");
        }
        if self.body.split('\n').any(|line| line.trim().is_empty()) {
            return Err("body lines must not be empty");
        }
        Ok(())
    }
}

#[derive(Default)]
struct DeliveryState {
    attention_ids: HashSet<String>,
    delivered_order: VecDeque<String>,
}

#[cfg_attr(not(windows), derive(Default))]
struct AttentionNotificationStateInner {
    delivery: Mutex<DeliveryState>,
    pending: Mutex<VecDeque<NotificationIntent>>,
    #[cfg(windows)]
    active_toasts: Mutex<BoundedRegistry<ActiveWindowsToast>>,
}

#[cfg(windows)]
impl Default for AttentionNotificationStateInner {
    fn default() -> Self {
        Self {
            delivery: Mutex::default(),
            pending: Mutex::default(),
            #[cfg(windows)]
            active_toasts: Mutex::new(BoundedRegistry::new(MAX_ACTIVE_WINDOWS_TOASTS)),
        }
    }
}

#[derive(Clone, Default)]
pub struct AttentionNotificationState(Arc<AttentionNotificationStateInner>);

impl AttentionNotificationState {
    fn reserve_delivery(&self, attention_id: &str) -> bool {
        lock(&self.0.delivery)
            .attention_ids
            .insert(attention_id.to_owned())
    }

    fn mark_delivered(&self, attention_id: &str) {
        let mut delivery = lock(&self.0.delivery);
        delivery.delivered_order.push_back(attention_id.to_owned());
        while delivery.delivered_order.len() > MAX_DELIVERED_ATTENTION_IDS {
            if let Some(expired) = delivery.delivered_order.pop_front() {
                delivery.attention_ids.remove(&expired);
            }
        }
    }

    fn release_delivery(&self, attention_id: &str) {
        lock(&self.0.delivery).attention_ids.remove(attention_id);
    }

    #[cfg(any(windows, target_os = "macos", test))]
    fn enqueue_intent(&self, intent: NotificationIntent) {
        let mut pending = lock(&self.0.pending);
        if pending.len() == MAX_PENDING_INTENTS {
            pending.pop_front();
            eprintln!("[codetether:desktop] pending notification intent queue reached its bound");
        }
        pending.push_back(intent);
    }

    fn take_pending_intent(&self) -> Option<NotificationIntent> {
        lock(&self.0.pending).pop_front()
    }

    #[cfg(windows)]
    fn retain_active_toast_if_pending(
        &self,
        attention_id: &str,
        toast: ActiveWindowsToast,
        activated: &std::sync::atomic::AtomicBool,
    ) {
        use std::sync::atomic::Ordering;

        let retired = {
            let mut active_toasts = lock(&self.0.active_toasts);
            if activated.load(Ordering::Acquire) {
                vec![toast]
            } else {
                active_toasts.insert(attention_id.to_owned(), toast)
            }
        };
        drop(retired);
    }

    #[cfg(windows)]
    fn remove_active_toast(&self, attention_id: &str) {
        let removed = lock(&self.0.active_toasts).remove(attention_id);
        drop(removed);
    }
}

#[cfg(any(windows, test))]
struct BoundedRegistry<T> {
    entries: HashMap<String, T>,
    order: VecDeque<String>,
    limit: usize,
}

#[cfg(any(windows, test))]
impl<T> BoundedRegistry<T> {
    fn new(limit: usize) -> Self {
        assert!(limit > 0, "bounded registry limit must be positive");
        Self {
            entries: HashMap::new(),
            order: VecDeque::new(),
            limit,
        }
    }

    fn insert(&mut self, key: String, value: T) -> Vec<T> {
        let mut retired = Vec::new();
        if let Some(previous) = self.entries.remove(&key) {
            self.order.retain(|entry| entry != &key);
            retired.push(previous);
        }
        self.entries.insert(key.clone(), value);
        self.order.push_back(key);

        while self.order.len() > self.limit {
            if let Some(expired) = self.order.pop_front()
                && let Some(value) = self.entries.remove(&expired)
            {
                retired.push(value);
            }
        }
        retired
    }

    fn remove(&mut self, key: &str) -> Option<T> {
        let removed = self.entries.remove(key);
        if removed.is_some() {
            self.order.retain(|entry| entry != key);
        }
        removed
    }

    #[cfg(test)]
    fn contains(&self, key: &str) -> bool {
        self.entries.contains_key(key)
    }

    #[cfg(test)]
    fn len(&self) -> usize {
        self.entries.len()
    }
}

#[tauri::command]
pub fn deliver_attention_notification(
    app: AppHandle,
    state: State<'_, AttentionNotificationState>,
    intent: NotificationIntent,
) -> Result<bool, String> {
    intent
        .validate()
        .map_err(|message| format!("Invalid notification intent: {message}."))?;

    if !state.reserve_delivery(&intent.attention_id) {
        return Ok(false);
    }

    #[cfg(windows)]
    let result = show_windows_notification(&app, state.inner().clone(), intent.clone());
    #[cfg(target_os = "macos")]
    let result = show_macos_notification(&app, state.inner().clone(), intent.clone());
    #[cfg(not(any(windows, target_os = "macos")))]
    let result: Result<(), String> = {
        use tauri_plugin_notification::NotificationExt;
        app.notification()
            .builder()
            .title(&intent.title)
            .body(&intent.body)
            .show()
            .map_err(|error| error.to_string())
    };

    match result {
        Ok(()) => {
            #[cfg(not(target_os = "macos"))]
            state.mark_delivered(&intent.attention_id);
            Ok(true)
        }
        Err(error) => {
            state.release_delivery(&intent.attention_id);
            eprintln!("[codetether:desktop] notification delivery failed: {error}");
            Err("Desktop notification could not be delivered.".to_owned())
        }
    }
}

#[cfg(target_os = "macos")]
fn show_macos_notification(
    app: &AppHandle,
    state: AttentionNotificationState,
    intent: NotificationIntent,
) -> Result<(), String> {
    let completion_state = state.clone();
    let completion_attention_id = intent.attention_id.clone();
    crate::macos_notifications::show(
        app,
        format!("codetether-attention-{}", intent.attention_id),
        intent.title.clone(),
        intent.body.clone(),
        Some(intent.clone()),
        move |result| match result {
            Ok(()) => completion_state.mark_delivered(&completion_attention_id),
            Err(error) => {
                completion_state.release_delivery(&completion_attention_id);
                eprintln!("[codetether:desktop] macOS notification delivery failed: {error}");
            }
        },
    )
}

#[tauri::command]
pub fn take_pending_notification_intent(
    state: State<'_, AttentionNotificationState>,
) -> Option<NotificationIntent> {
    state.take_pending_intent()
}

#[cfg(windows)]
fn show_windows_notification(
    app: &AppHandle,
    state: AttentionNotificationState,
    intent: NotificationIntent,
) -> Result<(), String> {
    use std::sync::atomic::{AtomicBool, Ordering};

    use windows::{
        Foundation::TypedEventHandler,
        UI::Notifications::{ToastDismissedEventArgs, ToastNotification, ToastNotificationManager},
        core::IInspectable,
    };

    let app_id = windows_notification_app_id(app)?;
    let (context, message) = split_notification_body(&intent.body);
    let activation_app = app.clone();
    let activation_intent = intent.clone();
    let activated = Arc::new(AtomicBool::new(false));
    let activation_flag = activated.clone();
    let activation_state = Arc::downgrade(&state.0);
    let activation_attention_id = intent.attention_id.clone();
    let activated_handler: TypedEventHandler<ToastNotification, IInspectable> =
        TypedEventHandler::new(move |_, _| {
            if !activation_flag.swap(true, Ordering::AcqRel)
                && let Some(inner) = activation_state.upgrade()
            {
                let state = AttentionNotificationState(inner);
                state.remove_active_toast(&activation_attention_id);
                activate_notification(&activation_app, &state, activation_intent.clone());
            }
            Ok(())
        });

    let dismissal_state = Arc::downgrade(&state.0);
    let dismissal_attention_id = intent.attention_id.clone();
    let dismissed_handler: TypedEventHandler<ToastNotification, ToastDismissedEventArgs> =
        TypedEventHandler::new(
            move |_, args: windows::core::Ref<'_, ToastDismissedEventArgs>| {
                let reason = args.as_ref().and_then(|args| args.Reason().ok());
                // A timed-out banner remains clickable in Windows Notification Center,
                // so retain its source object until activation or bounded eviction.
                if should_remove_after_dismissal(reason)
                    && let Some(inner) = dismissal_state.upgrade()
                {
                    AttentionNotificationState(inner).remove_active_toast(&dismissal_attention_id);
                }
                Ok(())
            },
        );

    let notification = create_windows_toast(&intent.title, context, message)?;
    let activated_token = notification
        .Activated(&activated_handler)
        .map_err(|error| error.to_string())?;
    let dismissed_token = notification
        .Dismissed(&dismissed_handler)
        .map_err(|error| error.to_string())?;
    let active_toast = ActiveWindowsToast {
        notification,
        activated_token,
        dismissed_token,
    };

    let notifier = ToastNotificationManager::CreateToastNotifierWithId(&app_id.into())
        .map_err(|error| error.to_string())?;
    notifier
        .Show(&active_toast.notification)
        .map_err(|error| error.to_string())?;
    state.retain_active_toast_if_pending(&intent.attention_id, active_toast, &activated);
    Ok(())
}

#[cfg(windows)]
fn should_remove_after_dismissal(
    reason: Option<windows::UI::Notifications::ToastDismissalReason>,
) -> bool {
    reason != Some(windows::UI::Notifications::ToastDismissalReason::TimedOut)
}

#[cfg(windows)]
struct ActiveWindowsToast {
    notification: windows::UI::Notifications::ToastNotification,
    activated_token: i64,
    dismissed_token: i64,
}

#[cfg(windows)]
impl Drop for ActiveWindowsToast {
    fn drop(&mut self) {
        let _ = self.notification.RemoveActivated(self.activated_token);
        let _ = self.notification.RemoveDismissed(self.dismissed_token);
    }
}

#[cfg(windows)]
fn create_windows_toast(
    title: &str,
    context: &str,
    message: Option<&str>,
) -> Result<windows::UI::Notifications::ToastNotification, String> {
    use windows::{
        Data::Xml::Dom::XmlDocument, UI::Notifications::ToastNotification, core::HSTRING,
    };

    let document = XmlDocument::new().map_err(|error| error.to_string())?;
    document
        .LoadXml(&HSTRING::from(windows_toast_xml(title, context, message)))
        .map_err(|error| error.to_string())?;
    ToastNotification::CreateToastNotification(&document).map_err(|error| error.to_string())
}

#[cfg(any(windows, test))]
fn windows_toast_xml(title: &str, context: &str, message: Option<&str>) -> String {
    let message = message.map_or_else(String::new, |message| {
        format!("<text id=\"3\">{}</text>", escape_xml_text(message))
    });
    format!(
        "<toast><visual><binding template=\"ToastGeneric\"><text id=\"1\">{}</text><text id=\"2\">{}</text>{message}</binding></visual></toast>",
        escape_xml_text(title),
        escape_xml_text(context),
    )
}

#[cfg(any(windows, test))]
fn escape_xml_text(value: &str) -> String {
    let mut escaped = String::with_capacity(value.len());
    for character in value.chars() {
        match character {
            '&' => escaped.push_str("&amp;"),
            '<' => escaped.push_str("&lt;"),
            '>' => escaped.push_str("&gt;"),
            '\'' => escaped.push_str("&apos;"),
            '"' => escaped.push_str("&quot;"),
            _ => escaped.push(character),
        }
    }
    escaped
}

#[cfg(windows)]
fn windows_notification_app_id(app: &AppHandle) -> Result<String, String> {
    let executable = tauri::utils::platform::current_exe().map_err(|error| error.to_string())?;
    notification_app_id_for_executable(&executable, &app.config().identifier)
}

#[cfg(windows)]
fn notification_app_id_for_executable(
    executable: &std::path::Path,
    configured_identifier: &str,
) -> Result<String, String> {
    use std::path::MAIN_SEPARATOR as SEP;

    use tauri_winrt_notification::Toast;

    let executable_directory = executable
        .parent()
        .ok_or_else(|| "Desktop executable has no parent directory".to_owned())?;
    let executable_directory = executable_directory.display().to_string();
    let is_uninstalled_build = executable_directory
        .ends_with(format!("{SEP}target{SEP}debug").as_str())
        || executable_directory.ends_with(format!("{SEP}target{SEP}release").as_str());

    Ok(if is_uninstalled_build {
        Toast::POWERSHELL_APP_ID.to_owned()
    } else {
        configured_identifier.to_owned()
    })
}

#[cfg(any(windows, target_os = "macos"))]
pub(crate) fn activate_notification(
    app: &AppHandle,
    state: &AttentionNotificationState,
    intent: NotificationIntent,
) {
    // Queue first so a WebView resumed by focus can drain the intent even when
    // its Tauri event listener was suspended while the window was minimized.
    state.enqueue_intent(intent.clone());

    match show_main_window(app) {
        Ok(true) => {}
        Ok(false) => return,
        Err(error) => {
            eprintln!(
                "[codetether:desktop] could not restore the notification target window: {error}"
            );
            return;
        }
    }

    // The payload is a low-latency path for an already-awake WebView. The
    // bounded native queue remains the handoff for missed/suspended events.
    if let Err(error) = app.emit(NOTIFICATION_INTENT_EVENT, intent) {
        eprintln!("[codetether:desktop] could not announce notification intent: {error}");
    }
}

#[cfg(any(windows, test))]
fn split_notification_body(body: &str) -> (&str, Option<&str>) {
    match body.split_once('\n') {
        Some((context, message)) => (context, Some(message)),
        None => (body, None),
    }
}

fn validate_text(
    value: &str,
    max_characters: usize,
    allow_newline: bool,
    field: &'static str,
) -> Result<(), &'static str> {
    if value.trim().is_empty() {
        return Err(match field {
            "title" => "title must not be empty",
            _ => "body must not be empty",
        });
    }
    if value.chars().count() > max_characters {
        return Err(match field {
            "title" => "title is too long",
            _ => "body is too long",
        });
    }
    if value
        .chars()
        .any(|character| character.is_control() && !(allow_newline && character == '\n'))
    {
        return Err(match field {
            "title" => "title contains unsupported control characters",
            _ => "body contains unsupported control characters",
        });
    }
    Ok(())
}

fn is_public_id(value: &str, prefix: &str) -> bool {
    let Some(suffix) = value.strip_prefix(prefix) else {
        return false;
    };
    if !(6..=96).contains(&suffix.len()) {
        return false;
    }
    let mut bytes = suffix.bytes();
    bytes
        .next()
        .is_some_and(|byte| byte.is_ascii_alphanumeric())
        && bytes.all(|byte| byte.is_ascii_alphanumeric() || byte == b'_' || byte == b'-')
}

fn lock<T>(mutex: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    mutex
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn intent(attention_id: &str) -> NotificationIntent {
        NotificationIntent {
            attention_id: attention_id.to_owned(),
            attention_type: AttentionNotificationType::CompletedReview,
            project_id: "proj_123456".to_owned(),
            conversation_id: "conv_123456".to_owned(),
            turn_id: Some("turn_123456".to_owned()),
            title: "CodeTether · 工作已完成".to_owned(),
            body: "中文项目 · 修复 Windows 登录问题 🚀\nCodex 已完成本轮工作".to_owned(),
        }
    }

    #[test]
    fn intent_accepts_public_identities_and_unicode_content() {
        let value = intent("attn_123456");
        assert_eq!(value.validate(), Ok(()));
        assert_eq!(
            split_notification_body(&value.body).1,
            Some("Codex 已完成本轮工作")
        );

        let json = serde_json::to_value(value).unwrap();
        assert_eq!(json["type"], "completed_review");
        assert_eq!(json["attentionId"], "attn_123456");
        assert_eq!(json["turnId"], "turn_123456");
        assert!(json.get("providerThreadId").is_none());
    }

    #[test]
    fn intent_rejects_private_or_unbounded_values() {
        let mut value = intent("provider_request_123456");
        assert!(value.validate().is_err());

        value = intent("attn_123456");
        value.turn_id = Some("provider_turn_123456".to_owned());
        assert_eq!(
            value.validate(),
            Err("turnId is not a CodeTether Turn identity")
        );

        value = intent("attn_123456");
        value.title = "x".repeat(MAX_TITLE_CHARACTERS + 1);
        assert_eq!(value.validate(), Err("title is too long"));

        value = intent("attn_123456");
        value.body = "one\ntwo\nthree".to_owned();
        assert_eq!(value.validate(), Err("body must contain at most two lines"));
    }

    #[test]
    fn intent_deserialization_denies_provider_fields() {
        let mut json = serde_json::to_value(intent("attn_123456")).unwrap();
        json["providerThreadId"] = serde_json::json!("thread_private");
        assert!(serde_json::from_value::<NotificationIntent>(json).is_err());
    }

    #[test]
    fn intent_keeps_legacy_turn_identity_optional() {
        let mut json = serde_json::to_value(intent("attn_123456")).unwrap();
        json.as_object_mut().unwrap().remove("turnId");

        let value = serde_json::from_value::<NotificationIntent>(json).unwrap();
        assert_eq!(value.turn_id, None);
        let encoded = serde_json::to_value(value).unwrap();
        assert!(encoded.get("turnId").is_none());
    }

    #[test]
    fn delivery_dedupe_is_process_scoped_and_bounded() {
        let state = AttentionNotificationState::default();
        assert!(state.reserve_delivery("attn_123456"));
        state.mark_delivered("attn_123456");
        assert!(!state.reserve_delivery("attn_123456"));

        for index in 0..MAX_DELIVERED_ATTENTION_IDS {
            let attention_id = format!("attn_{index:06}");
            assert!(state.reserve_delivery(&attention_id));
            state.mark_delivered(&attention_id);
        }
        assert!(state.reserve_delivery("attn_123456"));
    }

    #[test]
    fn failed_delivery_can_be_attempted_again() {
        let state = AttentionNotificationState::default();
        assert!(state.reserve_delivery("attn_123456"));
        state.release_delivery("attn_123456");
        assert!(state.reserve_delivery("attn_123456"));
    }

    #[test]
    fn pending_click_intents_are_fifo_and_bounded() {
        let state = AttentionNotificationState::default();
        state.enqueue_intent(intent("attn_123456"));
        state.enqueue_intent(intent("attn_654321"));
        assert_eq!(
            state.take_pending_intent().unwrap().attention_id,
            "attn_123456"
        );
        assert_eq!(
            state.take_pending_intent().unwrap().attention_id,
            "attn_654321"
        );
        assert_eq!(state.take_pending_intent(), None);

        for index in 0..=MAX_PENDING_INTENTS {
            state.enqueue_intent(intent(&format!("attn_{index:06}")));
        }
        assert_eq!(
            state.take_pending_intent().unwrap().attention_id,
            "attn_000001"
        );
    }

    #[test]
    fn active_toast_registry_is_bounded_and_replaces_by_attention_id() {
        let mut registry = BoundedRegistry::new(2);
        assert!(registry.insert("attn_one".to_owned(), 1).is_empty());
        assert!(registry.insert("attn_two".to_owned(), 2).is_empty());
        assert_eq!(registry.len(), 2);

        assert_eq!(registry.insert("attn_one".to_owned(), 3), vec![1]);
        assert_eq!(registry.insert("attn_three".to_owned(), 4), vec![2]);
        assert_eq!(registry.len(), 2);
        assert!(registry.contains("attn_one"));
        assert!(registry.contains("attn_three"));
        assert!(!registry.contains("attn_two"));
        assert_eq!(registry.remove("attn_one"), Some(3));
    }

    #[test]
    fn windows_toast_xml_preserves_unicode_and_escapes_markup() {
        let xml = windows_toast_xml(
            "CodeTether & <批准>",
            "中文项目 🚀",
            Some("say \"yes\" & 'continue'"),
        );
        assert!(xml.contains("CodeTether &amp; &lt;批准&gt;"));
        assert!(xml.contains("中文项目 🚀"));
        assert!(xml.contains("say &quot;yes&quot; &amp; &apos;continue&apos;"));
    }

    #[cfg(windows)]
    #[test]
    fn retained_windows_toast_is_safe_for_managed_cross_thread_state() {
        fn assert_send_sync<T: Send + Sync>() {}
        assert_send_sync::<ActiveWindowsToast>();
    }

    #[cfg(windows)]
    #[test]
    fn banner_timeout_retains_notification_center_activation_source() {
        use windows::UI::Notifications::ToastDismissalReason;

        assert!(!should_remove_after_dismissal(Some(
            ToastDismissalReason::TimedOut
        )));
        assert!(should_remove_after_dismissal(Some(
            ToastDismissalReason::UserCanceled
        )));
        assert!(should_remove_after_dismissal(None));
    }

    #[cfg(windows)]
    #[test]
    fn installed_notifications_use_the_bundle_aumid() {
        use std::path::Path;

        use tauri_winrt_notification::Toast;

        let configured = "com.codetether.desktop";
        assert_eq!(
            notification_app_id_for_executable(
                Path::new(r"C:\Users\me\AppData\Local\Programs\CodeTether\codetether-desktop.exe"),
                configured,
            ),
            Ok(configured.to_owned()),
        );
        assert_eq!(
            notification_app_id_for_executable(
                Path::new(
                    r"C:\workspace\apps\desktop\src-tauri\target\debug\codetether-desktop.exe"
                ),
                configured,
            ),
            Ok(Toast::POWERSHELL_APP_ID.to_owned()),
        );
        assert_eq!(
            notification_app_id_for_executable(
                Path::new(
                    r"C:\workspace\apps\desktop\src-tauri\target\release\codetether-desktop.exe"
                ),
                configured,
            ),
            Ok(Toast::POWERSHELL_APP_ID.to_owned()),
        );
    }
}
