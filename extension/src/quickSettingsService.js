import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import {SignalTracker} from './utils.js';

const UPOWER_BUS = 'org.freedesktop.UPower';
const UPOWER_DISPLAY_PATH = '/org/freedesktop/UPower/devices/DisplayDevice';
const UPOWER_DEVICE_IFACE = `
<node>
  <interface name="org.freedesktop.UPower.Device">
    <property name="IsPresent" type="b" access="read"/>
    <property name="Percentage" type="d" access="read"/>
    <property name="State" type="u" access="read"/>
  </interface>
</node>`;

const GSD_COLOR_BUS = 'org.gnome.SettingsDaemon.Color';
const GSD_COLOR_PATH = '/org/gnome/SettingsDaemon/Color';
const GSD_COLOR_IFACE = `
<node>
  <interface name="org.gnome.SettingsDaemon.Color">
    <property name="NightLightActive" type="b" access="read"/>
  </interface>
</node>`;

const GSD_RFKILL_BUS = 'org.gnome.SettingsDaemon.Rfkill';
const GSD_RFKILL_PATH = '/org/gnome/SettingsDaemon/Rfkill';
const GSD_RFKILL_IFACE = `
<node>
  <interface name="org.gnome.SettingsDaemon.Rfkill">
    <property name="BluetoothAirplaneMode" type="b" access="readwrite"/>
    <property name="BluetoothHasAirplaneMode" type="b" access="read"/>
    <property name="HasAirplaneMode" type="b" access="read"/>
  </interface>
</node>`;

const NM_BUS = 'org.freedesktop.NetworkManager';
const NM_PATH = '/org/freedesktop/NetworkManager';
const NM_IFACE = `
<node>
  <interface name="org.freedesktop.NetworkManager">
    <property name="WirelessEnabled" type="b" access="readwrite"/>
    <property name="WirelessHardwareEnabled" type="b" access="read"/>
    <property name="ActiveConnections" type="ao" access="read"/>
    <method name="GetDevices">
      <arg type="ao" direction="out"/>
    </method>
  </interface>
</node>`;

const UPowerProxy = Gio.DBusProxy.makeProxyWrapper(UPOWER_DEVICE_IFACE);
const ColorProxy = Gio.DBusProxy.makeProxyWrapper(GSD_COLOR_IFACE);
const RfkillProxy = Gio.DBusProxy.makeProxyWrapper(GSD_RFKILL_IFACE);
const NetworkManagerProxy = Gio.DBusProxy.makeProxyWrapper(NM_IFACE);

/**
 * QuickSettingsService binds to real GNOME / Ubuntu 26.04 interfaces:
 * - NetworkManager (Wi-Fi)
 * - BlueZ + Gsd.Rfkill (Bluetooth)
 * - UPower DisplayDevice (Battery)
 * - Gsd.Color + GSettings (Night Light)
 * - org.gnome.desktop.notifications (Do Not Disturb)
 */
export class QuickSettingsService {
    constructor(onChange) {
        this._onChange = onChange;
        this._signals = new SignalTracker();
        this._destroyed = false;

        this._wifiAvailable = true;
        this._wifiEnabled = true;
        this._wifiSsid = 'Wi-Fi';

        this._btAvailable = true;
        this._btEnabled = false;

        this._batteryPresent = false;
        this._batteryPercent = 0;
        this._batteryState = 0;

        this._nightLightEnabled = false;
        this._dndEnabled = false;

        this._nmProxy = null;
        this._rfkillProxy = null;
        this._upowerProxy = null;
        this._colorProxy = null;
        this._colorSettings = null;
        this._notifSettings = null;
    }

    init() {
        this._initNotifications();
        this._initNightLight();
        this._initBattery();
        this._initWifi();
        this._initBluetooth();
    }

