export type DirectoryDialog = (options: {
  readonly directory: true;
  readonly multiple: false;
  readonly title: string;
}) => Promise<string | string[] | null>;

export async function chooseRepositoryFolder(
  openDialog?: DirectoryDialog,
): Promise<string | null> {
  if (
    openDialog === undefined &&
    !("__TAURI_INTERNALS__" in globalThis)
  ) {
    return null;
  }
  const open =
    openDialog ??
    (await import("@tauri-apps/plugin-dialog")).open;
  const selected = await open({
    directory: true,
    multiple: false,
    title: "Choose a product repository",
  });
  return typeof selected === "string" ? selected : null;
}
