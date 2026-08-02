#[cfg(unix)]
use std::os::unix::fs::MetadataExt;
use std::{
    fs,
    fs::File,
    path::{Component, Path, PathBuf},
    process::Command,
};
use tauri::Manager;
use url::Url;

mod runtime_bridge;
use runtime_bridge::{
    artifact_protocol_response, reveal_import_logs, runtime_artifact, runtime_rpc, runtime_session,
    start_runtime_bridge, RuntimeBridgeState,
};

const RUNTIME_STORAGE_AUTHORITY_MARKER: &str = ".design.memi.canvas-runtime-root-v1";
const RUNTIME_STORAGE_AUTHORITY_PENDING: &str = ".design.memi.canvas-runtime-root-v1.pending";
const RUNTIME_STORAGE_AUTHORITY_LOCK: &str = ".design.memi.canvas-runtime-root-v1.lock";
const RUNTIME_STORAGE_AUTHORITY_BYTES: &[u8] = b"design.memi.canvas runtime storage v1\n";

struct RuntimeStorageAuthority {
    path: PathBuf,
    external_identity: Option<(u64, u64)>,
    lock_identity: Option<(u64, u64)>,
    _lock: Option<File>,
}

impl RuntimeStorageAuthority {
    fn path(&self) -> &Path {
        &self.path
    }

    fn revalidate(&self) -> Result<(), String> {
        let Some((expected_device, expected_inode)) = self.external_identity else {
            return Ok(());
        };
        let metadata = fs::symlink_metadata(&self.path)
            .map_err(|error| format!("Configured runtime storage is unavailable: {error}"))?;
        if metadata.file_type().is_symlink()
            || !metadata.is_dir()
            || metadata.dev() != expected_device
            || metadata.ino() != expected_inode
        {
            return Err("Configured runtime storage changed after validation".to_owned());
        }
        validate_runtime_storage_marker(&self.path)?;
        let Some((expected_lock_device, expected_lock_inode)) = self.lock_identity else {
            return Err("Runtime storage lock authority is missing".to_owned());
        };
        let lock_path = self.path.join(RUNTIME_STORAGE_AUTHORITY_LOCK);
        let lock_metadata = fs::symlink_metadata(&lock_path)
            .map_err(|error| format!("Runtime storage lock could not be inspected: {error}"))?;
        if lock_metadata.file_type().is_symlink()
            || !lock_metadata.is_file()
            || lock_metadata.dev() != expected_lock_device
            || lock_metadata.ino() != expected_lock_inode
        {
            return Err("Runtime storage lock changed after validation".to_owned());
        }
        Ok(())
    }
}

