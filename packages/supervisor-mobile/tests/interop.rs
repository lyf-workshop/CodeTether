use std::{
    env,
    io::{BufRead, BufReader},
    path::Path,
    process::{Child, Command, Stdio},
    sync::mpsc,
    thread,
    time::{Duration, Instant},
};

use p256::ecdsa::{signature::Signer, Signature, SigningKey};
use serde_json::{json, Value};
use supervisor_mobile::{
    connect_supervisor, ConnectOptions, ConnectionMode, DeviceSigner, MobileError,
};

struct FixtureSigner(SigningKey);

impl FixtureSigner {
    fn new() -> Self {
        // Fixed test scalar. Production proof signing uses Android Keystore.
        Self(SigningKey::from_slice(&[7; 32]).expect("fixture signing key"))
    }
}

impl DeviceSigner for FixtureSigner {
    fn sign_der(&self, message: Vec<u8>) -> Result<Vec<u8>, MobileError> {
        let signature: Signature = self.0.sign(&message);
        Ok(signature.to_der().as_bytes().to_vec())
    }
}

struct Fixture {
    child: Child,
    values: Value,
}

impl Fixture {
    fn start() -> Self {
        Self::start_with_args(&[])
    }

    fn start_with_args(args: &[&str]) -> Self {
        let script = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("tests")
            .join("interop-fixture.mjs");
        let fixture_env = ["PATH", "SystemRoot", "WINDIR", "TEMP", "TMP", "TMPDIR"]
            .into_iter()
            .filter_map(|name| env::var_os(name).map(|value| (name, value)));
        let child = Command::new("node")
            .arg(script)
            .args(args)
            .env_clear()
            .envs(fixture_env)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .spawn()
            .expect("start the local TypeScript Supervisor/Relay fixture");
        let mut fixture = Self {
            child,
            values: Value::Null,
        };
        let output = fixture.child.stdout.take().expect("fixture stdout");
        let (tx, rx) = mpsc::sync_channel(1);
        thread::spawn(move || {
            let mut line = String::new();
            let result = BufReader::new(output).read_line(&mut line).map(|_| line);
            let _ = tx.send(result);
        });
        let line = rx
            .recv_timeout(Duration::from_secs(20))
            .expect("fixture startup timed out")
            .expect("read fixture setup");
        fixture.values = serde_json::from_str(&line).unwrap_or_else(|_| {
            panic!(
                "fixture setup failed; build @codetether/relay... and @codetether/control-plane..."
            )
        });
        fixture
    }

    fn value(&self, key: &str) -> &str {
        self.values[key].as_str().expect("fixture string")
    }

    fn options(&self, mode: ConnectionMode) -> ConnectOptions {
        ConnectOptions {
            host_id: self.value("hostId").into(),
            host_fingerprint: self.value("hostFingerprint").into(),
            host_identity_generation: 1,
            host_public_jwk_json: self.values["publicJwk"].to_string(),
            device_id: self.value("deviceId").into(),
            device_key_generation: 1,
            grant_json: self.values["grant"].to_string(),
            descriptor_json: self.values["descriptor"].to_string(),
            access_token: self.value("accessToken").into(),
            mode,
        }
    }
}

impl Drop for Fixture {
    fn drop(&mut self) {
        drop(self.child.stdin.take());
        let deadline = Instant::now() + Duration::from_secs(3);
        loop {
            match self.child.try_wait() {
                Ok(Some(_)) => return,
                Ok(None) if Instant::now() < deadline => thread::sleep(Duration::from_millis(30)),
                _ => {
                    let _ = self.child.kill();
                    let _ = self.child.wait();
                    return;
                }
            }
        }
    }
}