    _initNotifications() {
        try {
            this._notifSettings = new Gio.Settings({schema_id: 'org.gnome.desktop.notifications'});
            this._dndEnabled = !this._notifSettings.get_boolean('show-banners');
            this._signals.connect(this._notifSettings, 'changed::show-banners', () => {
                try {
                    this._dndEnabled = !this._notifSettings.get_boolean('show-banners');
                    this._emit();
                } catch {
                    // Ignore
                }
            });
        } catch (err) {
            console.error('[DynamicIsland] Notification GSettings unavailable:', err);
        }
    }

    _initNightLight() {
        try {
            this._colorSettings = new Gio.Settings({schema_id: 'org.gnome.settings-daemon.plugins.color'});
            this._nightLightEnabled = this._colorSettings.get_boolean('night-light-enabled');
            this._signals.connect(this._colorSettings, 'changed::night-light-enabled', () => {
                try {
                    this._nightLightEnabled = this._colorSettings.get_boolean('night-light-enabled');
                    this._emit();
                } catch {
                    // Ignore
                }
            });

            this._colorProxy = new ColorProxy(Gio.DBus.session, GSD_COLOR_BUS, GSD_COLOR_PATH, () => {
                this._emit();
            });
        } catch (err) {
            console.error('[DynamicIsland] Night Light settings unavailable:', err);
        }
    }

    _initBattery() {
        try {
            this._upowerProxy = new UPowerProxy(
                Gio.DBus.system,
                UPOWER_BUS,
                UPOWER_DISPLAY_PATH,
                (proxy, error) => {
                    if (this._destroyed || error) {
                        this._batteryPresent = false;
                        this._emit();
                        return;
                    }
                    const sync = () => {
                        try {
                            this._batteryPresent = Boolean(proxy.IsPresent);
                            this._batteryPercent = Math.round(Number(proxy.Percentage) || 0);
                            this._batteryState = Number(proxy.State) || 0;
                        } catch {
                            this._batteryPresent = false;
                        }
                    };
                    sync();
                    this._signals.connect(proxy, 'g-properties-changed', () => {
                        if (!this._destroyed) {
                            sync();
                            this._emit();
                        }
                    });
                    this._emit();
                }
            );
        } catch {
            this._batteryPresent = false;
        }
    }

    _initWifi() {
        try {
            this._nmProxy = new NetworkManagerProxy(
                Gio.DBus.system,
                NM_BUS,
                NM_PATH,
                (proxy, error) => {
                    if (this._destroyed || error) {
                        this._emit();
                        return;
                    }
                    const sync = () => {
                        try {
                            this._wifiEnabled = Boolean(proxy.WirelessEnabled);
                            this._wifiAvailable = proxy.WirelessHardwareEnabled !== false;
                            this._wifiSsid = this._wifiEnabled ? 'Wi-Fi' : 'Off';
                        } catch {
                            // Keep current state
                        }
                    };
                    sync();
                    this._signals.connect(proxy, 'g-properties-changed', () => {
                        if (!this._destroyed) {
                            sync();
                            this._emit();
                        }
                    });
                    this._emit();
                }
            );
        } catch {
            // Keep default
        }
    }

    _initBluetooth() {
        try {
            this._rfkillProxy = new RfkillProxy(
                Gio.DBus.session,
                GSD_RFKILL_BUS,
                GSD_RFKILL_PATH,
                (proxy, error) => {
                    if (this._destroyed || error) {
                        this._emit();
                        return;
                    }
                    const sync = () => {
                        try {
                            const hasBt = proxy.BluetoothHasAirplaneMode;
                            this._btAvailable = hasBt !== false;
                            this._btEnabled = !Boolean(proxy.BluetoothAirplaneMode);
                        } catch {
                            // Keep current state
                        }
                    };
                    sync();
                    this._signals.connect(proxy, 'g-properties-changed', () => {
                        if (!this._destroyed) {
                            sync();
                            this._emit();
                        }
                    });
                    this._emit();
                }
            );
        } catch {
            // Keep default
        }
    }

