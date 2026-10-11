// API project names and generated pages.dev hostnames are independent values.
const targets = new Map([
  ['word-garden', { hostname: 'word-garden-6fl.pages.dev', selector: '.letter' }],
  ['void-swarm', { hostname: 'void-swarm.pages.dev', selector: 'canvas' }]
]);

export function validatePreviewOrigin(url, project) {
  const target = targets.get(project);
  const pattern = target && new RegExp(
    '^https://[a-z0-9]+\\.' + target.hostname.replaceAll('.', '\\.') + '$'
  );
  if (!target || typeof url !== 'string' ||
      pattern.exec(url)?.[0] !== url) {
    throw new Error('An immutable allow-listed Pages deployment URL is required.');
  }
  return target.selector;
}
