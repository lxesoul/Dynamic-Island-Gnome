import Gvc from 'gi://Gvc';
import * as Volume from 'resource:///org/gnome/shell/ui/status/volume.js';

import {SignalTracker, clamp} from './utils.js';

/**
 * AudioService binds directly to GNOME Volume Control (Gvc.MixerControl)
 * backed by PipeWire/PulseAudio on Ubuntu 26.04 LTS.
 * Uses GNOME Shell's shared Volume.getMixerControl() singleton when available
 * and strictly uses real libgnome-volume-control GI methods.
 */
export class AudioService {
    constructor(onChange) {
        this._onChange = onChange;
        this._signals = new SignalTracker();
        this._control = null;
        this._ownsControl = false;
        this._defaultSink = null;
        this._defaultSource = null;
        this._outputIds = new Set();
        this._inputIds = new Set();
        this._destroyed = false;
    }

    init() {
        try {
            if (typeof Volume?.getMixerControl === 'function') {
                this._control = Volume.getMixerControl();
                this._ownsControl = false;
            }
        } catch {
            this._control = null;
        }

        try {
            if (!this._control) {
                this._control = new Gvc.MixerControl({name: 'Dynamic Island Audio'});
                this._ownsControl = true;
            }

            this._signals.connect(this._control, 'state-changed', () => this._refreshStreams());
            this._signals.connect(this._control, 'default-sink-changed', () => this._refreshStreams());
            this._signals.connect(this._control, 'default-source-changed', () => this._refreshStreams());
            this._signals.connect(this._control, 'stream-added', () => this._refreshStreams());
            this._signals.connect(this._control, 'stream-removed', () => this._refreshStreams());

            this._signals.connect(this._control, 'output-added', (_c, id) => {
                if (Number.isFinite(Number(id)))
                    this._outputIds.add(Number(id));
                this._emit();
            });
            this._signals.connect(this._control, 'output-removed', (_c, id) => {
                this._outputIds.delete(Number(id));
                this._emit();
            });
            this._signals.connect(this._control, 'input-added', (_c, id) => {
                if (Number.isFinite(Number(id)))
                    this._inputIds.add(Number(id));
                this._emit();
            });
            this._signals.connect(this._control, 'input-removed', (_c, id) => {
                this._inputIds.delete(Number(id));
                this._emit();
            });
            this._signals.connect(this._control, 'active-output-update', () => this._emit());
            this._signals.connect(this._control, 'active-input-update', () => this._emit());

            if (this._ownsControl && typeof this._control.open === 'function')
                this._control.open();

            this._probeExistingDevices();
            this._refreshStreams();
        } catch (err) {
            console.error('[DynamicIsland] Gvc.MixerControl initialization error:', err);
            this._emit();
        }
    }

    _probeExistingDevices() {
        if (!this._control)
            return;
        try {
            for (let id = 1; id <= 64; id++) {
                try {
                    if (typeof this._control.lookup_output_id === 'function' && this._control.lookup_output_id(id))
                        this._outputIds.add(id);
                } catch {
                    // Ignore invalid id
                }
                try {
                    if (typeof this._control.lookup_input_id === 'function' && this._control.lookup_input_id(id))
                        this._inputIds.add(id);
                } catch {
                    // Ignore invalid id
                }
            }
        } catch {
            // Ignore probe errors
        }
    }

    _isReady() {
        try {
            return Boolean(this._control && this._control.get_state() === Gvc.MixerControlState.READY);
        } catch {
            return false;
        }
    }

