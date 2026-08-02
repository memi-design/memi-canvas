use serde::Serialize;
use serde_json::{json, Value};
use std::{
    collections::{BTreeMap, BTreeSet},
    fs::{self, File},
    io::{BufReader, Read, Write},
    os::unix::fs::{FileTypeExt, OpenOptionsExt, PermissionsExt},
    os::unix::{net::UnixStream, process::CommandExt},
    path::{Path, PathBuf},
    process::{Child, Command, Stdio},
    sync::{
        atomic::{AtomicBool, AtomicU64, Ordering},
        Arc, Mutex,
    },
    time::{Duration, Instant},
};
use tauri::{AppHandle, Manager, State};

const MAX_RUNTIME_RPC_BYTES: usize = 262_144;
const MAX_ARTIFACT_BYTES: u64 = 64 * 1024 * 1024;
const RUNTIME_SOCKET_NAME: &str = "runtime/runtime-v1.sock";
const PLAN_INTEGRITY_FILE: &str = "runtime/plan-integrity-v1.key";
const PACKAGED_RUNTIME_EXECUTABLE: &str = "memi-canvas-runtime";
const RUNTIME_RPC_METHODS: &[&str] = &[
    "imports.plan",
    "imports.list",
    "imports.start",
    "imports.get",
    "imports.cancel",
    "imports.resume",
    "imports.retryFailed",
    "imports.commit",
    "imports.purgeAll",
    "canvasDocuments.open",
    "canvasDocuments.load",
    "canvasDocuments.initialize",
    "canvasDocuments.append",
    "canvasDocuments.checkpoint",
];

#[derive(Debug, PartialEq, Eq)]
pub(crate) struct RuntimeEnvelopeBinding {
    pub(crate) request_id: String,
    pub(crate) correlation_id: String,
    pub(crate) method: String,
}

pub(crate) struct RuntimeBridgeState {
    token: String,
    socket_path: PathBuf,
    artifact_root: PathBuf,
    lifecycle: Arc<RuntimeLifecycle>,
}

struct RuntimeLifecycle {
    child: Mutex<Option<Child>>,
    socket_path: PathBuf,
    active_connections: Mutex<BTreeMap<u64, UnixStream>>,
    next_connection_id: AtomicU64,
    shutting_down: AtomicBool,
    shutdown_gate: Mutex<()>,
}

impl RuntimeLifecycle {
    fn new(child: Child, socket_path: PathBuf) -> Self {
        Self {
            child: Mutex::new(Some(child)),
            socket_path,
            active_connections: Mutex::new(BTreeMap::new()),
            next_connection_id: AtomicU64::new(1),
            shutting_down: AtomicBool::new(false),
            shutdown_gate: Mutex::new(()),
        }
    }

    fn register_connection(&self, stream: &UnixStream) -> Result<u64, String> {
        let tracked = stream
            .try_clone()
            .map_err(|_| "Runtime transport could not be tracked".to_owned())?;
        let mut connections = self
            .active_connections
            .lock()
            .map_err(|_| "Runtime transport lifecycle is unavailable".to_owned())?;
        if self.shutting_down.load(Ordering::Acquire) {
            let _ = tracked.shutdown(std::net::Shutdown::Both);
            return Err("Runtime broker is shutting down".to_owned());
        }
        let connection_id = self.next_connection_id.fetch_add(1, Ordering::Relaxed);
        connections.insert(connection_id, tracked);
        Ok(connection_id)
    }

    fn unregister_connection(&self, connection_id: u64) {
        if let Ok(mut connections) = self.active_connections.lock() {
            connections.remove(&connection_id);
        }
    }

    #[cfg(test)]
    fn active_connection_count(&self) -> usize {
        self.active_connections
            .lock()
            .map_or(0, |connections| connections.len())
    }

    fn shutdown(&self) {
        let Ok(_shutdown_guard) = self.shutdown_gate.lock() else {
            return;
        };
        if self.shutting_down.swap(true, Ordering::AcqRel) {
            return;
        }
        if let Ok(mut connections) = self.active_connections.lock() {
            for (_, stream) in connections.iter() {
                let _ = stream.shutdown(std::net::Shutdown::Both);
            }
            connections.clear();
        }
        let _ = fs::remove_file(&self.socket_path);
        if let Ok(mut child_slot) = self.child.lock() {
            if let Some(mut child) = child_slot.take() {
                terminate_process_group_and_wait(&mut child);
            }
        }
    }
}

fn signal_process_group(process_group_id: u32, signal: &str) {
    let _ = Command::new("/bin/kill")
        .arg(format!("-{signal}"))
        .arg(format!("-{process_group_id}"))
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status();
}

fn terminate_process_group_and_wait(child: &mut Child) {
    let process_group_id = child.id();
    signal_process_group(process_group_id, "TERM");
    let deadline = Instant::now() + Duration::from_millis(750);
    let mut leader_reaped = false;
    while Instant::now() < deadline {
        match child.try_wait() {
            Ok(Some(_)) => {
                leader_reaped = true;
                break;
            }
            Ok(None) => std::thread::sleep(Duration::from_millis(10)),
            Err(_) => break,
        }
    }
    signal_process_group(process_group_id, "KILL");
    if !leader_reaped {
        let _ = child.wait();
    }
}

impl RuntimeBridgeState {
    pub(crate) fn shutdown(&self) {
        self.lifecycle.shutdown();
    }
}

impl Drop for RuntimeBridgeState {
    fn drop(&mut self) {
        self.shutdown();
    }
}

