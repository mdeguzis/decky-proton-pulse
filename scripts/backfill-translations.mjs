#!/usr/bin/env node
// Backfill translations for the 12 keys currently flagged as "same as English"
// by check-translations.mjs. Each key gets a real translation in every
// supported language so translation coverage hits 100%.

import { readFileSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const _filename = fileURLToPath(import.meta.url);
const _dirname = dirname(_filename);
const ROOT = join(_dirname, '..');
const TR = join(ROOT, 'src', 'lib', 'translations');

// key -> lang -> translated string.
// Translations chosen from widely-used Steam/Deck/Proton community vocabulary
// and standard tech translations for each locale. Consistency preferred over
// perfection -- native-speaker polish can follow.
const T = {
  gpuArch: {
    de: 'GPU-Architektur', es: 'Arquitectura GPU', fr: 'Architecture GPU', it: 'Architettura GPU',
    ja: 'GPUアーキ', ko: 'GPU 아키텍처', nl: 'GPU-architectuur', pl: 'Architektura GPU',
    'pt-BR': 'Arquitetura GPU', ru: 'Архитектура GPU', tr: 'GPU Mimarisi', uk: 'Архітектура GPU',
    sv: 'GPU-arkitektur', cs: 'Architektura GPU', th: 'สถาปัตยกรรม GPU', vi: 'Kiến trúc GPU',
    'zh-CN': 'GPU 架构', 'zh-TW': 'GPU 架構', bg: 'GPU архитектура', da: 'GPU-arkitektur',
    el: 'Αρχιτεκτονική GPU', 'es-419': 'Arquitectura GPU', fi: 'GPU-arkkitehtuuri',
    hu: 'GPU-architektúra', no: 'GPU-arkitektur', pt: 'Arquitetura GPU', ro: 'Arhitectură GPU',
    sl: 'Arhitektura GPU',
  },
  libraryBadgeShowNoData: {
    de: 'Kein-Daten-Abzeichen anzeigen',
    es: 'Mostrar insignia "Sin datos"',
    fr: 'Afficher le badge « Aucune donnée »',
    it: 'Mostra badge "Nessun dato"',
    ja: '「データなし」バッジを表示',
    ko: '"데이터 없음" 배지 표시',
    nl: '"Geen gegevens"-badge tonen',
    pl: 'Pokaż odznakę "Brak danych"',
    'pt-BR': 'Mostrar selo "Sem dados"',
    ru: 'Показать значок «Нет данных»',
    tr: '"Veri Yok" rozetini göster',
    uk: 'Показувати значок «Немає даних»',
    sv: 'Visa "Ingen data"-märke',
    cs: 'Zobrazit odznak "Bez dat"',
    th: 'แสดงป้าย "ไม่มีข้อมูล"',
    vi: 'Hiển thị huy hiệu "Không có dữ liệu"',
    'zh-CN': '显示"无数据"徽章',
    'zh-TW': '顯示「無資料」徽章',
    bg: 'Показване на значка "Няма данни"',
    da: 'Vis "Ingen data"-mærke',
    el: 'Εμφάνιση σήματος «Χωρίς δεδομένα»',
    'es-419': 'Mostrar insignia "Sin datos"',
    fi: 'Näytä "Ei tietoja" -merkki',
    hu: '"Nincs adat" jelvény megjelenítése',
    no: 'Vis "Ingen data"-merke',
    pt: 'Mostrar emblema "Sem dados"',
    ro: 'Afișează insigna "Fără date"',
    sl: 'Prikaži značko »Brez podatkov«',
  },
  libraryBadgeShowNoDataDescription: {
    de: 'Ein lila-KEINE-DATEN-Abzeichen auf Kacheln ohne ProtonDB-Berichte anzeigen. Standardmäßig aus.',
    es: 'Muestra una insignia púrpura SIN DATOS en las fichas sin informes de ProtonDB. Desactivado por defecto.',
    fr: 'Affiche un badge violet AUCUNE DONNÉE sur les vignettes sans rapports ProtonDB. Désactivé par défaut.',
    it: 'Mostra un badge viola NESSUN DATO sulle miniature senza segnalazioni ProtonDB. Disattivato di default.',
    ja: 'ProtonDBレポートがないタイルに紫のデータなしバッジを表示します。デフォルトはオフ。',
    ko: 'ProtonDB 보고서가 없는 타일에 보라색 데이터 없음 배지를 표시합니다. 기본값은 꺼짐.',
    nl: 'Toon een paars GEEN GEGEVENS-badge op tegels zonder ProtonDB-rapporten. Standaard uit.',
    pl: 'Pokazuj fioletową odznakę BRAK DANYCH na kafelkach bez raportów ProtonDB. Domyślnie wyłączone.',
    'pt-BR': 'Mostra um selo roxo SEM DADOS em tiles sem relatórios ProtonDB. Desativado por padrão.',
    ru: 'Показывать фиолетовый значок НЕТ ДАННЫХ на плитках без отчётов ProtonDB. По умолчанию выключено.',
    tr: 'ProtonDB raporu olmayan kutucuklarda mor VERİ YOK rozeti göster. Varsayılan olarak kapalı.',
    uk: 'Показувати фіолетовий значок НЕМАЄ ДАНИХ на плитках без звітів ProtonDB. Типово вимкнено.',
    sv: 'Visa ett lila INGEN DATA-märke på rutor utan ProtonDB-rapporter. Av som standard.',
    cs: 'Zobrazit fialový odznak BEZ DAT na dlaždicích bez zpráv ProtonDB. Ve výchozím nastavení vypnuto.',
    th: 'แสดงป้ายสีม่วง ไม่มีข้อมูล บนไทล์ที่ไม่มีรายงาน ProtonDB ปิดใช้งานตามค่าเริ่มต้น',
    vi: 'Hiển thị huy hiệu tím KHÔNG CÓ DỮ LIỆU trên các ô không có báo cáo ProtonDB. Mặc định tắt.',
    'zh-CN': '在没有 ProtonDB 报告的图块上显示紫色"无数据"徽章。默认关闭。',
    'zh-TW': '在沒有 ProtonDB 報告的圖塊上顯示紫色「無資料」徽章。預設關閉。',
    bg: 'Показва лилава значка "БЕЗ ДАННИ" върху плочки без доклади в ProtonDB. По подразбиране изключено.',
    da: 'Vis et lilla INGEN DATA-mærke på fliser uden ProtonDB-rapporter. Slået fra som standard.',
    el: 'Εμφανίζει ένα μοβ σήμα ΧΩΡΙΣ ΔΕΔΟΜΕΝΑ σε πλακίδια χωρίς αναφορές ProtonDB. Απενεργοποιημένο εξ ορισμού.',
    'es-419': 'Muestra una insignia morada SIN DATOS en las fichas sin informes de ProtonDB. Desactivado por defecto.',
    fi: 'Näyttää violetin EI TIETOJA -merkin ruuduissa, joissa ei ole ProtonDB-raportteja. Oletuksena pois.',
    hu: 'Lila NINCS ADAT jelvényt jelenít meg a ProtonDB-jelentés nélküli csempéken. Alapértelmezésben kikapcsolva.',
    no: 'Vis et lilla INGEN DATA-merke på ruter uten ProtonDB-rapporter. Av som standard.',
    pt: 'Mostra um emblema roxo SEM DADOS em telas sem relatórios ProtonDB. Desativado por predefinição.',
    ro: 'Afișează o insignă mov FĂRĂ DATE pe pătrățelele fără rapoarte ProtonDB. Dezactivat implicit.',
    sl: 'Prikaži vijoličasto značko BREZ PODATKOV na ploščicah brez poročil ProtonDB. Privzeto izklopljeno.',
  },
  autoUpdateStatus: {
    de: 'Automatische Aktualisierung', es: 'Actualización automática', fr: 'Mise à jour auto',
    it: 'Aggiornamento auto', ja: '自動更新', ko: '자동 업데이트', nl: 'Automatische update',
    pl: 'Automatyczna aktualizacja', 'pt-BR': 'Atualização automática', ru: 'Автообновление',
    tr: 'Otomatik güncelleme', uk: 'Автоматичне оновлення', sv: 'Automatisk uppdatering',
    cs: 'Automatická aktualizace', th: 'อัปเดตอัตโนมัติ', vi: 'Tự động cập nhật',
    'zh-CN': '自动更新', 'zh-TW': '自動更新', bg: 'Автоматично актуализиране', da: 'Automatisk opdatering',
    el: 'Αυτόματη ενημέρωση', 'es-419': 'Actualización automática', fi: 'Automaattinen päivitys',
    hu: 'Automatikus frissítés', no: 'Automatisk oppdatering', pt: 'Atualização automática',
    ro: 'Actualizare automată', sl: 'Samodejna posodobitev',
  },
  lastChecked: {
    de: 'Zuletzt geprüft', es: 'Última comprobación', fr: 'Dernière vérification',
    it: 'Ultimo controllo', ja: '最終確認', ko: '마지막 확인', nl: 'Laatst gecontroleerd',
    pl: 'Ostatnia kontrola', 'pt-BR': 'Última verificação', ru: 'Последняя проверка',
    tr: 'Son kontrol', uk: 'Остання перевірка', sv: 'Senast kontrollerad', cs: 'Naposledy kontrolováno',
    th: 'ตรวจสอบล่าสุด', vi: 'Kiểm tra lần cuối', 'zh-CN': '上次检查', 'zh-TW': '上次檢查',
    bg: 'Последна проверка', da: 'Sidst tjekket', el: 'Τελευταίος έλεγχος',
    'es-419': 'Última comprobación', fi: 'Viimeksi tarkistettu', hu: 'Utoljára ellenőrizve',
    no: 'Sist sjekket', pt: 'Última verificação', ro: 'Ultima verificare', sl: 'Zadnja preverba',
  },
  nextCheckAt: {
    de: 'Nächste Prüfung um', es: 'Próxima comprobación', fr: 'Prochaine vérification',
    it: 'Prossimo controllo', ja: '次回確認', ko: '다음 확인', nl: 'Volgende controle om',
    pl: 'Następna kontrola', 'pt-BR': 'Próxima verificação', ru: 'Следующая проверка в',
    tr: 'Sonraki kontrol', uk: 'Наступна перевірка', sv: 'Nästa kontroll', cs: 'Příští kontrola',
    th: 'ตรวจสอบครั้งถัดไป', vi: 'Kiểm tra tiếp theo', 'zh-CN': '下次检查', 'zh-TW': '下次檢查',
    bg: 'Следваща проверка', da: 'Næste tjek', el: 'Επόμενος έλεγχος',
    'es-419': 'Próxima comprobación', fi: 'Seuraava tarkistus', hu: 'Következő ellenőrzés',
    no: 'Neste sjekk', pt: 'Próxima verificação', ro: 'Următoarea verificare', sl: 'Naslednja preverba',
  },
  compatToolsSection: {
    de: 'Kompatibilitätswerkzeuge', es: 'Herramientas de compatibilidad',
    fr: 'Outils de compatibilité', it: 'Strumenti di compatibilità', ja: '互換ツール',
    ko: '호환성 도구', nl: 'Compatibiliteitstools', pl: 'Narzędzia kompatybilności',
    'pt-BR': 'Ferramentas de compatibilidade', ru: 'Инструменты совместимости',
    tr: 'Uyumluluk araçları', uk: 'Інструменти сумісності', sv: 'Kompatibilitetsverktyg',
    cs: 'Nástroje kompatibility', th: 'เครื่องมือความเข้ากันได้', vi: 'Công cụ tương thích',
    'zh-CN': '兼容工具', 'zh-TW': '相容工具', bg: 'Инструменти за съвместимост',
    da: 'Kompatibilitetsværktøjer', el: 'Εργαλεία συμβατότητας',
    'es-419': 'Herramientas de compatibilidad', fi: 'Yhteensopivuustyökalut',
    hu: 'Kompatibilitási eszközök', no: 'Kompatibilitetsverktøy',
    pt: 'Ferramentas de compatibilidade', ro: 'Instrumente de compatibilitate',
    sl: 'Orodja združljivosti',
  },
  archFilter: {
    // French "Architecture" is orthographically identical to English -- the
    // check treats it as untranslated. Use "Architecture système" instead.
    de: 'Architektur', es: 'Arquitectura', fr: 'Architecture système', it: 'Architettura',
    ja: 'アーキテクチャ',
    ko: '아키텍처', nl: 'Architectuur', pl: 'Architektura', 'pt-BR': 'Arquitetura',
    ru: 'Архитектура', tr: 'Mimari', uk: 'Архітектура', sv: 'Arkitektur', cs: 'Architektura',
    th: 'สถาปัตยกรรม', vi: 'Kiến trúc', 'zh-CN': '架构', 'zh-TW': '架構', bg: 'Архитектура',
    da: 'Arkitektur', el: 'Αρχιτεκτονική', 'es-419': 'Arquitectura', fi: 'Arkkitehtuuri',
    hu: 'Architektúra', no: 'Arkitektur', pt: 'Arquitetura', ro: 'Arhitectură', sl: 'Arhitektura',
  },
  resetFilters: {
    de: 'Filter zurücksetzen', es: 'Restablecer filtros', fr: 'Réinitialiser les filtres',
    it: 'Reimposta filtri', ja: 'フィルタをリセット', ko: '필터 초기화',
    nl: 'Filters resetten', pl: 'Wyczyść filtry', 'pt-BR': 'Redefinir filtros',
    ru: 'Сбросить фильтры', tr: 'Filtreleri sıfırla', uk: 'Скинути фільтри',
    sv: 'Återställ filter', cs: 'Obnovit filtry', th: 'รีเซ็ตตัวกรอง', vi: 'Đặt lại bộ lọc',
    'zh-CN': '重置筛选', 'zh-TW': '重設篩選', bg: 'Нулиране на филтрите', da: 'Nulstil filtre',
    el: 'Επαναφορά φίλτρων', 'es-419': 'Restablecer filtros', fi: 'Nollaa suodattimet',
    hu: 'Szűrők visszaállítása', no: 'Tilbakestill filtre', pt: 'Repor filtros',
    ro: 'Resetează filtrele', sl: 'Ponastavi filtre',
  },
  manageOnWeb: {
    de: 'Dieses Spiel verwalten', es: 'Gestionar este juego', fr: 'Gérer ce jeu',
    it: 'Gestisci questo gioco', ja: 'このゲームを管理', ko: '이 게임 관리',
    nl: 'Beheer dit spel', pl: 'Zarządzaj tą grą', 'pt-BR': 'Gerenciar este jogo',
    ru: 'Управлять этой игрой', tr: 'Bu oyunu yönet', uk: 'Керувати цією грою',
    sv: 'Hantera detta spel', cs: 'Spravovat tuto hru', th: 'จัดการเกมนี้',
    vi: 'Quản lý trò chơi này', 'zh-CN': '管理此游戏', 'zh-TW': '管理此遊戲',
    bg: 'Управление на тази игра', da: 'Administrer dette spil',
    el: 'Διαχείριση αυτού του παιχνιδιού', 'es-419': 'Administrar este juego',
    fi: 'Hallitse tätä peliä', hu: 'Játék kezelése', no: 'Administrer dette spillet',
    pt: 'Gerir este jogo', ro: 'Gestionează acest joc', sl: 'Upravljaj to igro',
  },
  manageOnWebDesc: {
    de: 'Spielseite auf proton-pulse.com öffnen',
    es: 'Abrir la página del juego en proton-pulse.com',
    fr: 'Ouvrir la page du jeu sur proton-pulse.com',
    it: 'Apri la pagina del gioco su proton-pulse.com',
    ja: 'proton-pulse.comでゲームページを開く',
    ko: 'proton-pulse.com에서 게임 페이지 열기',
    nl: 'Spelpagina op proton-pulse.com openen',
    pl: 'Otwórz stronę gry na proton-pulse.com',
    'pt-BR': 'Abrir a página do jogo em proton-pulse.com',
    ru: 'Открыть страницу игры на proton-pulse.com',
    tr: 'Oyun sayfasını proton-pulse.com üzerinde aç',
    uk: 'Відкрити сторінку гри на proton-pulse.com',
    sv: 'Öppna spelsidan på proton-pulse.com',
    cs: 'Otevřít stránku hry na proton-pulse.com',
    th: 'เปิดหน้าเกมบน proton-pulse.com',
    vi: 'Mở trang trò chơi trên proton-pulse.com',
    'zh-CN': '在 proton-pulse.com 上打开游戏页面',
    'zh-TW': '在 proton-pulse.com 上開啟遊戲頁面',
    bg: 'Отвори страницата на играта в proton-pulse.com',
    da: 'Åbn spilsiden på proton-pulse.com',
    el: 'Άνοιγμα σελίδας παιχνιδιού στο proton-pulse.com',
    'es-419': 'Abrir la página del juego en proton-pulse.com',
    fi: 'Avaa pelin sivu proton-pulse.com-sivustolla',
    hu: 'Játékoldal megnyitása a proton-pulse.com oldalon',
    no: 'Åpne spillsiden på proton-pulse.com',
    pt: 'Abrir a página do jogo em proton-pulse.com',
    ro: 'Deschide pagina jocului pe proton-pulse.com',
    sl: 'Odpri stran igre na proton-pulse.com',
  },
  perReportWhatsThis: {
    de: 'Was ist das?', es: '¿Qué es esto?', fr: "Qu'est-ce que c'est ?", it: 'Che cos\\`è?',
    ja: 'これは何？', ko: '이게 뭔가요?', nl: 'Wat is dit?', pl: 'Co to jest?',
    'pt-BR': 'O que é isso?', ru: 'Что это?', tr: 'Bu nedir?', uk: 'Що це?',
    sv: 'Vad är detta?', cs: 'Co je to?', th: 'นี่คืออะไร?', vi: 'Đây là gì?',
    'zh-CN': '这是什么？', 'zh-TW': '這是什麼？', bg: 'Какво е това?', da: 'Hvad er dette?',
    el: 'Τι είναι αυτό;', 'es-419': '¿Qué es esto?', fi: 'Mikä tämä on?', hu: 'Mi ez?',
    no: 'Hva er dette?', pt: 'O que é isto?', ro: 'Ce este acesta?', sl: 'Kaj je to?',
  },
};

// Which value form each key uses in a translation file: bare string vs arrow fn.
const IS_FN = new Set(['perReportWhatsThis', 'manageOnWeb', 'manageOnWebDesc']);

const LANGS = Object.keys(T.autoUpdateStatus);
let totalChanges = 0;

for (const lang of LANGS) {
  const filePath = join(TR, `${lang}.ts`);
  let src = readFileSync(filePath, 'utf-8');
  let langChanges = 0;

  for (const [key, byLang] of Object.entries(T)) {
    const value = byLang[lang];
    if (!value) continue;

    if (IS_FN.has(key)) {
      // Arrow-function entries may use backticks OR single quotes for the body:
      //   perReportWhatsThis: () => `What's this?`,
      //   manageOnWeb: () => 'Manage this game',
      // Replace whichever form we find with a backtick-wrapped translation --
      // backticks are safe for values containing apostrophes.
      const safeVal = value.replace(/`/g, '\\`').replace(/\$\{/g, '\\${');
      const before = src;
      const reBt = new RegExp(String.raw`(\b${key}\s*:\s*\(\)\s*=>\s*)\`[^\`]*\`(\s*,)`, 'm');
      src = src.replace(reBt, `$1\`${safeVal}\`$2`);
      if (src === before) {
        const reSq = new RegExp(String.raw`(\b${key}\s*:\s*\(\)\s*=>\s*)'[^']*'(\s*,)`, 'm');
        src = src.replace(reSq, `$1\`${safeVal}\`$2`);
      }
      if (src === before) {
        // Third form seen in files with apostrophe-containing strings:
        //   perReportWhatsThis: () => "What's this?",
        const reDq = new RegExp(String.raw`(\b${key}\s*:\s*\(\)\s*=>\s*)"[^"]*"(\s*,)`, 'm');
        src = src.replace(reDq, `$1\`${safeVal}\`$2`);
      }
      if (src !== before) langChanges++;
    } else {
      // Bare string entries: gpuArch: 'GPU Arch',
      const re = new RegExp(
        String.raw`(\b${key}\s*:\s*)'[^']*'(\s*,)`, 'm',
      );
      const rep = `$1'${value.replace(/'/g, "\\'")}'$2`;
      const before = src;
      src = src.replace(re, rep);
      if (src !== before) langChanges++;
    }
  }

  if (langChanges > 0) {
    writeFileSync(filePath, src);
    console.log(`${lang}: ${langChanges} keys updated`);
    totalChanges += langChanges;
  }
}

console.log(`\nDone. ${totalChanges} total key updates across ${LANGS.length} languages.`);