fn exercise_operations(fixture: &Fixture, mode: ConnectionMode) {
    let session = connect_supervisor(fixture.options(mode), Box::new(FixtureSigner::new()))
        .expect("establish a pinned and authenticated Supervisor session");
    let machine = fixture.value("machineId");
    let project = fixture.value("projectId");
    let conversation = fixture.value("conversationId");
    let cursor = "123e4567-e89b-42d3-a456-426614174000:0";
    let actions = [
        json!({"operation":"host.bootstrap"}),
        json!({"operation":"machine.list"}),
        json!({"operation":"machine.get","machineId":machine}),
        json!({"operation":"project.list","machineId":machine,"limit":50}),
        json!({"operation":"project.get","machineId":machine,"projectId":project}),
        json!({"operation":"conversation.list","machineId":machine,"projectId":project,"limit":50}),
        json!({"operation":"conversation.get","machineId":machine,"projectId":project,"conversationId":conversation}),
        json!({"operation":"conversation.history","machineId":machine,"projectId":project,"conversationId":conversation,"limit":20}),
        json!({"operation":"conversation.live.read","machineId":machine,"projectId":project,"conversationId":conversation,"cursor":cursor,"limit":32,"waitMs":0}),
        json!({"operation":"action.get","actionId":"act_fixture_query"}),
        json!({"operation":"conversation.turn.start","machineId":machine,"projectId":project,"conversationId":conversation,"actionId":"act_fixture_reply","input":{"type":"text","text":"reply"}}),
        json!({"operation":"conversation.create","machineId":machine,"projectId":project,"actionId":"act_fixture_create","provider":"codex","input":{"type":"text","text":"new conversation"}}),
        json!({"operation":"conversation.recent","machineId":machine,"limit":5}),
        json!({"operation":"conversation.changes","machineId":machine,"projectId":project,"conversationId":conversation,"offset":0}),
        json!({"operation":"conversation.archive","machineId":machine,"projectId":project,"conversationId":conversation,"actionId":"act_fixture_archive"}),
        json!({"operation":"conversation.updateModel","machineId":machine,"projectId":project,"conversationId":conversation,"actionId":"act_fixture_model","model":"gpt-5.1"}),
        json!({"operation":"conversation.models.refresh","machineId":machine,"projectId":project,"conversationId":conversation}),
        json!({"operation":"attention.list","status":"open","limit":50}),
        json!({"operation":"attention.resolve","attentionId":"attn_fixture_item","actionId":"act_fixture_attention"}),
        json!({"operation":"approval.resolve","approvalId":"approval_fixture_item","actionId":"act_fixture_approve","decision":"accept"}),
        json!({"operation":"turn.interrupt","machineId":machine,"projectId":project,"conversationId":conversation,"turnId":"turn_fixture_running","actionId":"act_fixture_interrupt"}),
    ];
    for request in actions {
        let operation = request["operation"].as_str().expect("fixture operation");
        let raw = session
            .request(request.to_string())
            .unwrap_or_else(|error| panic!("{operation} was rejected: {error}"));
        let data: Value = serde_json::from_str(&raw).expect("response data is JSON");
        assert_eq!(data["fixtureOperation"], operation);
        if let Some(action_id) = request.get("actionId") {
            assert_eq!(&data["actionId"], action_id, "{operation} changed actionId");
        }
    }

    let assert_operation =
        |operation: &str, action_id: Option<&str>, result: Result<String, MobileError>| {
            let raw = result.unwrap_or_else(|error| panic!("{operation} was rejected: {error}"));
            let data: Value = serde_json::from_str(&raw).expect("response data is JSON");
            assert_eq!(data["fixtureOperation"], operation);
            if let Some(action_id) = action_id {
                assert_eq!(data["actionId"], action_id);
            }
        };
    assert_operation(
        "project.create",
        Some("act_fixture_project_create"),
        session.project_create(
            machine.into(),
            "act_fixture_project_create".into(),
            "C:\\fixture".into(),
            Some("Fixture".into()),
        ),
    );
    assert_operation(
        "project.remove",
        Some("act_fixture_project_remove"),
        session.project_remove(project.into(), "act_fixture_project_remove".into()),
    );
    assert_operation(
        "conversation.list",
        None,
        session.conversation_list(
            machine.into(),
            project.into(),
            50,
            None,
            Some("archived".into()),
        ),
    );
    assert_operation(
        "conversation.search",
        None,
        session.conversation_search(
            project.into(),
            "needle".into(),
            None,
            None,
            None,
            None,
            None,
        ),
    );
    assert_operation(
        "conversation.pin",
        Some("act_fixture_conversation_pin"),
        session.conversation_pin(
            machine.into(),
            project.into(),
            conversation.into(),
            "act_fixture_conversation_pin".into(),
            true,
        ),
    );
    assert_operation(
        "conversation.rename",
        Some("act_fixture_conversation_rename"),
        session.conversation_rename(
            machine.into(),
            project.into(),
            conversation.into(),
            "act_fixture_conversation_rename".into(),
            "Renamed fixture".into(),
        ),
    );
    assert_operation(
        "conversation.restore",
        Some("act_fixture_conversation_restore"),
        session.conversation_restore(
            machine.into(),
            project.into(),
            conversation.into(),
            "act_fixture_conversation_restore".into(),
        ),
    );
    assert_operation(
        "conversation.updateModel",
        Some("act_fixture_conversation_update_model"),
        session.conversation_update_model(
            machine.into(),
            project.into(),
            conversation.into(),
            "act_fixture_conversation_update_model".into(),
            Some("gpt-5.1".into()),
            Some("high".into()),
        ),
    );
    assert_operation(
        "conversation.models.refresh",
        None,
        session.conversation_models_refresh(machine.into(), project.into(), conversation.into()),
    );

    let reason_action = format!("act_fixture_reason_{}", session.transport());
    let error = session
        .project_remove(project.into(), reason_action)
        .expect_err("project removal conflict has a Host reason");
    assert_eq!(error.error_code(), "conflict");
    assert_eq!(error.reason(), Some("project_has_conversations"));

    let busy_action = format!("act_fixture_busy_archive_{}", session.transport());
    let error = session
        .request(
            json!({
                "operation": "conversation.archive",
                "machineId": machine,
                "projectId": project,
                "conversationId": conversation,
                "actionId": busy_action,
            })
            .to_string(),
        )
        .expect_err("busy archive is rejected by the TypeScript server");
    assert_eq!(error.error_code(), "unsupported");
    assert_eq!(error.http_status(), Some(409));

    let observed: Value = serde_json::from_str(
        &session
            .request(
                json!({
                    "operation": "action.get",
                    "actionId": busy_action,
                })
                .to_string(),
            )
            .expect("a 409 leaves the session usable"),
    )
    .expect("response data is JSON");
    assert_eq!(observed["actionId"], busy_action);
    assert_eq!(
        observed["observed"],
        json!({"operation":"conversation.archive", "count":1})
    );
    session.close();
}

