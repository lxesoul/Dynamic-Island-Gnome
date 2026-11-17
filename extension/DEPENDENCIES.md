# System & Runtime Dependencies — GNOME Dynamic Island

**By Lxe Soul**

## Target Platform

- **OS**: Ubuntu 26.04 LTS (Resolute Raccoon)
- **Desktop**: GNOME Shell **50.1** (Wayland & X11 sessions)
- **Runtime**: GJS (ESM / ES2022+)

## Required System Packages (Ubuntu 26.04 LTS)

Pre-installed in standard Ubuntu Desktop 26.04:

- `gnome-shell` (>= 50.0, targeted 50.1)
- `libglib2.0-bin` (provides `glib-compile-schemas`)
- `gir1.2-gtk-4.0` (GTK 4 preferences UI)
- `gir1.2-adw-1` (Libadwaita `Adw.PreferencesPage`, `Adw.SpinRow`, `Adw.ComboRow`, `Adw.SwitchRow`, `Adw.ActionRow`)
- `gir1.2-gdkpixbuf-2.0` (GdkPixbuf cover art dominant RGB color sampling)
- `gir1.2-gvc-1.0` / `gnome-shell` bundled `Gvc` typelib (PipeWire / PulseAudio mixer control via `Volume.getMixerControl()`)
- `pipewire`, `wireplumber`, `pipewire-pulse` (system audio routing)
- `network-manager` (NetworkManager D-Bus Wi-Fi state & control)
- `upower` (UPower `DisplayDevice` battery state)
- `gnome-settings-daemon` (`Power.Screen`, `Color` Night Light, `Rfkill` Bluetooth airplane mode)
- `bluez` (optional, for Bluetooth hardware availability)

## Build & Packaging Dependencies (Optional for Source Builds)

```bash
sudo apt install gettext libglib2.0-bin zip
```

No Node.js, npm, or external cloud API keys are required to run the native GNOME Shell extension on Ubuntu 26.04 LTS.
