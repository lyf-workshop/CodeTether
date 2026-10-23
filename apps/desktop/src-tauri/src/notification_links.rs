//! Protocol URLs are untrusted navigation hints, never execution authority.
use tauri::{AppHandle, Manager};

use crate::{
    attention_notifications::{
        AttentionNotificationState, activate_notification, activate_notification_link, is_public_id,
    },
    host_supervisor::show_main_window,
};

const LINK_PREFIX: &str = "codetether://notification/";
const MAX_LINK_BYTES: usize = LINK_PREFIX.len() + "attn_".len() + 96;

#[derive(Debug, Eq, PartialEq)]
enum LinkArgument<'a> {
    Absent,
    Invalid,
    Attention(&'a str),
}

fn parse_link(value: &str) -> Option<&str> {
    if value.len() > MAX_LINK_BYTES {
        return None;
    }
    let attention_id = value.strip_prefix(LINK_PREFIX)?;
    // Never decode or normalize case, slashes, whitespace, queries or hashes.
    is_public_id(attention_id, "attn_").then_some(attention_id)
}

fn link_argument(args: &[String]) -> LinkArgument<'_> {
    let has_link = args.iter().any(|argument| {
        argument
            .get(.."codetether:".len())
            .is_some_and(|scheme| scheme.eq_ignore_ascii_case("codetether:"))
    });
    if !has_link {
        return LinkArgument::Absent;
    }
    // The installed handler passes one URL. In particular, never reconstruct
    // URLs from the single-instance plugin's pipe-separated Windows arguments.
    if args.len() != 2 {
        return LinkArgument::Invalid;
    }
    match parse_link(&args[1]) {
        Some(id) => LinkArgument::Attention(id),
        None => LinkArgument::Invalid,
    }
}

fn received_log(result: &str) -> &'static str {
    match result {
        "matched" => "[codetether:desktop] notification link received result=matched",
        "unmatched" => "[codetether:desktop] notification link received result=unmatched",
        _ => "[codetether:desktop] notification link received result=invalid",
    }
}

/// False means the ordinary second-launch path should restore its window.
pub(crate) fn handle_arguments(app: &AppHandle, args: &[String]) -> bool {
    match link_argument(args) {
        LinkArgument::Absent => false,
        LinkArgument::Invalid => {
            eprintln!("{}", received_log("invalid"));
            let _ = show_main_window(app);
            true
        }
        LinkArgument::Attention(id) => {
            if let Some(state) = app.try_state::<AttentionNotificationState>() {
                if let Some(intent) = state.find_intent(id) {
                    eprintln!("{}", received_log("matched"));
                    activate_notification(app, &state, intent);
                } else {
                    eprintln!("{}", received_log("unmatched"));
                    activate_notification_link(app, &state, id);
                }
            } else {
                // State is managed before plugin callbacks; fail closed if the
                // lifecycle has nevertheless already removed that authority.
                eprintln!("{}", received_log("unmatched"));
                let _ = show_main_window(app);
            }
            true
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn links_accept_only_exact_bounded_public_attention_identities() {
        assert_eq!(
            parse_link("codetether://notification/attn_123456"),
            Some("attn_123456")
        );
        assert!(
            parse_link(&format!(
                "codetether://notification/attn_{}",
                "a".repeat(96)
            ))
            .is_some()
        );
        for invalid in [
            "",
            "codetether://notification/",
            "codetether://notification/attn_short",
            "codetether://notification/conv_123456",
            "codetether://other/attn_123456",
            "codetether://notification/attn_123456?x=1",
            "codetether://notification/attn_123456?",
            "codetether://notification/attn_123456#x",
            "codetether://notification/attn_123456#",
            "CodeTether://notification/attn_123456",
            "codetether://Notification/attn_123456",
            "codetether://notification/ATTN_123456",
            "codetether://notification/attn_%31%32%33%34%35%36",
            "codetether://notification/%61ttn_123456",
            "codetether://notification/attn_123456/",
            "codetether://notification/attn_123456/../attn_654321",
            "codetether://notification/attn_123456\n",
            " codetether://notification/attn_123456",
            "codetether://notification/attn_中文123456",
            "codetether://user@notification/attn_123456",
            "codetether://notification:80/attn_123456",
            "codetether:\\notification\\attn_123456",
            "https://notification/attn_123456",
            "codetether://notification/attn_123456|--other",
        ] {
            assert_eq!(parse_link(invalid), None, "unexpected link shape admitted");
        }
        assert_eq!(
            parse_link(&format!(
                "codetether://notification/attn_{}",
                "a".repeat(97)
            )),
            None
        );
    }

    #[test]
    fn forwarded_arguments_distinguish_links_from_an_ordinary_second_launch() {
        assert_eq!(
            link_argument(&["codetether-desktop.exe".into()]),
            LinkArgument::Absent
        );
        assert_eq!(link_argument(&[]), LinkArgument::Absent);
        assert_eq!(
            link_argument(&[
                "codetether-desktop.exe".into(),
                "codetether://notification/attn_123456".into()
            ]),
            LinkArgument::Attention("attn_123456")
        );
        for args in [
            vec!["codetether-desktop.exe", "codetether://other"],
            vec![
                "codetether-desktop.exe",
                "CODETETHER://notification/attn_123456",
            ],
            vec![
                "codetether-desktop.exe",
                "codetether://notification/attn_123456",
                "codetether://notification/attn_654321",
            ],
            vec![
                "codetether-desktop.exe",
                "codetether://notification/attn_123456",
                "--extra",
            ],
            vec!["codetether://notification/attn_123456"],
        ] {
            assert_eq!(
                link_argument(&args.into_iter().map(str::to_owned).collect::<Vec<_>>()),
                LinkArgument::Invalid
            );
        }
    }

    #[test]
    fn logs_are_closed_labels_without_url_or_identity_content() {
        for result in [
            "matched",
            "unmatched",
            "invalid",
            "codetether://notification/attn_private",
        ] {
            let line = received_log(result);
            assert!(!line.contains("attn_"));
            assert!(!line.contains("codetether://"));
            assert!(matches!(
                line,
                "[codetether:desktop] notification link received result=matched"
                    | "[codetether:desktop] notification link received result=unmatched"
                    | "[codetether:desktop] notification link received result=invalid"
            ));
        }
    }
}
