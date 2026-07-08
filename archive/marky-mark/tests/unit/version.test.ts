import { describe, expect, test } from 'vitest';
import { isValidSemver, setJsonVersion, setCargoVersion } from '../../scripts/release-prepare.mjs';
import pkg from '../../package.json';

describe('version plumbing (SPEC10 §1–§2)', () => {
  test('U16: __APP_VERSION__ matches package.json with pre-release intact; semver validator and version-apply transforms behave', () => {
    // Build-time constant: exactly package.json's version, pre-release included.
    expect(__APP_VERSION__).toBe(pkg.version);
    expect(isValidSemver(__APP_VERSION__)).toBe(true);
    const pre = pkg.version.split('-')[1];
    expect(pre, 'package.json must carry a pre-release identifier in alpha').toBeTruthy();
    expect(__APP_VERSION__.endsWith(`-${pre}`)).toBe(true);

    // Validator: strict semver, pre-release/build metadata allowed.
    for (const ok of ['0.1.0', '1.2.3', '0.2.0-alpha.2', '2.0.0-rc.1', '1.0.0-beta.3+build.7']) {
      expect(isValidSemver(ok), ok).toBe(true);
    }
    for (const bad of ['', '1.2', 'v1.2.3', '01.2.3', '1.2.3-', '1.2.3 ', 'garbage', null, undefined]) {
      expect(isValidSemver(bad as never), String(bad)).toBe(false);
    }

    // JSON transform: rewrites only the top-level version field, idempotently.
    const pkgJson = '{\n  "name": "markimark",\n  "version": "0.2.0-alpha.1",\n  "dependencies": { "react": "^19.0.0" }\n}\n';
    const bumped = setJsonVersion(pkgJson, '0.2.0-alpha.2');
    expect(bumped).toContain('"version": "0.2.0-alpha.2"');
    expect(bumped.replace('"version": "0.2.0-alpha.2"', '"version": "0.2.0-alpha.1"')).toBe(pkgJson);
    expect(setJsonVersion(bumped, '0.2.0-alpha.2')).toBe(bumped);

    // tauri.conf.json: productName and $schema lines untouched.
    const conf = '{\n  "$schema": "https://schema.tauri.app/config/2",\n  "productName": "Marky Mark",\n  "version": "0.2.0-alpha.1",\n  "identifier": "com.markimark.app"\n}\n';
    const confBumped = setJsonVersion(conf, '1.0.0');
    expect(confBumped).toContain('"version": "1.0.0"');
    expect(confBumped).toContain('"productName": "Marky Mark"');
    expect(confBumped).toContain('schema.tauri.app');

    // Cargo.toml transform: only the [package] version line, not dep versions.
    const cargo = '[package]\nname = "markimark"\nversion = "0.2.0-alpha.1"\nedition = "2021"\n\n[dependencies]\ntauri = { version = "2", features = ["protocol-asset"] }\n';
    const cargoBumped = setCargoVersion(cargo, '0.2.0-alpha.2');
    expect(cargoBumped).toContain('version = "0.2.0-alpha.2"');
    expect(cargoBumped).toContain('tauri = { version = "2", features = ["protocol-asset"] }');
    expect(setCargoVersion(cargoBumped, '0.2.0-alpha.2')).toBe(cargoBumped);
  });
});
