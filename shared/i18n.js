(function () {
    const localeMeta = {
        he: { label: 'עברית', dir: 'rtl' },
        en: { label: 'English', dir: 'ltr' },
        ar: { label: 'العربية', dir: 'rtl' }
    };

    const fallbackLanguage = 'he';
    const locales = {};
    let currentLanguage = normalizeLanguage(localStorage.getItem('yuvi.language') || fallbackLanguage);

    function normalizeLanguage(language) {
        const short = String(language || fallbackLanguage).slice(0, 2).toLowerCase();
        return localeMeta[short] ? short : fallbackLanguage;
    }

    async function loadLocale(language) {
        const normalized = normalizeLanguage(language);
        if (locales[normalized]) return locales[normalized];
        const response = await fetch(`/locales/${normalized}.json`);
        if (!response.ok) throw new Error(`Missing locale: ${normalized}`);
        locales[normalized] = await response.json();
        return locales[normalized];
    }

    function format(template, params) {
        return String(template).replace(/\{(\w+)\}/g, (_, key) => params?.[key] ?? '');
    }

    function t(key, params = {}) {
        const active = locales[currentLanguage] || {};
        const fallback = locales[fallbackLanguage] || {};
        return format(active[key] ?? fallback[key] ?? key, params);
    }

    function setDocumentLanguage(language) {
        const normalized = normalizeLanguage(language);
        currentLanguage = normalized;
        const meta = localeMeta[normalized];
        document.documentElement.lang = normalized;
        document.documentElement.dir = meta.dir;
        document.body?.setAttribute('dir', meta.dir);
    }

    function applyTranslations(root = document) {
        root.querySelectorAll('[data-i18n]').forEach((element) => {
            element.textContent = t(element.dataset.i18n);
        });
        root.querySelectorAll('[data-i18n-placeholder]').forEach((element) => {
            element.setAttribute('placeholder', t(element.dataset.i18nPlaceholder));
        });
        root.querySelectorAll('[data-i18n-title]').forEach((element) => {
            element.setAttribute('title', t(element.dataset.i18nTitle));
        });
        root.querySelectorAll('[data-i18n-aria-label]').forEach((element) => {
            element.setAttribute('aria-label', t(element.dataset.i18nAriaLabel));
        });
        const titleKey = document.documentElement.dataset.i18nTitle;
        if (titleKey) document.title = t(titleKey);
    }

    async function setLanguage(language, options = {}) {
        const normalized = normalizeLanguage(language);
        localStorage.setItem('yuvi.language', normalized);
        setDocumentLanguage(normalized);
        await loadLocale(normalized);
        applyTranslations();
        if (options.reload) window.location.reload();
    }

    async function init() {
        setDocumentLanguage(currentLanguage);
        await Promise.all([loadLocale(fallbackLanguage), loadLocale(currentLanguage)]);
        applyTranslations();
    }

    window.YuviI18n = {
        ready: init(),
        t,
        setLanguage,
        getLanguage: () => currentLanguage,
        getDirection: () => localeMeta[currentLanguage].dir,
        applyTranslations,
    };
})();