fn open_runtime_storage_lock(root: &Path) -> Result<File, String> {
    let lock_path = root.join(RUNTIME_STORAGE_AUTHORITY_LOCK);
    let lock = match fs::symlink_metadata(&lock_path) {
        Ok(metadata) if metadata.is_file() && !metadata.file_type().is_symlink() => {
            fs::OpenOptions::new()
                .read(true)
                .write(true)
                .open(&lock_path)
        }
        Ok(_) => {
            return Err("Runtime storage lock must be a regular file".to_owned());
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => fs::OpenOptions::new()
            .read(true)
            .write(true)
            .create_new(true)
            .open(&lock_path),
        Err(error) => {
            return Err(format!(
                "Runtime storage lock could not be inspected: {error}"
            ));
        }
    }
    .map_err(|error| format!("Runtime storage authority could not be locked: {error}"))?;
    let handle_metadata = lock
        .metadata()
        .map_err(|error| format!("Runtime storage lock could not be inspected: {error}"))?;
    let path_metadata = fs::symlink_metadata(&lock_path)
        .map_err(|error| format!("Runtime storage lock could not be inspected: {error}"))?;
    if path_metadata.file_type().is_symlink()
        || !path_metadata.is_file()
        || path_metadata.dev() != handle_metadata.dev()
        || path_metadata.ino() != handle_metadata.ino()
    {
        return Err("Runtime storage lock changed during validation".to_owned());
    }
    lock.try_lock()
        .map_err(|error| format!("Runtime storage authority is already in use: {error}"))?;
    Ok(lock)
}

fn validate_runtime_storage_marker(root: &Path) -> Result<(), String> {
    let marker = root.join(RUNTIME_STORAGE_AUTHORITY_MARKER);
    let marker_metadata = fs::symlink_metadata(&marker)
        .map_err(|error| format!("Runtime storage authority could not be inspected: {error}"))?;
    if marker_metadata.file_type().is_symlink() || !marker_metadata.is_file() {
        return Err("Runtime storage authority must be a regular file".to_owned());
    }
    let bytes = fs::read(&marker)
        .map_err(|error| format!("Runtime storage authority could not be read: {error}"))?;
    if bytes != RUNTIME_STORAGE_AUTHORITY_BYTES {
        return Err("Runtime storage authority is invalid".to_owned());
    }
    Ok(())
}

fn claim_runtime_storage_root(
    default_app_data: &Path,
    configured: Option<&std::ffi::OsStr>,
) -> Result<RuntimeStorageAuthority, String> {
    let Some(configured) = configured else {
        return Ok(RuntimeStorageAuthority {
            path: default_app_data.to_path_buf(),
            external_identity: None,
            lock_identity: None,
            _lock: None,
        });
    };
    let requested = PathBuf::from(configured);
    if !requested.is_absolute() || requested.parent().is_none() {
        return Err(
            "Configured runtime storage must be an absolute, non-root directory".to_owned(),
        );
    }
    let metadata = fs::symlink_metadata(&requested)
        .map_err(|error| format!("Configured runtime storage is unavailable: {error}"))?;
    if metadata.file_type().is_symlink() || !metadata.is_dir() {
        return Err("Configured runtime storage must be a real directory".to_owned());
    }
    let canonical = requested
        .canonicalize()
        .map_err(|error| format!("Configured runtime storage is unavailable: {error}"))?;
    let directory_metadata = fs::metadata(&canonical)
        .map_err(|error| format!("Configured runtime storage is unavailable: {error}"))?;
    let lock = open_runtime_storage_lock(&canonical)?;
    let lock_metadata = lock
        .metadata()
        .map_err(|error| format!("Runtime storage lock could not be inspected: {error}"))?;
    let marker = canonical.join(RUNTIME_STORAGE_AUTHORITY_MARKER);
    match fs::symlink_metadata(&marker) {
        Ok(_) => validate_runtime_storage_marker(&canonical)?,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            let pending = canonical.join(RUNTIME_STORAGE_AUTHORITY_PENDING);
            match fs::symlink_metadata(&pending) {
                Ok(pending_metadata)
                    if pending_metadata.is_file() && !pending_metadata.file_type().is_symlink() =>
                {
                    fs::remove_file(&pending).map_err(|error| {
                        format!("Stale runtime storage claim could not be removed: {error}")
                    })?;
                }
                Ok(_) => {
                    return Err("Runtime storage pending authority is invalid".to_owned());
                }
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
                Err(error) => {
                    return Err(format!(
                        "Runtime storage pending authority could not be inspected: {error}"
                    ));
                }
            }
            let has_unclaimed_content = fs::read_dir(&canonical)
                .map_err(|error| {
                    format!("Configured runtime storage could not be inspected: {error}")
                })?
                .filter_map(Result::ok)
                .any(|entry| {
                    entry.file_name() != std::ffi::OsStr::new(RUNTIME_STORAGE_AUTHORITY_LOCK)
                });
            if has_unclaimed_content {
                return Err("Unclaimed runtime storage must be empty".to_owned());
            }
            let mut authority = fs::OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(&pending)
                .map_err(|error| {
                    format!("Runtime storage authority could not be created: {error}")
                })?;
            std::io::Write::write_all(&mut authority, RUNTIME_STORAGE_AUTHORITY_BYTES).map_err(
                |error| format!("Runtime storage authority could not be saved: {error}"),
            )?;
            authority.sync_all().map_err(|error| {
                format!("Runtime storage authority could not be synced: {error}")
            })?;
            fs::rename(&pending, &marker).map_err(|error| {
                format!("Runtime storage authority could not be committed: {error}")
            })?;
            File::open(&canonical)
                .and_then(|directory| directory.sync_all())
                .map_err(|error| {
                    format!("Runtime storage directory could not be synced: {error}")
                })?;
        }
        Err(error) => {
            return Err(format!(
                "Runtime storage authority could not be inspected: {error}"
            ));
        }
    }
    let authority = RuntimeStorageAuthority {
        path: canonical,
        external_identity: Some((directory_metadata.dev(), directory_metadata.ino())),
        lock_identity: Some((lock_metadata.dev(), lock_metadata.ino())),
        _lock: Some(lock),
    };
    authority.revalidate()?;
    Ok(authority)
}

