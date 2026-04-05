// src/lib/translations/index.ts
// Import each translation tree and register them explicitly.
// This avoids rollup tree-shaking away side-effect-only imports.
import { registerTranslation } from '../i18n';
import { zhCN } from './zh-CN';
import { ru } from './ru';
import { ptBR } from './pt-BR';
import { de } from './de';
import { es } from './es';
import { fr } from './fr';
import { ja } from './ja';
import { ko } from './ko';
import { tr } from './tr';

registerTranslation('zh-CN', zhCN);
registerTranslation('ru', ru);
registerTranslation('pt-BR', ptBR);
registerTranslation('de', de);
registerTranslation('es', es);
registerTranslation('fr', fr);
registerTranslation('ja', ja);
registerTranslation('ko', ko);
registerTranslation('tr', tr);

export const TRANSLATIONS_LOADED = true;
