// Fixed Pages destinations are distinct from package.json repository names.
const selectors = new Map([
  ['word-garden-6fl', '.letter'],
  ['void-swarm', 'canvas']
]);

export function validatePreviewOrigin(url, project) {
  if (!selectors.has(project) || typeof url !== 'string' ||
      !new RegExp(`^https://[a-z0-9]+\\.${project}\\.pages\\.dev$`).test(url)) {
    throw new Error('An immutable allow-listed Pages deployment URL is required.');
  }
  return selectors.get(project);
}