fn validated_local_preview(value: &str) -> Result<Url, String> {
    let url = Url::parse(value).map_err(|_| "Preview URL is invalid".to_owned())?;
    let local_host = matches!(url.host_str(), Some("localhost" | "127.0.0.1"));
    let has_credentials = !url.username().is_empty() || url.password().is_some();
    if url.scheme() != "http" || !local_host || url.port().is_none() || has_credentials {
        return Err(
            "Helium preview must use an explicit HTTP localhost or 127.0.0.1 port".to_owned(),
        );
    }
    Ok(url)
}

#[tauri::command]
fn open_in_helium(url: String) -> Result<(), String> {
    let preview = validated_local_preview(&url)?;
    let status = Command::new("/usr/bin/open")
        .arg("-a")
        .arg("Helium")
        .arg(preview.as_str())
        .status()
        .map_err(|error| format!("Could not launch Helium: {error}"))?;
    if status.success() {
        Ok(())
    } else {
        Err("Helium did not accept the preview URL".to_owned())
    }
}

fn validated_relative_source(value: &str) -> Result<&Path, String> {
    if value.is_empty()
        || value.len() > 1_024
        || value.contains('\\')
        || value.chars().any(char::is_control)
    {
        return Err("Source path is invalid".to_owned());
    }
    let path = Path::new(value);
    if path.is_absolute()
        || !path
            .components()
            .all(|component| matches!(component, Component::Normal(_)))
    {
        return Err("Source path must remain inside the connected project".to_owned());
    }
    Ok(path)
}

fn configured_workspace_root() -> Result<PathBuf, String> {
    if let Some(configured) = std::env::var_os("MEMI_CANVAS_PROJECT_ROOT") {
        return PathBuf::from(configured)
            .canonicalize()
            .map_err(|error| format!("Configured project workspace is unavailable: {error}"));
    }
    Err("No project is connected; import a repository first".to_owned())
}

fn resolved_project_source(root: &Path, source_path: &str) -> Result<PathBuf, String> {
    let relative = validated_relative_source(source_path)?;
    let root = root
        .canonicalize()
        .map_err(|error| format!("Project workspace is unavailable: {error}"))?;
    let candidate = root.join(relative);
    let metadata = std::fs::symlink_metadata(&candidate)
        .map_err(|error| format!("Source file is unavailable: {error}"))?;
    if metadata.file_type().is_symlink() || !metadata.is_file() {
        return Err("Source must be an independent regular file".to_owned());
    }
    let canonical = candidate
        .canonicalize()
        .map_err(|error| format!("Source file could not be resolved: {error}"))?;
    if !canonical.starts_with(&root) {
        return Err("Source path escapes the connected project".to_owned());
    }
    Ok(canonical)
}

fn explicit_workspace_root(root_path: Option<&str>) -> Result<PathBuf, String> {
    match root_path {
        Some(value) if Path::new(value).is_absolute() => PathBuf::from(value)
            .canonicalize()
            .map_err(|error| format!("Connected project is unavailable: {error}")),
        Some(_) => Err("Connected project root must be absolute".to_owned()),
        None => configured_workspace_root(),
    }
}

#[tauri::command]
fn open_in_vscode(source_path: String, root_path: Option<String>) -> Result<(), String> {
    let source = resolved_project_source(
        &explicit_workspace_root(root_path.as_deref())?,
        &source_path,
    )?;
    let status = Command::new("/usr/bin/open")
        .arg("-b")
        .arg("com.microsoft.VSCode")
        .arg(source)
        .status()
        .map_err(|error| format!("Could not launch VS Code: {error}"))?;
    if status.success() {
        Ok(())
    } else {
        Err("VS Code did not accept the source file".to_owned())
    }
}