#[derive(Serialize)]
pub(crate) struct RuntimeSession {
    token: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RuntimeArtifact {
    artifact_id: String,
    mime_type: &'static str,
    bytes: Vec<u8>,
}

fn is_sortable_id(value: &str, prefix: &str) -> bool {
    let Some(body) = value.strip_prefix(prefix) else {
        return false;
    };
    body.len() == 26
        && body.bytes().all(|byte| {
            matches!(byte, b'0'..=b'9' | b'A'..=b'H' | b'J'..=b'K' | b'M'..=b'N' | b'P'..=b'T' | b'V'..=b'Z')
        })
}

pub(crate) fn constant_time_bearer_matches(authorization: &str, expected_token: &str) -> bool {
    let expected = format!("Bearer {expected_token}");
    if authorization.len() != expected.len() {
        return false;
    }
    authorization
        .as_bytes()
        .iter()
        .zip(expected.as_bytes())
        .fold(0_u8, |difference, (left, right)| {
            difference | (left ^ right)
        })
        == 0
}

pub(crate) fn validate_runtime_envelope(
    envelope: &Value,
) -> Result<RuntimeEnvelopeBinding, String> {
    let bytes = serde_json::to_vec(envelope)
        .map_err(|_| "Runtime request is not serializable".to_owned())?;
    if bytes.len() > MAX_RUNTIME_RPC_BYTES {
        return Err("Runtime request exceeds its payload limit".to_owned());
    }
    let object = envelope
        .as_object()
        .ok_or_else(|| "Runtime request must be an object".to_owned())?;
    let actual = object.keys().map(String::as_str).collect::<BTreeSet<_>>();
    let expected = [
        "schemaVersion",
        "requestId",
        "correlationId",
        "sentAt",
        "method",
        "payload",
    ]
    .into_iter()
    .collect::<BTreeSet<_>>();
    if actual != expected
        || object.get("schemaVersion").and_then(Value::as_u64) != Some(1)
        || !object.get("payload").is_some_and(Value::is_object)
    {
        return Err("Runtime request envelope is invalid".to_owned());
    }
    let request_id = object
        .get("requestId")
        .and_then(Value::as_str)
        .filter(|value| is_sortable_id(value, "prq_"))
        .ok_or_else(|| "Runtime request identity is invalid".to_owned())?;
    let correlation_id = object
        .get("correlationId")
        .and_then(Value::as_str)
        .filter(|value| is_sortable_id(value, "cor_"))
        .ok_or_else(|| "Runtime correlation identity is invalid".to_owned())?;
    let sent_at = object
        .get("sentAt")
        .and_then(Value::as_str)
        .filter(|value| value.len() >= 20 && value.len() <= 64)
        .ok_or_else(|| "Runtime request timestamp is invalid".to_owned())?;
    if !sent_at.ends_with('Z') && !sent_at.contains('+') {
        return Err("Runtime request timestamp is invalid".to_owned());
    }
    let method = object
        .get("method")
        .and_then(Value::as_str)
        .filter(|method| RUNTIME_RPC_METHODS.contains(method))
        .ok_or_else(|| "Runtime method is unavailable".to_owned())?;
    Ok(RuntimeEnvelopeBinding {
        request_id: request_id.to_owned(),
        correlation_id: correlation_id.to_owned(),
        method: method.to_owned(),
    })
}

fn validate_runtime_response(
    response: &Value,
    expected: &RuntimeEnvelopeBinding,
) -> Result<(), String> {
    let bytes = serde_json::to_vec(response)
        .map_err(|_| "Runtime response is not serializable".to_owned())?;
    if bytes.len() > MAX_RUNTIME_RPC_BYTES {
        return Err("Runtime response exceeds its payload limit".to_owned());
    }
    let object = response
        .as_object()
        .ok_or_else(|| "Runtime response must be an object".to_owned())?;
    let is_success = object.get("ok").and_then(Value::as_bool);
    let expected_keys = match is_success {
        Some(true) => [
            "schemaVersion",
            "requestId",
            "correlationId",
            "receivedAt",
            "method",
            "ok",
            "result",
        ]
        .into_iter()
        .collect::<BTreeSet<_>>(),
        Some(false) => [
            "schemaVersion",
            "requestId",
            "correlationId",
            "receivedAt",
            "method",
            "ok",
            "error",
        ]
        .into_iter()
        .collect::<BTreeSet<_>>(),
        None => return Err("Runtime response status is invalid".to_owned()),
    };
    let actual = object.keys().map(String::as_str).collect::<BTreeSet<_>>();
    if actual != expected_keys
        || object.get("schemaVersion").and_then(Value::as_u64) != Some(1)
        || object.get("requestId").and_then(Value::as_str) != Some(expected.request_id.as_str())
        || object.get("correlationId").and_then(Value::as_str)
            != Some(expected.correlation_id.as_str())
        || object.get("method").and_then(Value::as_str) != Some(expected.method.as_str())
        || !object
            .get("receivedAt")
            .and_then(Value::as_str)
            .is_some_and(|value| value.len() >= 20 && value.len() <= 64)
    {
        return Err("Runtime response binding is invalid".to_owned());
    }
    if is_success == Some(true) && !object.get("result").is_some_and(Value::is_object) {
        return Err("Runtime success payload is invalid".to_owned());
    }
    if is_success == Some(false) && !object.get("error").is_some_and(Value::is_object) {
        return Err("Runtime failure payload is invalid".to_owned());
    }
    Ok(())
}

fn random_runtime_token() -> Result<String, String> {
    let mut bytes = [0_u8; 32];
    File::open("/dev/urandom")
        .and_then(|mut source| source.read_exact(&mut bytes))
        .map_err(|_| "Secure runtime authentication could not be initialized".to_owned())?;
    Ok(bytes.iter().map(|byte| format!("{byte:02x}")).collect())
}

fn is_secret_key(value: &str) -> bool {
    value.len() == 64 && value.bytes().all(|byte| byte.is_ascii_hexdigit())
}

fn plan_integrity_key(app_data: &Path) -> Result<String, String> {
    let key_path = app_data.join(PLAN_INTEGRITY_FILE);
    let parent = key_path
        .parent()
        .ok_or_else(|| "Runtime integrity storage path is invalid".to_owned())?;
    ensure_private_directory(parent)?;
    match fs::symlink_metadata(&key_path) {
        Ok(metadata) => {
            if metadata.file_type().is_symlink() || !metadata.is_file() {
                return Err("Runtime integrity key must be a regular private file".to_owned());
            }
            if metadata.permissions().mode() & 0o777 != 0o600 {
                return Err("Runtime integrity key permissions are invalid".to_owned());
            }
            let value = fs::read_to_string(&key_path)
                .map_err(|_| "Runtime integrity key could not be read".to_owned())?;
            if is_secret_key(&value) {
                Ok(value)
            } else {
                Err("Runtime integrity key is invalid".to_owned())
            }
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            let value = random_runtime_token()?;
            let mut file = fs::OpenOptions::new()
                .write(true)
                .create_new(true)
                .mode(0o600)
                .open(&key_path)
                .map_err(|_| "Runtime integrity key could not be created".to_owned())?;
            file.write_all(value.as_bytes())
                .and_then(|_| file.sync_all())
                .map_err(|_| "Runtime integrity key could not be saved".to_owned())?;
            let metadata = file
                .metadata()
                .map_err(|_| "Runtime integrity key could not be inspected".to_owned())?;
            if metadata.permissions().mode() & 0o777 != 0o600 {
                return Err("Runtime integrity key permissions are invalid".to_owned());
            }
            Ok(value)
        }
        Err(_) => Err("Runtime integrity key could not be inspected".to_owned()),
    }
}

fn ensure_private_directory(path: &Path) -> Result<(), String> {
    fs::create_dir_all(path).map_err(|_| "Runtime storage could not be prepared".to_owned())?;
    let metadata = fs::symlink_metadata(path)
        .map_err(|_| "Runtime storage could not be inspected".to_owned())?;
    if metadata.file_type().is_symlink() || !metadata.is_dir() {
        return Err("Runtime storage must be a real directory".to_owned());
    }
    fs::set_permissions(path, fs::Permissions::from_mode(0o700))
        .map_err(|_| "Runtime storage permissions could not be secured".to_owned())
}

fn managed_worktree_root(cache_dir: &Path) -> Result<PathBuf, String> {
    let root = cache_dir.join("capture-worktrees");
    let value = root
        .to_str()
        .ok_or_else(|| "Managed worktree root must be valid UTF-8".to_owned())?;
    if !value
        .bytes()
        .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'/' | b'.' | b'_' | b'-'))
    {
        return Err(
            "Managed worktree root must not contain whitespace or shell-special characters"
                .to_owned(),
        );
    }
    Ok(root)
}

