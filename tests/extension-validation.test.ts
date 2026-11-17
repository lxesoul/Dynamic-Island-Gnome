import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import JSZip from 'jszip';

import {
  DEFAULT_PREFERENCES,
  clamp,
  computeIslandDimensions,
  computeIslandPosition,
  computeSongTheme,
  formatDurationSeconds,
  getAnimationDurationMs,
  parseHexColor,
  resolveActivePlayer,
  sanitizePreferences,
  type MprisPlayer,
} from '../src/utils/islandLogic';
import { runExtensionAudit } from '../scripts/build-extension-bundle.mjs';

test('formatDurationSeconds handles minutes and hours cleanly', () => {
  assert.equal(formatDurationSeconds(0), '0:00');
  assert.equal(formatDurationSeconds(65), '1:05');
  assert.equal(formatDurationSeconds(3661), '1:01:01');
  assert.equal(formatDurationSeconds(-12), '0:00');
});

test('parseHexColor and computeSongTheme generate dynamic song themes', () => {
  assert.deepEqual(parseHexColor('#1A2B3C'), { r: 26, g: 43, b: 60 });
  assert.deepEqual(parseHexColor('invalid'), { r: 11, g: 14, b: 22 });

  const idleTheme = computeSongTheme(null);
  assert.equal(idleTheme.active, false);

  const weekndTheme = computeSongTheme({
    busName: 'org.mpris.MediaPlayer2.spotify',
    identity: 'Spotify',
    appKind: 'spotify',
    appLabel: 'Spotify',
    status: 'Playing',
    title: 'Die For You',
    artist: 'The Weeknd',
    album: 'Starboy',
    artUrl: 'https://i.scdn.co/image/ab67616d0000b273',
    positionSeconds: 150,
    lengthSeconds: 260,
    canSeek: true,
  });
  assert.equal(weekndTheme.active, true);
  assert.equal(weekndTheme.hex, '#F43F5E');
});

test('resolveActivePlayer prioritizes Spotify desktop over browser sessions', () => {
  const players: MprisPlayer[] = [
    {
      busName: 'org.mpris.MediaPlayer2.firefox.instance123',
      identity: 'Mozilla Firefox',
      appKind: 'firefox',
      appLabel: 'Firefox',
      status: 'Playing',
      title: 'Ambient Mix',
      artist: 'YouTube',
      album: '',
      artUrl: '',
      positionSeconds: 12,
      lengthSeconds: 180,
      canSeek: true,
    },
    {
      busName: 'org.mpris.MediaPlayer2.spotify',
      identity: 'Spotify',
      appKind: 'spotify',
      appLabel: 'Spotify',
      status: 'Playing',
      title: 'Midnight Concrete',
      artist: 'Kiasmos',
      album: 'Blurred',
      artUrl: '',
      positionSeconds: 42,
      lengthSeconds: 245,
      canSeek: true,
    },
  ];

  const chosen = resolveActivePlayer(players, null);
  assert.equal(chosen?.busName, 'org.mpris.MediaPlayer2.spotify');

  const manual = resolveActivePlayer(players, 'org.mpris.MediaPlayer2.firefox.instance123');
  assert.equal(manual?.appKind, 'firefox');
});

test('computeIslandDimensions and computeIslandPosition handle presets and dragged coords', () => {
  const compactMedia = computeIslandDimensions(DEFAULT_PREFERENCES, 'compact', 1440, {
    hasActiveMedia: true,
  });
  assert.equal(compactMedia.borderRadius, 999);
  assert.equal(compactMedia.width, 224);

  const compactIdle = computeIslandDimensions(DEFAULT_PREFERENCES, 'compact', 1440, {
    hasActiveMedia: false,
  });
  assert.equal(compactIdle.width, 152);
  assert.equal(compactIdle.minHeight, 28);

  const hudMusic = computeIslandDimensions(DEFAULT_PREFERENCES, 'hud', 1440, {
    hudKind: 'music',
  });
  assert.equal(hudMusic.minHeight, 74);

  const hudVolume = computeIslandDimensions(DEFAULT_PREFERENCES, 'hud', 1440, {
    hudKind: 'volume',
  });
  assert.equal(hudVolume.width, 268);
  assert.equal(hudVolume.borderRadius, 999);

  const expandedNarrow = computeIslandDimensions(DEFAULT_PREFERENCES, 'expanded', 400);
  assert.equal(expandedNarrow.width, 368);

  const customPos = computeIslandPosition(
    { ...DEFAULT_PREFERENCES, useCustomPosition: true, customX: 2500, customY: 900 },
    compactMedia,
    1152,
    550
  );
  assert.equal(customPos.x, 1152 - 224 - 8);
  assert.equal(customPos.y, 550 - 32 - 8);
});

test('sanitizePreferences clamps glassmorphism, blur, border, shadow, and smart HUD settings', () => {
  assert.equal(DEFAULT_PREFERENCES.backgroundOpacity, 0.04);
  const cleaned = sanitizePreferences({
    compactWidth: 999,
    backgroundOpacity: 0.01,
    blurIntensity: 120,
    borderOpacity: 0.9,
    shadowIntensity: -1,
    autoCollapseDelay: 900,
    backgroundColor: 'not-a-hex',
  });
  assert.equal(cleaned.compactWidth, 420);
  assert.equal(cleaned.backgroundOpacity, 0.04);
  assert.equal(cleaned.blurIntensity, 60);
  assert.equal(cleaned.borderOpacity, 0.45);
  assert.equal(cleaned.shadowIntensity, 0);
  assert.equal(cleaned.autoCollapseDelay, 1200);
  assert.equal(cleaned.backgroundColor, '#0B0E16');
  assert.equal(clamp(120, 0, 100), 100);
  assert.equal(getAnimationDurationMs('fast'), 185);
});

test('GNOME Shell 50.1 extension metadata, ESM syntax, St CSS, schema keys, and API compatibility pass', () => {
  const audit = runExtensionAudit();
  assert.equal(audit.metadataValid, true, 'metadata.json must target GNOME Shell 50 and valid UUID');
  assert.equal(audit.allSyntaxValid, true, 'All extension ES modules must parse cleanly');
  assert.equal(audit.stylesheetClean, true, 'stylesheet.css must not use unsupported web backdrop-filter');
  assert.equal(audit.allGnome50Clean, true, 'No deprecated GNOME 3/4x/48+ APIs allowed');
  assert.deepEqual(audit.missingSchemaKeys, [], 'Every referenced GSettings key must exist in gschema.xml');
  assert.equal(audit.declaredSchemaKeys.length, 28, 'All 28 GSettings keys must be declared');
});

test('Generated installation-ready extension ZIP contains all required runtime files', async () => {
  const zipPath = path.resolve('public/dynamic-island@ubuntu26.gnome.org.shell-extension.zip');
  assert.equal(fs.existsSync(zipPath), true, 'ZIP package must exist in public/');
  const data = fs.readFileSync(zipPath);
  const zip = await JSZip.loadAsync(data);

  const expected = [
    'metadata.json',
    'extension.js',
    'prefs.js',
    'stylesheet.css',
    'src/animationController.js',
    'src/islandWidget.js',
    'src/mprisService.js',
    'src/audioService.js',
    'src/brightnessService.js',
    'src/quickSettingsService.js',
    'src/utils.js',
    'schemas/org.gnome.shell.extensions.dynamic-island.gschema.xml',
    'schemas/gschemas.compiled',
  ];

  for (const file of expected) {
    assert.ok(zip.file(file), `Missing ${file} inside extension ZIP`);
  }
});
