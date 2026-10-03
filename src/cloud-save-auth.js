// Clerk's script integration: https://clerk.com/docs/js-frontend/getting-started/quickstart
export function clerkDomain(publishableKey) {
  if (!/^pk_(test|live)_[A-Za-z0-9+/=]+$/.test(publishableKey || '')) throw new Error('Online backup is not configured.');
  let domain;
  try { domain = atob(publishableKey.split('_')[2]); } catch { throw new Error('Online backup is not configured.'); }
  if (!domain.endsWith('$')) throw new Error('Online backup is not configured.');
  domain = domain.slice(0, -1);
  if (!/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/i.test(domain)) throw new Error('Online backup is not configured.');
  return domain;
}

function loadScript(document, src, publishableKey) {
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = src; script.async = true; script.crossOrigin = 'anonymous';
    if (publishableKey) script.dataset.clerkPublishableKey = publishableKey;
    const timer = setTimeout(() => { script.remove(); reject(new Error('Sign-in is unavailable. Keep playing on this device.')); }, 15000);
    script.onload = () => { clearTimeout(timer); resolve(); };
    script.onerror = () => { clearTimeout(timer); script.remove(); reject(new Error('Sign-in is offline. Keep playing on this device.')); };
    document.head.appendChild(script);
  });
}

export function createClerkAuth({ publishableKey, document = globalThis.document, window = globalThis.window, load = loadScript }) {
  let ready;
  let clerk;
  let operation = 0;
  let cancelModal = null;
  const listeners = new Set();
  const subject = () => clerk?.session ? clerk.session.user?.id || clerk.user?.id || null : null;
  async function initialize() {
    if (!ready) ready = (async () => {
      const domain = clerkDomain(publishableKey);
      await load(document, `https://${domain}/npm/@clerk/ui@1/dist/ui.browser.js`);
      await load(document, `https://${domain}/npm/@clerk/clerk-js@6/dist/clerk.browser.js`, publishableKey);
      clerk = window.Clerk;
      if (!clerk?.load) throw new Error('Sign-in could not start. Local progress is unchanged.');
      await clerk.load({ ui: { ClerkUI: window.__internal_ClerkUICtor } });
      clerk.addListener(() => listeners.forEach(listener => listener(subject())));
      return clerk;
    })().catch(error => { ready = null; throw error; });
    return ready;
  }
  return {
    getSubject: subject,
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    async getToken(expectedSubject) {
      if (!expectedSubject || subject() !== expectedSubject || !clerk?.session) throw new Error('Your account changed. Check online backup again.');
      const session = clerk.session;
      const token = await session.getToken();
      if (session !== clerk.session || subject() !== expectedSubject) throw new Error('Your account changed. Check online backup again.');
      return token;
    },
    async signIn() {
      const generation = ++operation;
      await initialize();
      if (generation !== operation) throw new Error('Sign-in cancelled. Local progress is unchanged.');
      if (clerk.session && subject()) return { subject: subject() };
      return new Promise((resolve, reject) => {
        const dialog = document.createElement('dialog');
        dialog.className = 'game-panel';
        dialog.setAttribute('aria-label', 'Sign in for optional online backup');
        const cancel = document.createElement('button'); cancel.textContent = 'Cancel sign-in';
        const host = document.createElement('div');
        dialog.append(cancel, host); document.body.appendChild(dialog);
        let unsubscribe = () => {};
        let completed = false;
        const finish = error => {
          if (completed) return;
          completed = true; unsubscribe();
          cancelModal = null;
          clerk.unmountSignIn(host); dialog.close(); dialog.remove();
          if (error) reject(error); else resolve({ subject: subject() });
        };
        cancelModal = () => finish(new Error('Sign-in cancelled. Local progress is unchanged.'));
        cancel.addEventListener('click', () => finish(new Error('Sign-in cancelled. Local progress is unchanged.')));
        dialog.addEventListener('cancel', event => { event.preventDefault(); finish(new Error('Sign-in cancelled. Local progress is unchanged.')); });
        dialog.showModal();
        try {
          clerk.mountSignIn(host, { routing: 'virtual' });
          unsubscribe = clerk.addListener(() => { if (clerk.session && subject()) finish(); }, { skipInitialEmit: true });
          if (clerk.session && subject()) finish();
        } catch (error) { finish(error); }
      });
    },
    async signOut() { ++operation; cancelModal?.(); if (clerk) await clerk.signOut(); }
  };
}
