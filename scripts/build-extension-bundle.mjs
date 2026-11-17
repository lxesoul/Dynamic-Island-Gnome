import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import JSZip from 'jszip';
import * as esbuild from 'esbuild';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, '..');
const EXT_DIR = path.join(ROOT_DIR, 'extension');
const PUBLIC_DIR = path.join(ROOT_DIR, 'public');
const EXT_DIST_DIR = path.join(EXT_DIR, 'dist');
const GENERATED_DIR = path.join(ROOT_DIR, 'src', 'generated');

const UUID = 'dynamic-island@ubuntu26.gnome.org';
const ZIP_NAME = `${UUID}.shell-extension.zip`;

const EXTENSION_FILES = [
  'metadata.json',
  'extension.js',
  'prefs.js',
  'stylesheet.css',
  'src/animationController.js',
  'src/audioService.js',
  'src/brightnessService.js',
  'src/islandWidget.js',
  'src/mprisService.js',
  'src/quickSettingsService.js',
  'src/utils.js',
  'schemas/org.gnome.shell.extensions.dynamic-island.gschema.xml',
];

const DOC_AND_SCRIPT_FILES = [
  'README.md',
  'TROUBLESHOOTING.md',
  'DEPENDENCIES.md',
  'COMPATIBILITY_REPORT.md',
  'scripts/install.sh',
];

