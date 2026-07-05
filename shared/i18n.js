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

    function injectLanguageSwitcher() {
        if (document.querySelector('.yuvi-language-switcher')) return;
        const switcher = document.createElement('label');
        switcher.className = 'yuvi-language-switcher';
        switcher.dataset.i18nAriaLabel = 'language.switcherLabel';
        switcher.setAttribute('aria-label', t('language.switcherLabel'));
        switcher.innerHTML = `
            <span data-i18n="language.switcherLabel">${t('language.switcherLabel')}</span>
            <select>
                ${Object.entries(localeMeta).map(([code, meta]) => `<option value="${code}">${meta.label}</option>`).join('')}
            </select>
        `;
        const select = switcher.querySelector('select');
        select.value = currentLanguage;
        select.addEventListener('change', async () => {
            await setLanguage(select.value, { reload: true });
        });
        const appBar = document.querySelector('.app-bar');
        if (appBar) {
            switcher.classList.add('yuvi-language-switcher-inline');
            appBar.appendChild(switcher);
        } else {
            document.body.appendChild(switcher);
        }
    }

    async function setLanguage(language, options = {}) {
        const normalized = normalizeLanguage(language);
        localStorage.setItem('yuvi.language', normalized);
        setDocumentLanguage(normalized);
        await loadLocale(normalized);
        applyTranslations();
        document.querySelectorAll('.yuvi-language-switcher select').forEach((select) => {
            select.value = normalized;
        });
        if (options.reload) window.location.reload();
    }

    async function init() {
        setDocumentLanguage(currentLanguage);
        await Promise.all([loadLocale(fallbackLanguage), loadLocale(currentLanguage)]);
        applyTranslations();
        injectLanguageSwitcher();
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