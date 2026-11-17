# Testing & Compatibility Report — GNOME Dynamic Island

**By Lxe Soul**

## Target Specification

- **Target OS**: Ubuntu 26.04 LTS
- **Target Desktop**: GNOME Shell 50.1 (Wayland)
- **Extension Format**: GNOME Shell 50 ES Modules (`Extension`, `ExtensionPreferences`)
- **Author**: By Lxe Soul

## v2.0.0 Architecture & Visual Upgrade Audit

- **Classic Black Idle Hardware Capsule**: When no media player is active and no Pomodoro timer is running, the compact state renders Apple's sleek pitch-black Dynamic Island hardware capsule (`132×30px`, matte sensor dot + dark sapphire camera lens ring) instead of cluttering the screen with volume text.
- **Zero-Corner-Bleed Inset Blur**: `Shell.BlurEffect` is applied exclusively to the `8px`-inset `_expandedView` and `_focusView` containers (`distance(8,8 to 26,26) = 25.45px < 26px`) and `can_focus: false` is enforced on all buttons so zero rectangular edges or focus outlines ever appear on cursor hover.
- **Auto-Measuring Expanded Height**: `_getTargetBounds()` dynamically queries `this._expandedView.get_preferred_height(width)` and sets `height = Math.max(baseTargetH, naturalH + 22)` (`432px` default), guaranteeing the outer border line always encloses the Wi-Fi, Bluetooth, Battery, DND, Night Light, and Utility Bar buttons.
- **Song-Reactive Theme & Circular Artwork**: `MprisService` caches remote `https://` / `file://` / `data:image/` artwork into `/tmp`, extracts the dominant RGB color via `GdkPixbuf`, and themes the island glass, borders, play button, equalizer bars, and active Quick Settings tiles.
- **Interactive Utility & Blur Studio**: Added live in-island Blur `−`/`+` controls (`0..60px`), a 25-minute Pomodoro Focus Timer, one-click Track/Status Clipboard Copy (`St.Clipboard`), and native `/proc/meminfo` + `/proc/loadavg` System Pulse telemetry.

## Automated Verification Executed in Workspace

1. **Metadata Schema Validation (`metadata.json`)**:
   - Verified valid JSON structure, UUID (`dynamic-island@ubuntu26.gnome.org`), `"shell-version": ["50"]`, `"settings-schema"`, and `"session-modes": ["user"]`.
2. **ES Module Syntax Validation**:
   - Verified syntax of `extension.js`, `prefs.js`, and all modules in `src/*.js` (`animationController.js`, `audioService.js`, `brightnessService.js`, `islandWidget.js`, `mprisService.js`, `quickSettingsService.js`, `utils.js`).
3. **GNOME 50 API Compatibility Audit**:
   - Verified zero usage of legacy/deprecated GNOME 3/4x APIs (`imports.ui`, `imports.misc`, `ExtensionUtils`, `Mainloop`, `Tweener`, `Gtk.ColorButton`, `show_all()`, `global.stage.grab()`) and zero invalid CSS `backdrop-filter` rules in `stylesheet.css`.
4. **GSettings Schema Consistency**:
   - Parsed `schemas/org.gnome.shell.extensions.dynamic-island.gschema.xml` (28 declared keys) and verified every key referenced in `extension.js`, `src/islandWidget.js`, `src/utils.js`, and `prefs.js` exists with matching type and bounds.
5. **ZIP Package Build**:
   - Verified generation of installation-ready `dynamic-island@ubuntu26.gnome.org.shell-extension.zip` containing all runtime ES modules, CSS, metadata, compiled `gschemas.compiled`, and GSettings schema XML.
