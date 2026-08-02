# Memi Canvas app icon

The editable source of truth is
`source/MemiCanvas-Iteration-02.icon`. Keep that Icon Composer bundle intact so
its ruby field, Liquid Glass body, heart layers, and appearance annotations
remain editable.

Tauri currently packages flattened PNG and ICNS files. Generate those files
from the tracked Icon Composer source instead of recreating the mark:

```sh
ICON_TOOL="/Applications/Xcode.app/Contents/Applications/Icon Composer.app/Contents/Executables/ictool"

"$ICON_TOOL" \
  "apps/macos/src-tauri/icons/source/MemiCanvas-Iteration-02.icon" \
  --export-image \
  --output-file "/tmp/MemiCanvas-Iteration-02.png" \
  --platform macOS \
  --rendition Default \
  --width 1024 \
  --height 1024 \
  --scale 1

npm --workspace @memi/macos run tauri -- \
  icon "/tmp/MemiCanvas-Iteration-02.png" \
  --output "/tmp/MemiCanvas-Tauri-icons"
```

Promote only `icon.png` and `icon.icns` from the generated Tauri directory.
Copy the same `icon.png` to
`apps/web/public/memi-canvas-icon.png` so the native bundle, browser favicon,
and in-product brand mark stay synchronized.