    _refreshStreams() {
        if (this._destroyed || !this._control)
            return;

        try {
            if (this._defaultSink) {
                this._signals.disconnectEmitter(this._defaultSink);
                this._defaultSink = null;
            }
            if (this._defaultSource) {
                this._signals.disconnectEmitter(this._defaultSource);
                this._defaultSource = null;
            }

            if (this._isReady()) {
                this._probeExistingDevices();
                this._defaultSink = this._control.get_default_sink?.() ?? null;
                if (this._defaultSink) {
                    this._signals.connect(this._defaultSink, 'notify::volume', () => this._emit());
                    this._signals.connect(this._defaultSink, 'notify::is-muted', () => this._emit());
                }

                this._defaultSource = this._control.get_default_source?.() ?? null;
                if (this._defaultSource) {
                    this._signals.connect(this._defaultSource, 'notify::volume', () => this._emit());
                    this._signals.connect(this._defaultSource, 'notify::is-muted', () => this._emit());
                }
            }
        } catch (err) {
            console.error('[DynamicIsland] Audio stream refresh error:', err);
        }

        this._emit();
    }

    _getDevices(isInput) {
        if (!this._isReady())
            return [];

        const activeStream = isInput ? this._defaultSource : this._defaultSink;
        let activeUiDeviceId = null;

        try {
            if (activeStream && typeof this._control.lookup_device_from_stream === 'function') {
                const uiDev = this._control.lookup_device_from_stream(activeStream);
                if (uiDev && typeof uiDev.get_id === 'function')
                    activeUiDeviceId = uiDev.get_id();
            }
        } catch {
            activeUiDeviceId = null;
        }

        const results = [];
        const idSet = isInput ? this._inputIds : this._outputIds;

        for (const id of idSet) {
            try {
                const device = isInput
                    ? this._control.lookup_input_id?.(id)
                    : this._control.lookup_output_id?.(id);
                if (!device)
                    continue;
                const devId = device.get_id?.() ?? id;
                const desc = device.get_description?.() || '';
                const origin = device.get_origin?.() || '';
                results.push({
                    id: devId,
                    isStreamFallback: false,
                    name: desc || origin || `${isInput ? 'Microphone' : 'Output'} ${devId}`,
                    origin,
                    isActive: activeUiDeviceId !== null ? devId === activeUiDeviceId : false,
                });
            } catch {
                // Skip invalid device
            }
        }

        // Fallback to MixerStream sinks/sources if UI device list is empty
        if (results.length === 0) {
            try {
                const streams = isInput
                    ? (this._control.get_sources?.() ?? [])
                    : (this._control.get_sinks?.() ?? []);
                const activeStreamId = activeStream?.get_id?.() ?? null;
                for (const stream of streams) {
                    if (!stream)
                        continue;
                    const sId = stream.get_id?.() ?? 0;
                    const desc = stream.get_description?.() || stream.get_name?.() || `${isInput ? 'Input' : 'Output'} ${sId}`;
                    results.push({
                        id: sId,
                        isStreamFallback: true,
                        name: desc,
                        origin: '',
                        isActive: activeStreamId !== null ? sId === activeStreamId : false,
                    });
                }
            } catch {
                // Ignore fallback error
            }
        }

        if (results.length > 0 && !results.some(d => d.isActive))
            results[0].isActive = true;

        return results;
    }

    getState() {
        try {
            const ready = this._isReady();
            const maxNorm = (ready && this._control?.get_vol_max_norm)
                ? this._control.get_vol_max_norm()
                : 65536;

            const sinkVol = this._defaultSink?.get_volume?.() ?? 0;
            const sinkPercent = this._defaultSink && maxNorm > 0
                ? Math.round((sinkVol / maxNorm) * 100)
                : 0;

            const sourceVol = this._defaultSource?.get_volume?.() ?? 0;
            const sourcePercent = this._defaultSource && maxNorm > 0
                ? Math.round((sourceVol / maxNorm) * 100)
                : 0;

            const outputs = this._getDevices(false);
            const inputs = this._getDevices(true);

            const defaultSinkName = this._defaultSink?.get_description?.() || 'System Output';
            const defaultSourceName = this._defaultSource?.get_description?.() || 'Microphone';

            return {
                ready,
                hasOutput: Boolean(this._defaultSink),
                volumePercent: clamp(sinkPercent, 0, 100),
                isMuted: Boolean(this._defaultSink?.get_is_muted?.() ?? false),
                activeOutputName: outputs.find(o => o.isActive)?.name ?? (this._defaultSink ? defaultSinkName : 'No Output Device'),
                outputs,
                hasInput: Boolean(this._defaultSource),
                micPercent: clamp(sourcePercent, 0, 100),
                isMicMuted: Boolean(this._defaultSource ? this._defaultSource.get_is_muted?.() : true),
                activeInputName: inputs.find(i => i.isActive)?.name ?? (this._defaultSource ? defaultSourceName : 'No Microphone'),
                inputs,
            };
        } catch (err) {
            console.error('[DynamicIsland] AudioService.getState fallback:', err);
            return {
                ready: false,
                hasOutput: false,
                volumePercent: 0,
                isMuted: false,
                activeOutputName: 'System Audio',
                outputs: [],
                hasInput: false,
                micPercent: 0,
                isMicMuted: true,
                activeInputName: 'No Microphone',
                inputs: [],
            };
        }
    }

