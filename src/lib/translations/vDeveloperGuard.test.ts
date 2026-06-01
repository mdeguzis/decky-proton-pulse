// Regression test for the "vDeveloper" bug.
//
// Each translator used to hardcode `v${version}` directly. When the backend
// returns a non-numeric version label (e.g. "Developer build (abc1234)" on
// the developer channel), the result was "vDeveloper build (abc1234)" --
// the v prefix only makes sense for semver-style versions.
//
// The fix moved formatVersion() to the call site, and translators now
// interpolate the value verbatim. This test catches future regressions
// where someone re-introduces `v${...}` inside a translator.

import { describe, test, expect } from 'vitest';

import { zhCN } from './zh-CN';
import { zhTW } from './zh-TW';
import { ru } from './ru';
import { ptBR } from './pt-BR';
import { de } from './de';
import { es } from './es';
import { fr } from './fr';
import { it } from './it';
import { ja } from './ja';
import { ko } from './ko';
import { nl } from './nl';
import { pl } from './pl';
import { tr } from './tr';
import { uk } from './uk';
import { sv } from './sv';
import { cs } from './cs';
import { th } from './th';
import { vi } from './vi';
import { bg } from './bg';
import { da } from './da';
import { el } from './el';
import { es419 } from './es-419';
import { fi } from './fi';
import { hu } from './hu';
import { no } from './no';
import { pt } from './pt';
import { ro } from './ro';
import { sl } from './sl';

const TRANSLATIONS: Record<string, any> = {
  'zh-CN': zhCN, 'zh-TW': zhTW, ru, 'pt-BR': ptBR, de, es, fr, it, ja, ko, nl, pl,
  tr, uk, sv, cs, th, vi, bg, da, el, 'es-419': es419, fi, hu, no, pt, ro, sl,
};

// Inputs the caller will pass after the formatVersion fix:
//   - formatVersion("1.7.4") -> "v1.7.4"
//   - formatVersion("Developer build (abc)") -> "Developer build (abc)"
// Translators must interpolate these verbatim. Specifically, they must NEVER
// produce "vDeveloper" by sneaking an extra v in front of a label that
// already lacks one.
const NON_NUMERIC = 'Developer build (abc1234)';
const NUMERIC_FORMATTED = 'v1.7.4';

describe('translators do not prefix bare "v" onto non-numeric versions', () => {
  for (const [locale, t] of Object.entries(TRANSLATIONS)) {
    describe(`locale ${locale}`, () => {
      test('sidebar.about does not produce "vDeveloper"', () => {
        const about = t?.sidebar?.about;
        if (!about) return;
        const out = about(NON_NUMERIC);
        expect(out, `${locale} sidebar.about emitted: ${out}`).not.toMatch(/vDeveloper/);
        expect(about(NUMERIC_FORMATTED)).toContain('v1.7.4');
      });

      test('extras.applyUpdate does not produce "vDeveloper"', () => {
        const applyUpdate = t?.extras?.applyUpdate;
        if (!applyUpdate) return;
        const out = applyUpdate(NON_NUMERIC);
        expect(out, `${locale} extras.applyUpdate emitted: ${out}`).not.toMatch(/vDeveloper/);
      });

      test('extras.updateUpToDate does not produce "vDeveloper"', () => {
        const fn = t?.extras?.updateUpToDate;
        if (!fn) return;
        const out = fn('developer', NON_NUMERIC);
        expect(out, `${locale} extras.updateUpToDate emitted: ${out}`).not.toMatch(/vDeveloper/);
      });

      test('extras.updateAvailable does not produce "vDeveloper"', () => {
        const fn = t?.extras?.updateAvailable;
        if (!fn) return;
        const out = fn(NON_NUMERIC, NON_NUMERIC);
        expect(out, `${locale} extras.updateAvailable emitted: ${out}`).not.toMatch(/vDeveloper/);
      });
    });
  }
});
