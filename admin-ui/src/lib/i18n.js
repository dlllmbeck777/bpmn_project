const STORAGE_KEY = 'ui_lang'

export const LANGUAGES = [
  { code: 'en', label: 'English', flag: 'EN' },
  { code: 'ru', label: 'Русский', flag: 'RU' },
  { code: 'uz', label: "O'zbek",  flag: 'UZ' },
]

export function getLang() {
  return localStorage.getItem(STORAGE_KEY) || 'ru'
}
export function setLang(code) {
  localStorage.setItem(STORAGE_KEY, code)
  return code
}

const T = {
  en: {
    /* nav groups */
    nav_dashboard:   'Dashboard',
    nav_requestops:  'RequestOps',
    nav_control:     'Control',

    /* nav items */
    page_dashboard:  'Dashboard',
    page_tracker:    'Process tracker',
    page_flowable:   'Flowable engine',
    page_audit:      'Audit log',
    page_requests:   'Requests',
    page_creditops:  'Ops Dashboard',
    page_aicontrol:  'AI Control',
    page_admindash:  'System Dashboard',
    page_control:    'Orchestration',
    page_services:   'Services',
    page_users:      'Users & access',
    page_settings:   'Settings',

    /* page subtitles */
    sub_dashboard:   'Platform overview and health status',
    sub_tracker:     'Trace request steps with waterfall timeline',
    sub_flowable:    'Inspect and manage Flowable instances, jobs and process definitions',
    sub_audit:       'Configuration change history',
    sub_requests:    'Credit check request lifecycle',
    sub_creditops:   'Operational analytics — charts, KPIs and request trends',
    sub_aicontrol:   'OpenAI usage, cost tracking, budget limits and retry policy',
    sub_admindash:   'System health, service registry, circuit breakers and latency',
    sub_control:     'Set routing policy, manage stop factors and pipeline behavior',
    sub_services:    'Manage service registry, URLs and retries',
    sub_users:       'Create users, assign roles, manage sessions',
    sub_settings:    'Workspace preferences, diagnostics, and quick navigation',

    /* ui */
    theme:           'Theme',
    theme_dark:      'Dark',
    theme_light:     'Light',
    logout:          'Log out',
    language:        'Language',
    expand:          'Expand',
    collapse:        'Collapse',
  },

  ru: {
    nav_dashboard:   'Дашборд',
    nav_requestops:  'RequestOps',
    nav_control:     'Контроль',

    page_dashboard:  'Дашборд',
    page_tracker:    'Трекер процессов',
    page_flowable:   'Flowable engine',
    page_audit:      'Журнал аудита',
    page_requests:   'Заявки',
    page_creditops:  'Ops Dashboard',
    page_aicontrol:  'AI Контроль',
    page_admindash:  'Системный дашборд',
    page_control:    'Оркестрация',
    page_services:   'Сервисы',
    page_users:      'Пользователи',
    page_settings:   'Настройки',

    sub_dashboard:   'Обзор платформы и состояние здоровья',
    sub_tracker:     'Трассировка шагов заявки с временной шкалой',
    sub_flowable:    'Управление экземплярами, задачами и процессами Flowable',
    sub_audit:       'История изменений конфигурации',
    sub_requests:    'Жизненный цикл заявок на кредитную проверку',
    sub_creditops:   'Операционная аналитика — графики, KPI и тренды заявок',
    sub_aicontrol:   'Расходы OpenAI, бюджетные лимиты, ретраи и логи вызовов',
    sub_admindash:   'Здоровье системы, сервисы, circuit breakers и латентность',
    sub_control:     'Настройка маршрутизации, стоп-факторов и поведения пайплайна',
    sub_services:    'Управление реестром сервисов, URL и повторными попытками',
    sub_users:       'Создание пользователей, назначение ролей, управление сессиями',
    sub_settings:    'Настройки рабочего пространства, диагностика и навигация',

    theme:           'Тема',
    theme_dark:      'Тёмная',
    theme_light:     'Светлая',
    logout:          'Выйти',
    language:        'Язык',
    expand:          'Развернуть',
    collapse:        'Свернуть',
  },

  uz: {
    nav_dashboard:   'Boshqaruv',
    nav_requestops:  'RequestOps',
    nav_control:     'Nazorat',

    page_dashboard:  'Boshqaruv paneli',
    page_tracker:    'Jarayon kuzatuvchi',
    page_flowable:   'Flowable tizimi',
    page_audit:      'Audit jurnali',
    page_requests:   'Arizalar',
    page_creditops:  'Ops Dashboard',
    page_aicontrol:  'AI Nazorat',
    page_admindash:  'Tizim boshqaruvi',
    page_control:    'Orkestratsiya',
    page_services:   'Xizmatlar',
    page_users:      'Foydalanuvchilar',
    page_settings:   'Sozlamalar',

    sub_dashboard:   'Platforma holati va umumiy ko\'rinish',
    sub_tracker:     'Ariza bosqichlarini vaqt jadvalida kuzatish',
    sub_flowable:    'Flowable nusxalari, ishlar va jarayonlarini boshqarish',
    sub_audit:       'Konfiguratsiya o\'zgarishlari tarixi',
    sub_requests:    'Kredit tekshiruvi arizasining hayot tsikli',
    sub_creditops:   'Operatsion tahlil — grafiklar, KPI va ariza trendlari',
    sub_aicontrol:   'OpenAI sarflari, byudjet limitleri, qayta urinishlar va qo\'ng\'iroq jurnali',
    sub_admindash:   'Tizim holati, xizmatlar, circuit breakers va kechikish',
    sub_control:     'Yo\'naltirish siyosati, to\'xtash omillari va quvur liniyasini sozlash',
    sub_services:    'Xizmat reestri, URL va qayta urinishlarni boshqarish',
    sub_users:       'Foydalanuvchilar yaratish, rollar belgilash, sessiyalarni boshqarish',
    sub_settings:    'Ish maydoni sozlamalari, diagnostika va tezkor navigatsiya',

    theme:           'Mavzu',
    theme_dark:      'Qoʻngʻir',
    theme_light:     'Yorqin',
    logout:          'Chiqish',
    language:        'Til',
    expand:          'Kengaytirish',
    collapse:        'Yig\'ish',
  },
}

export function t(key, lang) {
  return T[lang]?.[key] ?? T.en[key] ?? key
}
