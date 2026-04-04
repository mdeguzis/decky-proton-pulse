// src/lib/translations/ru.ts
import { registerTranslation, type TranslationTree } from '../i18n';

const ru: TranslationTree = {
  common: {
    save: 'Сохранить',
    cancel: 'Отмена',
    loading: 'Загрузка…',
    error: 'Ошибка',
    apply: 'Применить',
    edit: 'Изменить',
    clear: 'Очистить',
    reset: 'Сбросить',
    close: 'Закрыть',
  },
  reports: {
    found: (n) => {
      const mod10 = n % 10;
      const mod100 = n % 100;
      if (mod10 === 1 && mod100 !== 11) return `${n} отчёт найден`;
      if ([2, 3, 4].includes(mod10) && ![12, 13, 14].includes(mod100)) return `${n} отчёта найдено`;
      return `${n} отчётов найдено`;
    },
    noReports: 'Отчёты не найдены',
    confidence: 'Достоверность',
    votes: 'Голоса',
    submitted: 'Отправлено',
    notes: 'Заметки',
  },
  detail: {
    apply: 'Применить',
    edit: 'Изменить',
    upvote: 'Поддержать',
    clear: 'Очистить',
    launchPreview: 'Предпросмотр запуска',
    currentLaunchOptions: 'Текущие параметры запуска',
    noLaunchOptions: 'Параметры запуска не заданы',
    hardwareMatch: 'Совпадение оборудования',
    gpu: 'GPU',
    os: 'ОС',
    kernel: 'Ядро',
    driver: 'Драйвер',
    report: 'Отчёт',
    gpuTier: 'Уровень GPU',
    edited: 'Изменено',
    customVariant: 'Пользовательский вариант',
    protonVersion: 'Версия Proton',
    installing: (v) => `Версия Proton (установка ${v}…)`,
    installed: 'Установлено',
    notInstalled: 'Не установлено',
    unavailable: 'Недоступно',
    valveProton: 'Valve Proton',
    checking: 'Проверка…',
    matchesGpu: 'Соответствует вашему GPU',
    differentGpu: 'Другой GPU',
    unknownGpu: 'Неизвестный GPU',
  },
  editReport: {
    title: 'Изменить отчёт',
    resetToOriginal: 'Сбросить до оригинала',
    label: 'Метка',
    labelDescription: 'Краткая метка для этого отчёта',
    rating: 'Оценка',
    saveEdits: 'Сохранить изменения',
  },
  settings: {
    language: 'Язык',
    autoDetected: (lang) => `Авто (определено: ${lang})`,
    debugLogs: 'Журнал отладки',
    debugLogsDescription: 'Включить подробное ведение журнала отладки',
    general: 'Общие',
    ghToken: 'Токен GitHub',
    ghTokenDescription: 'Персональный токен доступа для отправки голосов',
  },
  compatTools: {
    install: 'Установить',
    uninstall: 'Удалить',
    otherVersion: 'Другая версия',
    installFromZip: 'Установить из ZIP',
    autoUpdate: 'Автообновление',
  },
  configure: {
    quitGameFirst: 'Сначала выйдите из игры',
    applyCancelled: 'Применение отменено',
    noCompatTools: 'Установленные инструменты совместимости недоступны. Вместо этого будет использована необходимая версия.',
    applyFailed: (msg) => `Ошибка применения: ${msg}`,
    setTokenToUpvote: 'Укажите токен GitHub для поддержки',
    voteSubmitted: 'Голос отправлен! Счётчик обновится примерно через 60 с.',
    voteFailed: 'Ошибка голосования. Проверьте значение токена и его разрешения для репозитория/Actions.',
    upvoteFailed: 'Ошибка поддержки — проверьте журналы.',
  },
  toast: {
    installed: (v) => `${v} установлено.`,
    alreadyInstalled: (v) => `${v} уже установлено.`,
    installFailed: (msg) => `Ошибка установки: ${msg}`,
    cleared: 'Параметры запуска очищены.',
    clearFailed: (msg) => `Ошибка очистки: ${msg}`,
    noOptionsSet: 'Параметры запуска не заданы.',
  },
  ratings: {
    platinum: 'Платина',
    gold: 'Золото',
    silver: 'Серебро',
    bronze: 'Бронза',
    borked: 'Не работает',
    pending: 'Ожидание',
  },
};

registerTranslation('ru', ru);