    setVolumePercent(percent) {
        try {
            if (!this._control || !this._defaultSink)
                return;
            const maxNorm = this._control.get_vol_max_norm?.() || 65536;
            const clamped = clamp(Number(percent) || 0, 0, 100);
            const targetVol = Math.round((clamped / 100) * maxNorm);

            this._defaultSink.set_volume(targetVol);
            this._defaultSink.push_volume();
            if (clamped > 0 && this._defaultSink.get_is_muted?.())
                this._defaultSink.change_is_muted(false);
            this._emit();
        } catch (err) {
            console.error('[DynamicIsland] setVolumePercent error:', err);
        }
    }

    toggleMute() {
        try {
            if (!this._defaultSink)
                return;
            this._defaultSink.change_is_muted(!this._defaultSink.get_is_muted());
            this._emit();
        } catch (err) {
            console.error('[DynamicIsland] toggleMute error:', err);
        }
    }

    toggleMicMute() {
        try {
            if (!this._defaultSource)
                return;
            this._defaultSource.change_is_muted(!this._defaultSource.get_is_muted());
            this._emit();
        } catch (err) {
            console.error('[DynamicIsland] toggleMicMute error:', err);
        }
    }

    selectOutputDevice(deviceId) {
        try {
            if (!this._control)
                return;
            const uiDevice = this._control.lookup_output_id?.(deviceId);
            if (uiDevice && typeof this._control.change_output === 'function') {
                this._control.change_output(uiDevice);
                this._emit();
                return;
            }
            const stream = this._control.lookup_stream_id?.(deviceId);
            if (stream && typeof this._control.set_default_sink === 'function') {
                this._control.set_default_sink(stream);
                this._emit();
            }
        } catch (err) {
            console.error('[DynamicIsland] selectOutputDevice error:', err);
        }
    }

    selectInputDevice(deviceId) {
        try {
            if (!this._control)
                return;
            const uiDevice = this._control.lookup_input_id?.(deviceId);
            if (uiDevice && typeof this._control.change_input === 'function') {
                this._control.change_input(uiDevice);
                this._emit();
                return;
            }
            const stream = this._control.lookup_stream_id?.(deviceId);
            if (stream && typeof this._control.set_default_source === 'function') {
                this._control.set_default_source(stream);
                this._emit();
            }
        } catch (err) {
            console.error('[DynamicIsland] selectInputDevice error:', err);
        }
    }

    _emit() {
        if (!this._destroyed) {
            try {
                this._onChange?.(this.getState());
            } catch (err) {
                console.error('[DynamicIsland] AudioService onChange error:', err);
            }
        }
    }

    destroy() {
        this._destroyed = true;
        this._signals.disconnectAll();
        this._defaultSink = null;
        this._defaultSource = null;
        this._outputIds.clear();
        this._inputIds.clear();
        if (this._control && this._ownsControl) {
            try {
                this._control.close();
            } catch {
                // Ignore if already closed
            }
        }
        this._control = null;
    }
}