fn runtime_socket_is_ready(socket_path: &Path) -> bool {
    fs::symlink_metadata(socket_path).is_ok_and(|metadata| metadata.file_type().is_socket())
}

fn canonical_runtime_file(path: PathBuf, label: &str) -> Result<PathBuf, String> {
    let canonical = fs::canonicalize(&path).map_err(|_| format!("{label} is unavailable"))?;
    if !fs::metadata(&canonical)
        .map_err(|_| format!("{label} could not be inspected"))?
        .is_file()
    {
        return Err(format!("{label} is not a file"));
    }
    Ok(canonical)
}

/// Starts the local development runtime without Bun's `--compile` mode.
///
/// On this host the interpreter executes the runtime correctly, while every
/// compiled Bun Mach-O stalls inside dyld before JavaScript starts. Keeping the
/// bridge direct and explicit lets the debug macOS app exercise the truthful
/// Expo import flow without a hidden rebuild or a second copy of Bun. A
/// distributable runtime remains a separate release gate.
fn packaged_runtime_sidecar_path(application_executable: &Path) -> Option<PathBuf> {
    let macos_directory = application_executable.parent()?;
    let contents_directory = macos_directory.parent()?;
    (macos_directory.file_name()? == "MacOS" && contents_directory.file_name()? == "Contents")
        .then(|| macos_directory.join(PACKAGED_RUNTIME_EXECUTABLE))
}

fn packaged_runtime_command() -> Result<Option<Command>, String> {
    let application_executable = std::env::current_exe()
        .map_err(|_| "Memi Canvas executable location is unavailable".to_owned())?;
    let Some(candidate) = packaged_runtime_sidecar_path(&application_executable) else {
        return Ok(None);
    };
    let runtime = canonical_runtime_file(candidate, "Packaged Memi runtime sidecar")?;
    let mut command = Command::new(runtime);
    command.current_dir(
        application_executable
            .parent()
            .ok_or_else(|| "Memi Canvas executable directory is unavailable".to_owned())?,
    );
    Ok(Some(command))
}