#[tauri::command]
fn open_in_cursor(source_path: String, root_path: Option<String>) -> Result<(), String> {
    let source = resolved_project_source(
        &explicit_workspace_root(root_path.as_deref())?,
        &source_path,
    )?;
    let status = Command::new("/usr/bin/open")
        .arg("-b")
        .arg("com.todesktop.230313mzl4w4u92")
        .arg(source)
        .status()
        .map_err(|error| format!("Could not launch Cursor: {error}"))?;
    if status.success() {
        Ok(())
    } else {
        Err("Cursor did not accept the source file".to_owned())
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        .register_uri_scheme_protocol("memi-artifact", |context, request| {
            let runtime = context.app_handle().state::<RuntimeBridgeState>();
            artifact_protocol_response(runtime.inner(), context.webview_label(), &request)
        })
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_shell::init())
        .setup(|app| {
            let app_data = app
                .path()
                .app_data_dir()
                .map_err(|error| error.to_string())?;
            let runtime_storage = claim_runtime_storage_root(
                &app_data,
                std::env::var_os("MEMI_CANVAS_RUNTIME_STORAGE_ROOT").as_deref(),
            )
            .map_err(std::io::Error::other)?;
            runtime_storage
                .revalidate()
                .map_err(std::io::Error::other)?;
            let runtime = start_runtime_bridge(app.handle(), runtime_storage.path())
                .map_err(std::io::Error::other)?;
            app.manage(runtime);
            app.manage(runtime_storage);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            open_in_helium,
            open_in_vscode,
            open_in_cursor,
            runtime_session,
            runtime_rpc,
            runtime_artifact,
            reveal_import_logs
        ])
        .build(tauri::generate_context!())
        .expect("Memi Canvas macOS shell failed to start");
    app.run(|app_handle, event| {
        if matches!(event, tauri::RunEvent::Exit) {
            app_handle.state::<RuntimeBridgeState>().shutdown();
        }
    });
}

#[cfg(test)]
mod tests {
    use super::{
        claim_runtime_storage_root, resolved_project_source, validated_local_preview,
        validated_relative_source, RUNTIME_STORAGE_AUTHORITY_BYTES,
        RUNTIME_STORAGE_AUTHORITY_MARKER, RUNTIME_STORAGE_AUTHORITY_PENDING,
    };

    #[test]
    fn accepts_only_explicit_local_http_ports() {
        assert!(validated_local_preview("http://localhost:4173/path").is_ok());
        assert!(validated_local_preview("http://127.0.0.1:5173").is_ok());
        assert!(validated_local_preview("https://localhost:4173").is_err());
        assert!(validated_local_preview("http://example.com:4173").is_err());
        assert!(validated_local_preview("http://user@localhost:4173").is_err());
        assert!(validated_local_preview("http://localhost").is_err());
    }

    #[test]
    fn accepts_only_contained_relative_source_paths() {
        assert!(validated_relative_source("components/ui/Button.tsx").is_ok());
        assert!(validated_relative_source("app/(protected)/(tabs)/dashboard.tsx").is_ok());
        assert!(validated_relative_source("../Secrets.txt").is_err());
        assert!(validated_relative_source("/etc/passwd").is_err());
        assert!(validated_relative_source("components\\Button.tsx").is_err());
        assert!(validated_relative_source("components/\u{0000}Button.tsx").is_err());
    }

    #[test]
    fn resolves_source_against_an_explicit_project_root() {
        let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR"));
        let source =
            resolved_project_source(root, "Cargo.toml").expect("the project source should resolve");
        assert!(source.ends_with("Cargo.toml"));
        assert!(resolved_project_source(root, "../package.json").is_err());
    }

