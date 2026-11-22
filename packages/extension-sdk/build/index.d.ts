/** esbuild `alias` map from each module the host shares (react, react-dom,
 *  react-i18next, and lucide-react when `lucideIcons` is given) to the
 *  host's instance. */
export function hostModules(options?: { lucideIcons?: string[] }): Record<string, string>;
