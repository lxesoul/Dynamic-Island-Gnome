# Troubleshooting Guide — GNOME Dynamic Island

**By Lxe Soul**

## 1. Inspecting Live Extension Logs

On Ubuntu 26.04 LTS (Wayland), inspect GNOME Shell extension output in real time:

```bash
journalctl -f -o cat /usr/bin/gnome-shell
```

Verify extension registration and state:

```bash
gnome-extensions info dynamic-island@ubuntu26.gnome.org
```

## 2. Extension Does Not Appear After `gnome-extensions install`

- On **Wayland**, GNOME Shell does not hot-reload newly added extension directories inside the running session.
- **Fix**: Log out of your Ubuntu session and log back in, then run:
  ```bash
  gnome-extensions enable dynamic-island@ubuntu26.gnome.org
  ```

## 3. Resetting Cached Height or Custom Dragged Position

If you upgraded from an older build and `dconf` still holds an older cached `expanded-height` or dragged position:

```bash
gsettings reset org.gnome.shell.extensions.dynamic-island expanded-height
gsettings reset org.gnome.shell.extensions.dynamic-island expanded-width
gsettings reset org.gnome.shell.extensions.dynamic-island use-custom-position
```

*(Note: v2.0.0 automatically measures the child layout height and extends the outer border line below all Quick Settings and Utility Bar buttons even if an older `expanded-height` was cached.)*

## 4. Spotify / Browser Artwork & Dynamic Song Theme

- **Remote HTTPS Artwork (`https://i.scdn.co/...`)**: `MprisService` automatically downloads remote cover images asynchronously via `Gio.File.new_for_uri(artUrl).load_contents_async` into `/tmp/di-mpris-art-*` and samples the dominant RGB accent color via `GdkPixbuf`.
- **Snap Spotify**: Ensure the `mpris` slot is connected (`snap connections spotify`).
- **Flatpak Spotify**: Ensure D-Bus session bus access includes `org.mpris.MediaPlayer2.spotify`:
  ```bash
  flatpak override --user --own-name=org.mpris.MediaPlayer2.spotify com.spotify.Client
  ```

## 5. Brightness Slider Shows "Unsupported (External Display)"

- External desktop monitors connected over DisplayPort/HDMI typically do not expose kernel sysfs `/sys/class/backlight/*` interfaces to `org.gnome.SettingsDaemon.Power.Screen`.
- The extension intentionally displays an explicit unsupported state rather than rendering a non-functional slider.

## 6. Schema Errors (`Settings schema 'org.gnome.shell.extensions.dynamic-island' is not installed`)

- Compile schemas inside the extension folder before enabling:
  ```bash
  glib-compile-schemas ~/.local/share/gnome-shell/extensions/dynamic-island@ubuntu26.gnome.org/schemas/
  ```
