import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import zh from './zh/translation.json';
import en from './en/translation.json';
import my from './my/translation.json';

const urlLanguage = new URLSearchParams(window.location.search).get('lang');
const savedLanguage = ['zh', 'en', 'my'].includes(urlLanguage)
  ? urlLanguage
  : localStorage.getItem('hx_mm_language') || 'zh';

i18n.use(initReactI18next).init({
  resources: {
    zh: { translation: zh },
    en: { translation: en },
    my: { translation: my },
  },
  lng: savedLanguage,
  fallbackLng: 'zh',
  interpolation: {
    escapeValue: false,
  },
});

i18n.on('languageChanged', (language) => {
  localStorage.setItem('hx_mm_language', language);
});

export default i18n;
