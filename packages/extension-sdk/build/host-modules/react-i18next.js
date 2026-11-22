// `react-i18next` inside a trusted extension bundle: the host's instance
// (`window.reactI18next`), already initialized with the host's resources.
const reactI18next = window.reactI18next;

export default reactI18next;
export const {
  I18nContext,
  I18nextProvider,
  Trans,
  Translation,
  getI18n,
  initReactI18next,
  useTranslation,
  withTranslation,
} = reactI18next;
