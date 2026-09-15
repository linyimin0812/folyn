/** Config shape this provider owns. Stored opaquely by the host, keyed by id. */
export interface GithubJsdelivrConfig {
  owner: string;
  repo: string;
  branch: string;
  /** GitHub Personal Access Token (classic `repo` scope, or fine-grained
   *  Contents: write). Stored at ~/.folyn/image-hosts/github-jsdelivr.json. */
  token: string;
  imageKeyPrefix: string;
  htmlKeyPrefix: string;
}

export function defaultConfig(): GithubJsdelivrConfig {
  return { owner: '', repo: '', branch: 'main', token: '', imageKeyPrefix: 'images/', htmlKeyPrefix: 'html/' };
}
