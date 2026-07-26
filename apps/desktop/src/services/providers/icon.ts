/**
 * Provider icon URL map. Globs everything under assets/providers/ and maps
 * filename stem → provider id (most match directly; the two renamed ones
 * are explicit). Custom providers and catalog ids without an asset file
 * fall through to the letter avatar in ModelServicesSettings.
 */

const FILE_STEM_TO_ID: Record<string, string> = {
  azure: 'azure-openai',
  x: 'xai',
};

const allIcons = import.meta.glob<string>('../../assets/providers/*', {
  eager: true,
  query: '?url',
  import: 'default',
});

const iconByUrl: Record<string, string> = {};
for (const [path, url] of Object.entries(allIcons)) {
  const stem = path.split('/').pop()!.replace(/\.[^.]+$/, '');
  const id = FILE_STEM_TO_ID[stem] ?? stem;
  iconByUrl[id] = url;
}

export function providerIconUrl(id: string): string | undefined {
  return iconByUrl[id];
}
