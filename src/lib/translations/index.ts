// src/lib/translations/index.ts
// Import each translation tree and register them explicitly.
// This avoids rollup tree-shaking away side-effect-only imports.
import { registerTranslation } from '../i18n';
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

registerTranslation('zh-CN', zhCN);
registerTranslation('zh-TW', zhTW);
registerTranslation('ru', ru);
registerTranslation('pt-BR', ptBR);
registerTranslation('de', de);
registerTranslation('es', es);
registerTranslation('fr', fr);
registerTranslation('it', it);
registerTranslation('ja', ja);
registerTranslation('ko', ko);
registerTranslation('nl', nl);
registerTranslation('pl', pl);
registerTranslation('tr', tr);
registerTranslation('uk', uk);
registerTranslation('sv', sv);
registerTranslation('cs', cs);
registerTranslation('th', th);
registerTranslation('vi', vi);

export const TRANSLATIONS_LOADED = true;
