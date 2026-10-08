// Standalone focused integration target avoids unrelated baseline lib-test
// import defects. Exercises the ACTUAL native validator/pipe dispatcher source.
#[path = "../src/host_presence_signer.rs"]
mod host_presence_signer;

mod host_identity_key_store {
    pub fn host_identity_key_public(_: String) -> Result<serde_json::Value, String> {
        Err("synthetic missing Host key".into())
    }
    pub fn host_identity_key_sign(_: String, _: String) -> Result<serde_json::Value, String> {
        panic!("invalid requests must never reach a signer")
    }
}