fn local_development_runtime_command() -> Result<Command, String> {
    let home = std::env::var_os("HOME")
        .map(PathBuf::from)
        .ok_or_else(|| "Local Bun runtime home is unavailable".to_owned())?;
    let requested_bun = std::env::var_os("MEMI_RUNTIME_BUN")
        .map(PathBuf::from)
        .unwrap_or_else(|| home.join(".bun/bin/bun"));
    let bun = canonical_runtime_file(requested_bun, "Local Bun runtime")?;
    let entry = canonical_runtime_file(
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../runtime-sidecar/src/main.ts"),
        "Local Memi runtime source",
    )?;
    let project_root = fs::canonicalize(PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../.."))
        .map_err(|_| "Local Memi project root is unavailable".to_owned())?;
    let mut command = Command::new(bun);
    command.arg(entry).current_dir(project_root);
    Ok(command)
}

fn runtime_command() -> Result<Command, String> {
    packaged_runtime_command()?.map_or_else(local_development_runtime_command, Ok)
}

fn runtime_health_envelope() -> Value {
    json!({
        "schemaVersion": 1,
        "requestId": "prq_00000000000000000000000000",
        "correlationId": "cor_00000000000000000000000000",
        "sentAt": "2026-08-02T00:00:00.000Z",
        "method": "imports.list",
        "payload": {},
    })
}

pub(crate) fn start_runtime_bridge(
    app: &AppHandle,
    app_data: &Path,
) -> Result<RuntimeBridgeState, String> {
    ensure_private_directory(app_data)?;
    let app_cache = app
        .path()
        .app_cache_dir()
        .map_err(|_| "Managed capture cache path is unavailable".to_owned())?;
    let worktree_root = managed_worktree_root(&app_cache)?;
    ensure_private_directory(&worktree_root)?;
    let runtime_root = app_data.join("runtime");
    ensure_private_directory(&runtime_root)?;
    let socket_path = app_data.join(RUNTIME_SOCKET_NAME);
    if socket_path.exists() {
        let metadata = fs::symlink_metadata(&socket_path)
            .map_err(|_| "Stale runtime socket could not be inspected".to_owned())?;
        if metadata.file_type().is_symlink() || !metadata.file_type().is_socket() {
            return Err("Runtime socket path contains an unsafe entry".to_owned());
        }
        fs::remove_file(&socket_path)
            .map_err(|_| "Stale runtime socket could not be removed".to_owned())?;
    }
    let token = random_runtime_token()?;
    let plan_key = plan_integrity_key(app_data)?;
    let mut sidecar = runtime_command()?
        .env("MEMI_RUNTIME_TOKEN", &token)
        .env("MEMI_RUNTIME_SOCKET", &socket_path)
        .env("MEMI_RUNTIME_APP_DATA", app_data)
        .env("MEMI_RUNTIME_WORKTREE_ROOT", &worktree_root)
        .env("MEMI_RUNTIME_PLAN_KEY", plan_key)
        .env("MEMI_RUNTIME_PARENT_PID", std::process::id().to_string());
    sidecar
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .process_group(0);
    let child = sidecar
        .spawn()
        .map_err(|_| "Packaged runtime sidecar could not start".to_owned())?;
    let lifecycle = Arc::new(RuntimeLifecycle::new(child, socket_path.clone()));
    for _ in 0..3_000 {
        if runtime_socket_is_ready(&socket_path) {
            if let Err(error) = exchange_runtime_rpc_with_lifecycle(
                &socket_path,
                &token,
                runtime_health_envelope(),
                &lifecycle,
            ) {
                lifecycle.shutdown();
                return Err(format!(
                    "Packaged runtime sidecar health check failed: {error}"
                ));
            }
            return Ok(RuntimeBridgeState {
                token,
                socket_path,
                artifact_root: app_data.join("capture-artifacts"),
                lifecycle,
            });
        }
        std::thread::sleep(Duration::from_millis(20));
    }
    lifecycle.shutdown();
    Err("Packaged runtime sidecar did not become ready".to_owned())
}

#[tauri::command]
pub(crate) fn runtime_session(state: State<'_, RuntimeBridgeState>) -> RuntimeSession {
    RuntimeSession {
        token: state.token.clone(),
    }
}

fn exchange_runtime_rpc_with_lifecycle(
    socket_path: &Path,
    token: &str,
    envelope: Value,
    lifecycle: &RuntimeLifecycle,
) -> Result<Value, String> {
    let binding = validate_runtime_envelope(&envelope)?;
    let request = serde_json::to_vec(&json!({
        "authorization": format!("Bearer {token}"),
        "envelope": envelope,
    }))
    .map_err(|_| "Runtime request could not be encoded".to_owned())?;
    if request.len() > MAX_RUNTIME_RPC_BYTES {
        return Err("Runtime request exceeds its payload limit".to_owned());
    }
    let mut stream = UnixStream::connect(socket_path)
        .map_err(|_| "Packaged runtime is unavailable".to_owned())?;
    let connection_id = lifecycle.register_connection(&stream)?;
    let result = stream
        .set_read_timeout(Some(Duration::from_secs(300)))
        .and_then(|_| stream.set_write_timeout(Some(Duration::from_secs(5))))
        .map_err(|_| "Runtime transport could not be bounded".to_owned())
        .and_then(|_| {
            stream
                .write_all(&request)
                .and_then(|_| stream.write_all(b"\n"))
                .map_err(|_| "Runtime request transport failed".to_owned())
        })
        .and_then(|_| {
            let mut bytes = Vec::new();
            BufReader::new(stream)
                .take((MAX_RUNTIME_RPC_BYTES + 1) as u64)
                .read_to_end(&mut bytes)
                .map_err(|_| "Runtime response transport failed".to_owned())?;
            if bytes.len() > MAX_RUNTIME_RPC_BYTES {
                return Err("Runtime response exceeds its payload limit".to_owned());
            }
            let response: Value = serde_json::from_slice(&bytes)
                .map_err(|_| "Runtime response is invalid".to_owned())?;
            validate_runtime_response(&response, &binding)?;
            Ok(response)
        });
    lifecycle.unregister_connection(connection_id);
    result
}

#[tauri::command]
pub(crate) async fn runtime_rpc(
    state: State<'_, RuntimeBridgeState>,
    authorization: String,
    envelope: Value,
) -> Result<Value, String> {
    if !constant_time_bearer_matches(&authorization, &state.token) {
        return Err("Runtime authentication failed".to_owned());
    }
    let socket_path = state.socket_path.clone();
    let token = state.token.clone();
    let lifecycle = state.lifecycle.clone();
    tauri::async_runtime::spawn_blocking(move || {
        exchange_runtime_rpc_with_lifecycle(&socket_path, &token, envelope, &lifecycle)
    })
    .await
    .map_err(|_| "Runtime broker stopped unexpectedly".to_owned())?
}

#[tauri::command]
pub(crate) fn runtime_artifact(
    state: State<'_, RuntimeBridgeState>,
    authorization: String,
    artifact_id: String,
) -> Result<RuntimeArtifact, String> {
    if !constant_time_bearer_matches(&authorization, &state.token) {
        return Err("Runtime authentication failed".to_owned());
    }
    let path = artifact_path_for_id(&state.artifact_root, &artifact_id)?;
    let metadata = fs::metadata(&path).map_err(|_| "Artifact could not be inspected".to_owned())?;
    if metadata.len() == 0 || metadata.len() > MAX_ARTIFACT_BYTES {
        return Err("Artifact exceeds its read limit".to_owned());
    }
    let bytes = fs::read(&path).map_err(|_| "Artifact could not be read".to_owned())?;
    let mime_type = match path.extension().and_then(|value| value.to_str()) {
        Some("png") if bytes.starts_with(b"\x89PNG\r\n\x1a\n") => "image/png",
        Some("json") if serde_json::from_slice::<Value>(&bytes).is_ok() => "application/json",
        _ => return Err("Artifact content does not match its media type".to_owned()),
    };
    Ok(RuntimeArtifact {
        artifact_id,
        mime_type,
        bytes,
    })
}

#[tauri::command]
pub(crate) fn reveal_import_logs(
    app: AppHandle,
    state: State<'_, RuntimeBridgeState>,
    authorization: String,
    job_id: String,
) -> Result<(), String> {
    if !constant_time_bearer_matches(&authorization, &state.token)
        || !is_sortable_id(&job_id, "imp_")
    {
        return Err("Import log request is invalid".to_owned());
    }
    let app_data = app
        .path()
        .app_data_dir()
        .map_err(|_| "Memi app data is unavailable".to_owned())?;
    let resolved = import_log_path_for_job(&app_data, &job_id)?;
    std::process::Command::new("/usr/bin/open")
        .arg("-R")
        .arg(resolved)
        .status()
        .map_err(|_| "Import logs could not be revealed".to_owned())
        .and_then(|status| {
            status
                .success()
                .then_some(())
                .ok_or_else(|| "Finder did not reveal the import logs".to_owned())
        })
}

fn is_content_artifact_id(value: &str) -> bool {
    value
        .strip_prefix("art_")
        .is_some_and(|body| body.len() == 26 && body.bytes().all(|byte| byte.is_ascii_hexdigit()))
}

pub(crate) fn artifact_path_for_id(
    artifact_root: &Path,
    artifact_id: &str,
) -> Result<PathBuf, String> {
    if !is_content_artifact_id(artifact_id) {
        return Err("Artifact identity is invalid".to_owned());
    }
    let root_metadata = fs::symlink_metadata(artifact_root)
        .map_err(|_| "Artifact store is unavailable".to_owned())?;
    if root_metadata.file_type().is_symlink() || !root_metadata.is_dir() {
        return Err("Artifact store is not a real directory".to_owned());
    }
    let canonical_root = artifact_root
        .canonicalize()
        .map_err(|_| "Artifact store is unavailable".to_owned())?;
    let prefix = artifact_id
        .strip_prefix("art_")
        .expect("validated artifact prefix")
        .to_ascii_lowercase();
    let directory = canonical_root.join("sha256").join(&prefix[..2]);
    let directory_metadata =
        fs::symlink_metadata(&directory).map_err(|_| "Artifact was not found".to_owned())?;
    if directory_metadata.file_type().is_symlink() || !directory_metadata.is_dir() {
        return Err("Artifact directory is invalid".to_owned());
    }
    let mut matches = fs::read_dir(&directory)
        .map_err(|_| "Artifact directory is unavailable".to_owned())?
        .filter_map(Result::ok)
        .filter_map(|entry| {
            let name = entry.file_name();
            let name = name.to_str()?;
            let (digest, extension) = name.rsplit_once('.')?;
            (digest.len() == 64
                && digest.starts_with(&prefix)
                && digest.bytes().all(|byte| byte.is_ascii_hexdigit())
                && matches!(extension, "png" | "json"))
            .then_some(entry.path())
        })
        .collect::<Vec<_>>();
    if matches.len() != 1 {
        return Err("Artifact identity is missing or ambiguous".to_owned());
    }
    let candidate = matches.pop().expect("one verified artifact");
    let metadata =
        fs::symlink_metadata(&candidate).map_err(|_| "Artifact was not found".to_owned())?;
    if metadata.file_type().is_symlink() || !metadata.is_file() {
        return Err("Artifact must be an independent regular file".to_owned());
    }
    let canonical = candidate
        .canonicalize()
        .map_err(|_| "Artifact could not be resolved".to_owned())?;
    if !canonical.starts_with(&canonical_root) {
        return Err("Artifact escaped its content-addressed store".to_owned());
    }
    Ok(canonical)
}

pub(crate) fn import_log_path_for_job(app_data: &Path, job_id: &str) -> Result<PathBuf, String> {
    if !is_sortable_id(job_id, "imp_") {
        return Err("Import job identity is invalid".to_owned());
    }
    let root_metadata =
        fs::symlink_metadata(app_data).map_err(|_| "Memi app data is unavailable".to_owned())?;
    if root_metadata.file_type().is_symlink() || !root_metadata.is_dir() {
        return Err("Memi app data must be a real directory".to_owned());
    }
    let canonical_root = app_data
        .canonicalize()
        .map_err(|_| "Memi app data is unavailable".to_owned())?;
    let jobs = canonical_root.join("import-jobs");
    let job = jobs.join(job_id);
    for directory in [&jobs, &job] {
        let metadata = fs::symlink_metadata(directory)
            .map_err(|_| "Import logs are not available for this job".to_owned())?;
        if metadata.file_type().is_symlink() || !metadata.is_dir() {
            return Err("Import log directory is invalid".to_owned());
        }
    }
    let candidate = job.join("capture.log");
    let metadata = fs::symlink_metadata(&candidate)
        .map_err(|_| "Import logs are not available for this job".to_owned())?;
    if metadata.file_type().is_symlink() || !metadata.is_file() {
        return Err("Import log must be an independent regular file".to_owned());
    }
    let canonical = candidate
        .canonicalize()
        .map_err(|_| "Import log could not be resolved".to_owned())?;
    if !canonical.starts_with(&canonical_root) {
        return Err("Import log escaped Memi app data".to_owned());
    }
    Ok(canonical)
}

fn artifact_http_response(
    artifact_root: &Path,
    method: &tauri::http::Method,
    uri: &tauri::http::Uri,
) -> tauri::http::Response<Vec<u8>> {
    if method != tauri::http::Method::GET
        || uri.query().is_some()
        || uri.host() != Some("localhost")
    {
        return artifact_not_found_response();
    }
    let Some(artifact_id) = uri
        .path()
        .strip_prefix('/')
        .filter(|value| !value.is_empty() && !value.contains('/'))
    else {
        return artifact_not_found_response();
    };
    let Ok(path) = artifact_path_for_id(artifact_root, artifact_id) else {
        return artifact_not_found_response();
    };
    let Ok(metadata) = fs::metadata(&path) else {
        return artifact_not_found_response();
    };
    if metadata.len() == 0
        || metadata.len() > MAX_ARTIFACT_BYTES
        || path.extension().and_then(|value| value.to_str()) != Some("png")
    {
        return artifact_not_found_response();
    }
    let Ok(bytes) = fs::read(path) else {
        return artifact_not_found_response();
    };
    if !bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
        return artifact_not_found_response();
    }
    tauri::http::Response::builder()
        .status(tauri::http::StatusCode::OK)
        .header("cache-control", "private, max-age=31536000, immutable")
        .header("content-type", "image/png")
        .header("x-content-type-options", "nosniff")
        .body(bytes)
        .expect("static artifact response")
}