    #[test]
    fn accepts_only_a_real_absolute_runtime_storage_override() {
        let root =
            std::env::temp_dir().join(format!("memi-runtime-storage-{}", std::process::id()));
        let linked = root.with_extension("linked");
        let _ = std::fs::remove_dir_all(&root);
        let _ = std::fs::remove_file(&linked);
        std::fs::create_dir_all(&root).unwrap();
        std::os::unix::fs::symlink(&root, &linked).unwrap();

        let authority = claim_runtime_storage_root(&root, Some(root.as_os_str())).unwrap();
        assert_eq!(authority.path(), root.canonicalize().unwrap());
        authority.revalidate().unwrap();
        assert!(claim_runtime_storage_root(&root, Some(linked.as_os_str())).is_err());
        assert!(
            claim_runtime_storage_root(&root, Some(std::ffi::OsStr::new("relative/runtime")),)
                .is_err()
        );
        let unrelated = root.with_extension("unrelated");
        let _ = std::fs::remove_dir_all(&unrelated);
        std::fs::create_dir_all(&unrelated).unwrap();
        std::fs::write(unrelated.join("personal.txt"), b"keep").unwrap();
        assert!(claim_runtime_storage_root(&root, Some(unrelated.as_os_str()),).is_err());
        assert!(unrelated.join("personal.txt").is_file());

        std::fs::remove_file(linked).unwrap();
        drop(authority);
        std::fs::remove_dir_all(root).unwrap();
        std::fs::remove_dir_all(unrelated).unwrap();
    }

    #[test]
    fn preserves_claimed_runtime_state_and_excludes_concurrent_owners() {
        let root = std::env::temp_dir().join(format!("memi-runtime-state-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(&root).unwrap();

        let authority = claim_runtime_storage_root(&root, Some(root.as_os_str())).unwrap();
        std::fs::write(root.join("projects"), b"live project state").unwrap();
        assert!(claim_runtime_storage_root(&root, Some(root.as_os_str())).is_err());
        authority.revalidate().unwrap();
        assert_eq!(
            std::fs::read(root.join("projects")).unwrap(),
            b"live project state"
        );

        drop(authority);
        let reclaimed = claim_runtime_storage_root(&root, Some(root.as_os_str())).unwrap();
        assert_eq!(
            std::fs::read(root.join("projects")).unwrap(),
            b"live project state"
        );
        drop(reclaimed);
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn recovers_only_an_exact_pending_authority_file() {
        let root =
            std::env::temp_dir().join(format!("memi-runtime-pending-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(&root).unwrap();
        std::fs::write(root.join(RUNTIME_STORAGE_AUTHORITY_PENDING), b"interrupted").unwrap();

        let authority = claim_runtime_storage_root(&root, Some(root.as_os_str())).unwrap();
        assert_eq!(
            std::fs::read(root.join(RUNTIME_STORAGE_AUTHORITY_MARKER)).unwrap(),
            RUNTIME_STORAGE_AUTHORITY_BYTES
        );
        assert!(!root.join(RUNTIME_STORAGE_AUTHORITY_PENDING).exists());

        drop(authority);
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn rejects_symlinked_or_replaced_runtime_locks() {
        let root = std::env::temp_dir().join(format!("memi-runtime-lock-{}", std::process::id()));
        let external = root.with_extension("external-lock");
        let _ = std::fs::remove_dir_all(&root);
        let _ = std::fs::remove_file(&external);
        std::fs::create_dir_all(&root).unwrap();
        std::fs::write(&external, b"outside").unwrap();
        std::os::unix::fs::symlink(&external, root.join(super::RUNTIME_STORAGE_AUTHORITY_LOCK))
            .unwrap();

        assert!(claim_runtime_storage_root(&root, Some(root.as_os_str())).is_err());
        assert_eq!(std::fs::read(&external).unwrap(), b"outside");

        std::fs::remove_file(root.join(super::RUNTIME_STORAGE_AUTHORITY_LOCK)).unwrap();
        let authority = claim_runtime_storage_root(&root, Some(root.as_os_str())).unwrap();
        std::fs::remove_file(root.join(super::RUNTIME_STORAGE_AUTHORITY_LOCK)).unwrap();
        std::fs::write(
            root.join(super::RUNTIME_STORAGE_AUTHORITY_LOCK),
            b"replacement",
        )
        .unwrap();
        assert!(authority.revalidate().is_err());

        drop(authority);
        std::fs::remove_dir_all(root).unwrap();
        std::fs::remove_file(external).unwrap();
    }
}
