#!/usr/bin/env node
/**
 * Synchronized version & build bump script for CalorieLens.
 *
 * Usage:
 *   npm run version:patch          # 1.0.0 -> 1.0.1 (+1 buildNumber & versionCode)
 *   npm run version:minor          # 1.0.1 -> 1.1.0 (+1 buildNumber & versionCode)
 *   npm run version:major          # 1.1.0 -> 2.0.0 (+1 buildNumber & versionCode)
 *   npm run version:build          # keeps SemVer, increments iOS buildNumber & Android versionCode
 *   node ./scripts/bump-version.mjs 1.2.3
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PACKAGE_JSON_PATH = path.join(ROOT_DIR, 'package.json');
const APP_JSON_PATH = path.join(ROOT_DIR, 'app.json');
const VERSION_TS_PATH = path.join(ROOT_DIR, 'src', 'constants', 'version.ts');
const BACKEND_SERVER_PATH = path.join(ROOT_DIR, 'backend', 'server.py');
const CHANGELOG_PATH = path.join(ROOT_DIR, 'CHANGELOG.md');

const arg = (process.argv[2] || 'patch').trim();
const isDryRun = process.argv.includes('--dry-run');

function parseSemVer(raw) {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(String(raw).trim());
  if (!match) {
    throw new Error(`Invalid SemVer "${raw}". Expected MAJOR.MINOR.PATCH (e.g. 1.0.0).`);
  }
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
  };
}

function computeNextSemVer(current, bumpKind) {
  const v = parseSemVer(current);
  if (bumpKind === 'build') return current;
  if (bumpKind === 'patch') return `${v.major}.${v.minor}.${v.patch + 1}`;
  if (bumpKind === 'minor') return `${v.major}.${v.minor + 1}.0`;
  if (bumpKind === 'major') return `${v.major + 1}.0.0`;
  parseSemVer(bumpKind);
  return bumpKind;
}

function todayIsoDate() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

const pkg = JSON.parse(fs.readFileSync(PACKAGE_JSON_PATH, 'utf8'));
const appJson = JSON.parse(fs.readFileSync(APP_JSON_PATH, 'utf8'));

const prevVersion = appJson.expo?.version || pkg.version || '1.0.0';
const prevIosBuild = parseInt(appJson.expo?.ios?.buildNumber || '1', 10) || 1;
const prevAndroidCode = parseInt(String(appJson.expo?.android?.versionCode || 1), 10) || 1;

if (arg === 'status') {
  console.log(
    `CalorieLens current version: v${prevVersion} (iOS buildNumber=${prevIosBuild}, Android versionCode=${prevAndroidCode})`
  );
  process.exit(0);
}

const nextVersion = computeNextSemVer(prevVersion, arg);
const nextBuild = Math.max(prevIosBuild, prevAndroidCode) + 1;
const releaseDate = todayIsoDate();

if (isDryRun) {
  console.log(
    `[dry-run] CalorieLens would update: v${prevVersion} (Build ${prevIosBuild}) -> v${nextVersion} (Build ${nextBuild})`
  );
  process.exit(0);
}

// 1. Update package.json
pkg.version = nextVersion;
fs.writeFileSync(PACKAGE_JSON_PATH, `${JSON.stringify(pkg, null, 2)}\n`, 'utf8');

// 2. Update app.json
appJson.expo.version = nextVersion;
appJson.expo.ios = {
  ...(appJson.expo.ios || {}),
  buildNumber: String(nextBuild),
};
appJson.expo.android = {
  ...(appJson.expo.android || {}),
  versionCode: nextBuild,
};
appJson.expo.extra = {
  ...(appJson.expo.extra || {}),
  releaseDate,
};
fs.writeFileSync(APP_JSON_PATH, `${JSON.stringify(appJson, null, 2)}\n`, 'utf8');

// 3. Update src/constants/version.ts
if (fs.existsSync(VERSION_TS_PATH)) {
  let versionTs = fs.readFileSync(VERSION_TS_PATH, 'utf8');
  versionTs = versionTs
    .replace(
      /export const FALLBACK_APP_VERSION = '[^']+';/,
      `export const FALLBACK_APP_VERSION = '${nextVersion}';`
    )
    .replace(
      /export const FALLBACK_BUILD_NUMBER = '[^']+';/,
      `export const FALLBACK_BUILD_NUMBER = '${nextBuild}';`
    )
    .replace(
      /export const RELEASE_DATE = '[^']+';/,
      `export const RELEASE_DATE = '${releaseDate}';`
    );
  fs.writeFileSync(VERSION_TS_PATH, versionTs, 'utf8');
}

// 4. Update backend/server.py APP_VERSION
if (fs.existsSync(BACKEND_SERVER_PATH)) {
  let serverPy = fs.readFileSync(BACKEND_SERVER_PATH, 'utf8');
  serverPy = serverPy.replace(
    /APP_VERSION\s*=\s*"[^"]+"/,
    `APP_VERSION = "${nextVersion}"`
  );
  fs.writeFileSync(BACKEND_SERVER_PATH, serverPy, 'utf8');
}

// 5. Prepend CHANGELOG.md section when SemVer changes
if (nextVersion !== prevVersion && fs.existsSync(CHANGELOG_PATH)) {
  const changelog = fs.readFileSync(CHANGELOG_PATH, 'utf8');
  const headerMarker = `## [${nextVersion}]`;
  if (!changelog.includes(headerMarker)) {
    const firstReleaseIdx = changelog.indexOf('\n## [');
    const entry = `\n## [${nextVersion}] - ${releaseDate} (Build ${nextBuild})\n\n### Changed\n- Version bump to v${nextVersion} (Build ${nextBuild}).\n`;
    const updated =
      firstReleaseIdx >= 0
        ? changelog.slice(0, firstReleaseIdx) + entry + changelog.slice(firstReleaseIdx)
        : `${changelog.trimEnd()}\n${entry}`;
    fs.writeFileSync(CHANGELOG_PATH, updated, 'utf8');
  }
}

console.log(
  `✔ CalorieLens version updated: v${prevVersion} (Build ${prevIosBuild}) -> v${nextVersion} (Build ${nextBuild})`
);