fn artifact_not_found_response() -> tauri::http::Response<Vec<u8>> {
    tauri::http::Response::builder()
        .status(tauri::http::StatusCode::NOT_FOUND)
        .header("cache-control", "no-store")
        .header("content-type", "text/plain; charset=utf-8")
        .header("x-content-type-options", "nosniff")
        .body(Vec::new())
        .expect("static artifact response")
}

pub(crate) fn artifact_protocol_response(
    state: &RuntimeBridgeState,
    webview_label: &str,
    request: &tauri::http::Request<Vec<u8>>,
) -> tauri::http::Response<Vec<u8>> {
    if webview_label != "main" {
        return artifact_not_found_response();
    }
    artifact_http_response(&state.artifact_root, request.method(), request.uri())
}

#[cfg(test)]
mod tests {
    use super::{
        artifact_http_response, artifact_path_for_id, constant_time_bearer_matches,
        exchange_runtime_rpc_with_lifecycle, import_log_path_for_job, is_secret_key,
        managed_worktree_root, packaged_runtime_sidecar_path, plan_integrity_key,
        runtime_health_envelope, runtime_socket_is_ready, validate_runtime_envelope,
        RuntimeLifecycle,
    };
    use serde_json::json;
    use std::{
        fs,
        os::unix::{fs::PermissionsExt, net::UnixListener, process::CommandExt},
        path::Path,
        process::{Command, Stdio},
        sync::Arc,
        thread,
        time::{Duration, Instant, SystemTime, UNIX_EPOCH},
    };