#[test]
fn existing_typescript_server_accepts_all_mobile_operations_direct_and_relay() {
    let fixture = Fixture::start();
    exercise_operations(&fixture, ConnectionMode::Direct);
    exercise_operations(&fixture, ConnectionMode::Relay);
}

#[test]
fn existing_typescript_server_rejects_a_proof_from_another_device_key() {
    let fixture = Fixture::start();
    let wrong_signer =
        FixtureSigner(SigningKey::from_slice(&[8; 32]).expect("wrong fixture signing key"));
    let rejected = connect_supervisor(
        fixture.options(ConnectionMode::Direct),
        Box::new(wrong_signer),
    );
    let error = rejected
        .err()
        .expect("proof from an unregistered key is rejected");
    assert_eq!(error.error_code(), "authentication_failed");
}

struct RejectSigning;

impl DeviceSigner for RejectSigning {
    fn sign_der(&self, _message: Vec<u8>) -> Result<Vec<u8>, MobileError> {
        Err(MobileError::code("unexpected_signer_call"))
    }
}

#[test]
fn relay_tunnel_rejects_wrong_inner_host_spki_before_device_signing() {
    let fixture = Fixture::start_with_args(&["--misroute-inner-host"]);
    let rejected = connect_supervisor(
        fixture.options(ConnectionMode::Relay),
        Box::new(RejectSigning),
    );
    let error = rejected
        .err()
        .expect("inner TLS must reject the wrong Host pin");
    assert_eq!(error.error_code(), "host_identity_mismatch");
}

#[test]
fn relay_connection_rejects_wrong_signed_outer_spki_before_device_signing() {
    let fixture = Fixture::start();
    let mut options = fixture.options(ConnectionMode::Relay);
    options.descriptor_json = fixture.values["wrongRelayPin"].to_string();
    let rejected = connect_supervisor(options, Box::new(RejectSigning));
    let error = rejected
        .err()
        .expect("outer TLS must reject the wrong Relay pin");
    assert_eq!(error.error_code(), "relay_identity_mismatch");
}