    getState() {
        const charging = this._batteryState === 1 || this._batteryState === 4;
        return {
            wifi: {
                available: this._wifiAvailable,
                enabled: this._wifiAvailable && this._wifiEnabled,
                label: !this._wifiAvailable
                    ? 'No Wi-Fi'
                    : (this._wifiEnabled ? 'Wi-Fi' : 'Wi-Fi Off'),
            },
            bluetooth: {
                available: this._btAvailable,
                enabled: this._btAvailable && this._btEnabled,
                label: !this._btAvailable
                    ? 'No BT'
                    : (this._btEnabled ? 'BT On' : 'BT Off'),
            },
            battery: {
                available: this._batteryPresent,
                percent: this._batteryPercent,
                charging,
                label: this._batteryPresent
                    ? `${this._batteryPercent}%${charging ? ' ⚡' : ''}`
                    : 'AC Power',
            },
            nightLight: {
                available: Boolean(this._colorSettings),
                enabled: this._nightLightEnabled,
                activeNow: Boolean(this._colorProxy?.NightLightActive),
            },
            dnd: {
                available: Boolean(this._notifSettings),
                enabled: this._dndEnabled,
            },
        };
    }

    toggleWifi() {
        const next = !this._wifiEnabled;
        this._wifiEnabled = next;
        this._wifiSsid = next ? 'Wi-Fi' : 'Off';
        this._emit();

        try {
            if (this._nmProxy)
                this._nmProxy.WirelessEnabled = next;
        } catch {
            // Ignore proxy setter error
        }

        try {
            Gio.DBus.system.call(
                NM_BUS,
                NM_PATH,
                'org.freedesktop.DBus.Properties',
                'Set',
                new GLib.Variant('(ssv)', [
                    'org.freedesktop.NetworkManager',
                    'WirelessEnabled',
                    new GLib.Variant('b', next),
                ]),
                null,
                Gio.DBusCallFlags.NONE,
                1500,
                null,
                null
            );
        } catch {
            // Ignore D-Bus Set error
        }
    }

    toggleBluetooth() {
        const nextEnabled = !this._btEnabled;
        this._btEnabled = nextEnabled;
        this._emit();

        try {
            if (this._rfkillProxy)
                this._rfkillProxy.BluetoothAirplaneMode = !nextEnabled;
        } catch {
            // Ignore proxy setter error
        }

        try {
            Gio.DBus.session.call(
                GSD_RFKILL_BUS,
                GSD_RFKILL_PATH,
                'org.freedesktop.DBus.Properties',
                'Set',
                new GLib.Variant('(ssv)', [
                    'org.gnome.SettingsDaemon.Rfkill',
                    'BluetoothAirplaneMode',
                    new GLib.Variant('b', !nextEnabled),
                ]),
                null,
                Gio.DBusCallFlags.NONE,
                1500,
                null,
                null
            );
        } catch {
            // Ignore D-Bus Set error
        }
    }

    toggleNightLight() {
        const next = !this._nightLightEnabled;
        this._nightLightEnabled = next;
        this._emit();
        try {
            this._colorSettings?.set_boolean('night-light-enabled', next);
        } catch {
            // Ignore
        }
    }

    toggleDnd() {
        const nextDnd = !this._dndEnabled;
        this._dndEnabled = nextDnd;
        this._emit();
        try {
            this._notifSettings?.set_boolean('show-banners', !nextDnd);
        } catch {
            // Ignore
        }
    }

    _emit() {
        if (!this._destroyed) {
            try {
                this._onChange?.(this.getState());
            } catch (err) {
                console.error('[DynamicIsland] QuickSettingsService onChange error:', err);
            }
        }
    }

    destroy() {
        this._destroyed = true;
        this._signals.disconnectAll();
        this._nmProxy = null;
        this._rfkillProxy = null;
        this._upowerProxy = null;
        this._colorProxy = null;
        this._colorSettings = null;
        this._notifSettings = null;
    }
}
