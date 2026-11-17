import Gio from 'gi://Gio';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {SignalTracker, clamp} from './utils.js';

const GSD_POWER_BUS = 'org.gnome.SettingsDaemon.Power';
const GSD_POWER_PATH = '/org/gnome/SettingsDaemon/Power';
const GSD_SCREEN_IFACE = `
<node>
  <interface name="org.gnome.SettingsDaemon.Power.Screen">
    <property name="Brightness" type="i" access="readwrite"/>
    <method name="StepUp">
      <arg type="i" direction="out"/>
      <arg type="s" direction="out"/>
    </method>
    <method name="StepDown">
      <arg type="i" direction="out"/>
      <arg type="s" direction="out"/>
    </method>
  </interface>
</node>`;

const ScreenBrightnessProxy = Gio.DBusProxy.makeProxyWrapper(GSD_SCREEN_IFACE);

/**
 * BrightnessService integrates with GNOME 50's Main.brightnessManager first
 * and falls back to org.gnome.SettingsDaemon.Power.Screen D-Bus proxy,
 * gracefully reporting unsupported status on external desktop displays.
 */
export class BrightnessService {
    constructor(onChange) {
        this._onChange = onChange;
        this._signals = new SignalTracker();
        this._proxy = null;
        this._manager = null;
        this._scale = null;
        this._brightness = -1;
        this._supported = false;
        this._destroyed = false;
    }

    init() {
        if (this._tryInitBrightnessManager())
            return;

        this._initGsdPowerProxy();
    }

    _tryInitBrightnessManager() {
        try {
            const mgr = Main.brightnessManager;
            if (!mgr)
                return false;

            this._manager = mgr;
            const syncManager = () => {
                if (this._destroyed)
                    return;
                try {
                    if (this._scale) {
                        this._signals.disconnectEmitter(this._scale);
                        this._scale = null;
                    }
                    const scale = mgr.globalScale ?? (Array.isArray(mgr.scales) ? mgr.scales[0] : null);
                    if (scale && typeof scale.value === 'number' && Number.isFinite(scale.value)) {
                        this._scale = scale;
                        this._supported = true;
                        this._brightness = clamp(Math.round(scale.value * 100), 0, 100);
                        this._signals.connect(scale, 'notify::value', () => {
                            if (this._destroyed || !this._scale)
                                return;
                            this._brightness = clamp(Math.round(this._scale.value * 100), 0, 100);
                            this._emit();
                        });
                    } else {
                        this._supported = false;
                        this._brightness = -1;
                    }
                } catch {
                    this._supported = false;
                    this._brightness = -1;
                }
                this._emit();
            };

            this._signals.connect(mgr, 'changed', syncManager);
            syncManager();
            return this._supported;
        } catch {
            return false;
        }
    }

    _initGsdPowerProxy() {
        try {
            this._proxy = new ScreenBrightnessProxy(
                Gio.DBus.session,
                GSD_POWER_BUS,
                GSD_POWER_PATH,
                (proxy, error) => {
                    if (this._destroyed || error) {
                        if (!this._supported) {
                            this._supported = false;
                            this._emit();
                        }
                        return;
                    }

                    this._syncFromProxy(proxy);
                    this._signals.connect(proxy, 'g-properties-changed', () => {
                        if (!this._destroyed) {
                            this._syncFromProxy(proxy);
                            this._emit();
                        }
                    });
                    this._emit();
                }
            );
        } catch (err) {
            console.error('[DynamicIsland] Brightness proxy unavailable:', err);
            this._supported = false;
            this._emit();
        }
    }

    _syncFromProxy(proxy) {
        try {
            const val = Number(proxy?.Brightness);
            if (Number.isFinite(val) && val >= 0 && val <= 100) {
                this._brightness = Math.round(val);
                this._supported = true;
            } else if (!this._scale) {
                this._brightness = -1;
                this._supported = false;
            }
        } catch {
            if (!this._scale) {
                this._brightness = -1;
                this._supported = false;
            }
        }
    }

    getState() {
        return {
            supported: this._supported,
            percent: this._supported ? clamp(this._brightness, 0, 100) : 0,
            reason: this._supported ? '' : 'No internal backlight detected',
        };
    }

    setBrightness(percent) {
        if (!this._supported)
            return;

        const target = clamp(Math.round(Number(percent) || 0), 1, 100);
        this._brightness = target;

        try {
            if (this._scale && 'value' in this._scale) {
                this._scale.value = clamp(target / 100, 0.01, 1.0);
                this._emit();
                return;
            }
        } catch {
            // Fall through to proxy
        }

        try {
            if (this._proxy)
                this._proxy.Brightness = target;
        } catch {
            // Ignore proxy write error
        }
        this._emit();
    }

    _emit() {
        if (!this._destroyed) {
            try {
                this._onChange?.(this.getState());
            } catch (err) {
                console.error('[DynamicIsland] BrightnessService onChange error:', err);
            }
        }
    }

    destroy() {
        this._destroyed = true;
        this._signals.disconnectAll();
        this._scale = null;
        this._manager = null;
        this._proxy = null;
    }
}