    fn wait_until(timeout: Duration, condition: impl Fn() -> bool) -> bool {
        let deadline = Instant::now() + timeout;
        while Instant::now() < deadline {
            if condition() {
                return true;
            }
            thread::sleep(Duration::from_millis(10));
        }
        condition()
    }

    fn process_exists(pid: u32) -> bool {
        Command::new("/bin/kill")
            .args(["-0", &pid.to_string()])
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()
            .is_ok_and(|status| status.success())
    }

    #[test]
    #[ignore]
    fn hanging_runtime_sidecar_fixture() {
        let socket_path = std::env::var_os("MEMI_TEST_RUNTIME_SOCKET")
            .expect("fixture socket path must be provided");
        let descendant_pid_path = std::env::var_os("MEMI_TEST_DESCENDANT_PID")
            .expect("fixture descendant pid path must be provided");
        let listener = UnixListener::bind(socket_path).expect("fixture socket should bind");
        let descendant = Command::new("/bin/sleep")
            .arg("300")
            .spawn()
            .expect("fixture descendant should start");
        fs::write(descendant_pid_path, descendant.id().to_string())
            .expect("fixture descendant pid should be recorded");
        let (stream, _) = listener.accept().expect("fixture should accept an RPC");
        let _stream = stream;
        thread::sleep(Duration::from_secs(300));
    }

