export function WorkspaceRecoveryBlocked() {
  return (
    <main
      aria-label="Workspace recovery required"
      className="memi-recovery-blocked"
      role="alert"
    >
      <span aria-hidden="true" className="memi-recovery-blocked__mark">
        !
      </span>
      <div>
        <h1>Workspace unavailable</h1>
        <p>
          Memi could not finish its local recovery check. Existing files
          remain unchanged. Relaunch the app to retry safely.
        </p>
      </div>
    </main>
  );
}