const DEPRECATED_PATTERNS = [
  { pattern: /\bimports\.ui\b/, label: 'Legacy imports.ui (pre-GNOME 45)' },
  { pattern: /\bimports\.misc\b/, label: 'Legacy imports.misc (pre-GNOME 45)' },
  { pattern: /\bExtensionUtils\b/, label: 'Removed ExtensionUtils API' },
  { pattern: /\bMainloop\b/, label: 'Deprecated Mainloop module' },
  { pattern: /\bTweener\b/, label: 'Removed Tweener animation API' },
  { pattern: /\bGtk\.ColorButton\b/, label: 'Deprecated Gtk.ColorButton (use Gtk.ColorDialogButton)' },
  { pattern: /\.show_all\s*\(/, label: 'Removed GTK3 show_all() method' },
  { pattern: /\bvertical\s*:\s*true\b/, label: 'Deprecated St.BoxLayout vertical:true (use orientation: Clutter.Orientation.VERTICAL)' },
  { pattern: /\bglobal\.stage\.grab\s*\(/, label: 'Unsafe global.stage.grab() (can freeze GNOME Shell input)' },
  { pattern: /\.(?:get_outputs|get_inputs|lookup_output_from_stream|lookup_input_from_stream)\s*\(/, label: 'Invalid Gvc.MixerControl method call' },
];

export function compileGSettingsSchema() {
  const schemasDir = path.join(EXT_DIR, 'schemas');
  const compiledPath = path.join(schemasDir, 'gschemas.compiled');
  const candidates = [
    'glib-compile-schemas',
    '/usr/bin/glib-compile-schemas',
    '/usr/lib/x86_64-linux-gnu/glib-2.0/glib-compile-schemas',
    '/usr/lib64/glib-2.0/glib-compile-schemas',
  ];

  for (const bin of candidates) {
    try {
      execFileSync(bin, [schemasDir], { stdio: 'pipe' });
      if (fs.existsSync(compiledPath)) {
        return fs.readFileSync(compiledPath);
      }
    } catch {
      // Try next binary location
    }
  }

  if (fs.existsSync(compiledPath)) {
    return fs.readFileSync(compiledPath);
  }
  return null;
}

export function runExtensionAudit() {
  const metadataPath = path.join(EXT_DIR, 'metadata.json');
  const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));

  const schemaXmlPath = path.join(EXT_DIR, 'schemas/org.gnome.shell.extensions.dynamic-island.gschema.xml');
  const schemaXml = fs.readFileSync(schemaXmlPath, 'utf8');
  const declaredKeys = [...schemaXml.matchAll(/<key\s+name="([^"]+)"/g)].map((m) => m[1]);

  const jsResults = [];
  const referencedKeys = new Set();

  for (const relPath of EXTENSION_FILES) {
    if (!relPath.endsWith('.js')) continue;
    const fullPath = path.join(EXT_DIR, relPath);
    const code = fs.readFileSync(fullPath, 'utf8');

    let syntaxOk = true;
    let syntaxError = null;
    try {
      esbuild.transformSync(code, { loader: 'js', format: 'esm', target: 'es2022' });
    } catch (err) {
      syntaxOk = false;
      syntaxError = String(err);
    }

    const deprecatedHits = DEPRECATED_PATTERNS.filter((item) => item.pattern.test(code)).map(
      (item) => item.label
    );

    // Collect extension GSettings keys referenced on `settings` or `this._settings`
    const keyCallRegex =
      /(?:this\._settings|(?<![a-zA-Z0-9_])settings)\.(?:get_string|get_int|get_double|get_boolean|set_string|set_int|set_double|set_boolean|bind)\(\s*'([a-z0-9-]+)'/g;
    for (const m of code.matchAll(keyCallRegex)) {
      referencedKeys.add(m[1]);
    }

    jsResults.push({
      file: relPath,
      lines: code.split('\n').length,
      syntaxOk,
      syntaxError,
      deprecatedHits,
    });
  }

  const missingSchemaKeys = [...referencedKeys].filter((k) => !declaredKeys.includes(k));
  const stylesheetContent = fs.readFileSync(path.join(EXT_DIR, 'stylesheet.css'), 'utf8');
  const stylesheetClean = !/backdrop-filter\s*:/i.test(stylesheetContent);

  return {
    uuid: metadata.uuid,
    shellVersion: metadata['shell-version'],
    settingsSchema: metadata['settings-schema'],
    metadataValid:
      metadata.uuid === UUID &&
      Array.isArray(metadata['shell-version']) &&
      metadata['shell-version'].includes('50') &&
      metadata['settings-schema'] === 'org.gnome.shell.extensions.dynamic-island',
    declaredSchemaKeys: declaredKeys,
    referencedSchemaKeys: [...referencedKeys],
    missingSchemaKeys,
    jsResults,
    stylesheetClean,
    allSyntaxValid: jsResults.every((r) => r.syntaxOk),
    allGnome50Clean: jsResults.every((r) => r.deprecatedHits.length === 0) && stylesheetClean,
    generatedAt: new Date().toISOString(),
  };
}

async function buildBundle() {
  const compiledSchemaBuffer = compileGSettingsSchema();
  const audit = runExtensionAudit();
  const zip = new JSZip();

  const fileEntries = [];
  for (const relPath of [...EXTENSION_FILES, ...DOC_AND_SCRIPT_FILES]) {
    const fullPath = path.join(EXT_DIR, relPath);
    const content = fs.readFileSync(fullPath, 'utf8');
    fileEntries.push({
      path: relPath,
      content,
      lines: content.split('\n').length,
      bytes: Buffer.byteLength(content, 'utf8'),
      inZip: EXTENSION_FILES.includes(relPath),
    });

    if (EXTENSION_FILES.includes(relPath)) {
      zip.file(relPath, content);
    }
  }

  if (compiledSchemaBuffer) {
    zip.file('schemas/gschemas.compiled', compiledSchemaBuffer);
  }

  const zipBuffer = await zip.generateAsync({
    type: 'nodebuffer',
    compression: 'DEFLATE',
    compressionOptions: { level: 9 },
  });

  fs.mkdirSync(PUBLIC_DIR, { recursive: true });
  fs.mkdirSync(EXT_DIST_DIR, { recursive: true });
  fs.mkdirSync(GENERATED_DIR, { recursive: true });

  fs.writeFileSync(path.join(PUBLIC_DIR, ZIP_NAME), zipBuffer);
  fs.writeFileSync(path.join(EXT_DIST_DIR, ZIP_NAME), zipBuffer);

  const gschemasBase64 = compiledSchemaBuffer ? compiledSchemaBuffer.toString('base64') : '';

  const snapshotTs = `// Auto-generated by scripts/build-extension-bundle.mjs — do not edit manually.
export interface ExtensionFileEntry {
  path: string;
  content: string;
  lines: number;
  bytes: number;
  inZip: boolean;
}

export interface JsAuditEntry {
  file: string;
  lines: number;
  syntaxOk: boolean;
  syntaxError: string | null;
  deprecatedHits: string[];
}

export interface ExtensionAuditReport {
  uuid: string;
  shellVersion: string[];
  settingsSchema: string;
  metadataValid: boolean;
  declaredSchemaKeys: string[];
  referencedSchemaKeys: string[];
  missingSchemaKeys: string[];
  jsResults: JsAuditEntry[];
  stylesheetClean: boolean;
  allSyntaxValid: boolean;
  allGnome50Clean: boolean;
  generatedAt: string;
  zipSizeBytes: number;
  zipFileName: string;
}

export const GSCHEMAS_COMPILED_BASE64 = ${JSON.stringify(gschemasBase64)};

export const EXTENSION_FILES: ExtensionFileEntry[] = ${JSON.stringify(fileEntries, null, 2)};

export const EXTENSION_AUDIT: ExtensionAuditReport = ${JSON.stringify(
    {
      ...audit,
      zipSizeBytes: zipBuffer.length,
      zipFileName: ZIP_NAME,
    },
    null,
    2
  )};
`;

  fs.writeFileSync(path.join(GENERATED_DIR, 'extensionSnapshot.ts'), snapshotTs, 'utf8');
  console.log(
    `Built ${ZIP_NAME} (${zipBuffer.length} bytes), compiledSchema=${Boolean(compiledSchemaBuffer)}, syntax=${audit.allSyntaxValid}, gnome50Clean=${audit.allGnome50Clean}, missingKeys=${audit.missingSchemaKeys.length}`
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  buildBundle().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