    #[test]
    fn teardown_cancels_a_hanging_rpc_and_reaps_the_entire_sidecar_group() {
        let root = Path::new("/tmp").join(format!(
            "memi-rt-teardown-{}-{}",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir_all(&root).unwrap();
        let socket_path = root.join("runtime.sock");
        let descendant_pid_path = root.join("descendant.pid");
        let current_test = std::env::current_exe().expect("test executable should resolve");
        let mut command = Command::new(current_test);
        command
            .args([
                "--exact",
                "runtime_bridge::tests::hanging_runtime_sidecar_fixture",
                "--ignored",
                "--nocapture",
            ])
            .env("MEMI_TEST_RUNTIME_SOCKET", &socket_path)
            .env("MEMI_TEST_DESCENDANT_PID", &descendant_pid_path)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .process_group(0);
        let child = command.spawn().expect("fixture sidecar should start");
        let sidecar_pid = child.id();
        assert!(wait_until(Duration::from_secs(3), || {
            socket_path.exists() && descendant_pid_path.exists()
        }));
        let descendant_pid = fs::read_to_string(&descendant_pid_path)
            .unwrap()
            .parse::<u32>()
            .unwrap();
        let lifecycle = Arc::new(RuntimeLifecycle::new(child, socket_path.clone()));
        let rpc_lifecycle = lifecycle.clone();
        let rpc_socket = socket_path.clone();
        let rpc = thread::spawn(move || {
            exchange_runtime_rpc_with_lifecycle(
                &rpc_socket,
                "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
                json!({
                    "schemaVersion": 1,
                    "requestId": "prq_01J00000000000000000000000",
                    "correlationId": "cor_01J00000000000000000000000",
                    "sentAt": "2026-07-30T12:00:00.000Z",
                    "method": "imports.plan",
                    "payload": {}
                }),
                &rpc_lifecycle,
            )
        });

        assert!(wait_until(Duration::from_secs(3), || {
            lifecycle.active_connection_count() == 1
        }));
        lifecycle.shutdown();
        let rpc_result = rpc.join().expect("RPC worker should be released");

        assert!(rpc_result.is_err());
        assert_eq!(lifecycle.active_connection_count(), 0);
        assert!(!Path::new(&socket_path).exists());
        assert!(!process_exists(sidecar_pid));
        assert!(!process_exists(descendant_pid));
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn runtime_readiness_requires_an_actual_unix_socket() {
        let root = Path::new("/tmp").join(format!(
            "memi-rt-ready-{}-{}",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir_all(&root).unwrap();
        let path = root.join("runtime.sock");
        fs::write(&path, b"not a socket").unwrap();
        assert!(!runtime_socket_is_ready(&path));
        fs::remove_file(&path).unwrap();
        let listener = UnixListener::bind(&path).unwrap();
        assert!(runtime_socket_is_ready(&path));
        drop(listener);
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn packaged_runtime_sidecar_is_a_sibling_of_the_bundled_app_executable() {
        assert_eq!(
            packaged_runtime_sidecar_path(Path::new(
                "/Applications/Memi Canvas.app/Contents/MacOS/memi-canvas-macos",
            )),
            Some(
                Path::new("/Applications/Memi Canvas.app/Contents/MacOS/memi-canvas-runtime",)
                    .to_path_buf()
            ),
        );
        assert_eq!(
            packaged_runtime_sidecar_path(Path::new("/workspace/target/debug/memi-canvas-macos",)),
            None,
        );
    }

    #[test]
    fn runtime_health_check_is_an_authenticated_read_only_import_request() {
        assert_eq!(
            validate_runtime_envelope(&runtime_health_envelope()),
            Ok(super::RuntimeEnvelopeBinding {
                request_id: "prq_00000000000000000000000000".to_owned(),
                correlation_id: "cor_00000000000000000000000000".to_owned(),
                method: "imports.list".to_owned(),
            }),
        );
    }

    #[test]
    fn authenticates_only_the_exact_separate_bearer_token() {
        let token = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
        assert!(constant_time_bearer_matches(
            &format!("Bearer {token}"),
            token,
        ));
        assert!(!constant_time_bearer_matches(token, token));
        assert!(!constant_time_bearer_matches(
            "Bearer 0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdee",
            token,
        ));
    }

    #[test]
    fn accepts_only_exact_32_byte_hex_integrity_keys() {
        assert!(is_secret_key(
            "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
        ));
        assert!(!is_secret_key("short"));
        assert!(!is_secret_key(
            "z123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
        ));
    }

    #[test]
    fn persists_a_private_local_plan_integrity_key_without_keychain_access() {
        let root = Path::new("/private/tmp").join(format!(
            "memi-runtime-plan-key-{}-{}",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir_all(root.join("runtime")).unwrap();

        let first = plan_integrity_key(&root).expect("first key should be created");
        let second = plan_integrity_key(&root).expect("key should be reusable");
        let key_path = root.join("runtime").join("plan-integrity-v1.key");

        assert!(is_secret_key(&first));
        assert_eq!(first, second);
        assert_eq!(
            fs::metadata(key_path).unwrap().permissions().mode() & 0o777,
            0o600
        );
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn accepts_only_strict_bounded_runtime_envelopes() {
        let valid = json!({
            "schemaVersion": 1,
            "requestId": "prq_01J00000000000000000000000",
            "correlationId": "cor_01J00000000000000000000000",
            "sentAt": "2026-07-30T12:00:00.000Z",
            "method": "imports.get",
            "payload": {
                "jobId": "imp_01J00000000000000000000000"
            }
        });
        let binding = validate_runtime_envelope(&valid).expect("valid envelope");
        assert_eq!(binding.method, "imports.get");
        assert_eq!(binding.request_id, "prq_01J00000000000000000000000");

        let mut purge = valid.clone();
        purge["method"] = json!("imports.purgeAll");
        purge["payload"] = json!({});
        let purge_binding =
            validate_runtime_envelope(&purge).expect("purge envelope should be bridged");
        assert_eq!(purge_binding.method, "imports.purgeAll");

        let mut canvas_document = valid.clone();
        canvas_document["method"] = json!("canvasDocuments.load");
        canvas_document["payload"] = json!({
            "identity": {
                "projectId": "prj_01J00000000000000000000000",
                "documentId": "doc_01J00000000000000000000000"
            }
        });
        let canvas_document_binding = validate_runtime_envelope(&canvas_document)
            .expect("canvas document envelope should be bridged");
        assert_eq!(canvas_document_binding.method, "canvasDocuments.load");

        let mut unknown = valid.clone();
        unknown
            .as_object_mut()
            .unwrap()
            .insert("authorization".to_owned(), json!("secret"));
        assert!(validate_runtime_envelope(&unknown).is_err());

        let mut unsupported = valid;
        unsupported["method"] = json!("filesystem.read");
        assert!(validate_runtime_envelope(&unsupported).is_err());
    }

    #[test]
    fn artifact_lookup_is_id_only_and_cannot_escape_the_store() {
        let root =
            std::env::temp_dir().join(format!("memi-runtime-artifacts-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        let digest = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
        let directory = root.join("sha256").join("01");
        std::fs::create_dir_all(&directory).unwrap();
        let expected = directory.join(format!("{digest}.png"));
        std::fs::write(&expected, b"\x89PNG\r\n\x1a\nruntime").unwrap();

        let resolved = artifact_path_for_id(&root, "art_0123456789ABCDEF0123456789")
            .expect("artifact should resolve");
        assert_eq!(resolved, expected.canonicalize().unwrap());
        assert!(artifact_path_for_id(&root, "../imports.sqlite").is_err());
        assert!(artifact_path_for_id(&root, "art_0123456789ABCDEF0123456788",).is_err());
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn log_lookup_is_job_id_only_and_rejects_symlinks() {
        let root = std::env::temp_dir().join(format!("memi-runtime-logs-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        let job = "imp_01J00000000000000000000000";
        let directory = root.join("import-jobs").join(job);
        std::fs::create_dir_all(&directory).unwrap();
        let expected = directory.join("capture.log");
        std::fs::write(&expected, b"redacted runtime log").unwrap();
        assert_eq!(
            import_log_path_for_job(&root, job).unwrap(),
            expected.canonicalize().unwrap()
        );
        assert!(import_log_path_for_job(&root, "../other").is_err());
        std::fs::remove_file(&expected).unwrap();
        std::os::unix::fs::symlink("/etc/hosts", &expected).unwrap();
        assert!(import_log_path_for_job(&root, job).is_err());
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn custom_protocol_serves_only_valid_cas_png_artifacts() {
        let root =
            std::env::temp_dir().join(format!("memi-runtime-protocol-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        let digest = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
        let directory = root.join("sha256").join("01");
        std::fs::create_dir_all(&directory).unwrap();
        std::fs::write(
            directory.join(format!("{digest}.png")),
            b"\x89PNG\r\n\x1a\nruntime",
        )
        .unwrap();
        let ok = artifact_http_response(
            &root,
            &tauri::http::Method::GET,
            &"memi-artifact://localhost/art_0123456789ABCDEF0123456789"
                .parse()
                .unwrap(),
        );
        assert_eq!(ok.status(), tauri::http::StatusCode::OK);
        assert_eq!(ok.headers()["content-type"], "image/png");
        assert!(ok.body().starts_with(b"\x89PNG\r\n\x1a\n"));

        for uri in [
            "memi-artifact://localhost/../imports.sqlite",
            "memi-artifact://localhost/art_0123456789ABCDEF0123456789?raw=1",
            "memi-artifact://evil/art_0123456789ABCDEF0123456789",
            "/art_0123456789ABCDEF0123456789",
        ] {
            let response =
                artifact_http_response(&root, &tauri::http::Method::GET, &uri.parse().unwrap());
            assert_eq!(response.status(), tauri::http::StatusCode::NOT_FOUND);
        }
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn artifact_read_limit_matches_the_runtime_store_contract() {
        assert_eq!(super::MAX_ARTIFACT_BYTES, 64 * 1024 * 1024);
    }

    #[test]
    fn managed_worktrees_use_a_shell_safe_cache_child() {
        assert_eq!(
            managed_worktree_root(Path::new("/Users/test/Library/Caches/design.memi.canvas"))
                .unwrap(),
            Path::new("/Users/test/Library/Caches/design.memi.canvas/capture-worktrees"),
        );
        assert!(managed_worktree_root(Path::new(
            "/Users/test/Library/Application Support/design.memi.canvas"
        ))
        .is_err());
    }
}
