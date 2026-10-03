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
  let acceptedSubject = null;
  let signInPending = false;
  let clearingSession = false;
  const listeners = new Set();
  const subject = () => clerk?.session ? clerk.session.user?.id || clerk.user?.id || null : null;
  const identity = () => {
    const user = clerk?.session?.user || clerk?.user;
    const primary = user?.primaryEmailAddress?.emailAddress;
    const fallback = user?.primaryEmailAddressId
      ? user?.emailAddresses?.find(address => address?.id === user.primaryEmailAddressId)?.emailAddress
      : null;
    const value = typeof primary === 'string' && primary.trim() ? primary : fallback;
    return typeof value === 'string' && value.trim() ? value.trim() : null;
  };
  const account = () => ({ subject: subject(), identity: identity() });
  const notify = () => listeners.forEach(listener => listener(account()));
  async function clearProviderSession() {
    if (!clerk || clearingSession) return;
    clearingSession = true;
    try { await clerk.signOut(); } finally { clearingSession = false; notify(); }
  }
  async function initialize() {
    if (!ready) ready = (async () => {
      const domain = clerkDomain(publishableKey);
      await load(document, `https://${domain}/npm/@clerk/ui@1/dist/ui.browser.js`);
      await load(document, `https://${domain}/npm/@clerk/clerk-js@6/dist/clerk.browser.js`, publishableKey);
      clerk = window.Clerk;
      if (!clerk?.load) throw new Error('Sign-in could not start. Local progress is unchanged.');
      await clerk.load({ ui: { ClerkUI: window.__internal_ClerkUICtor } });
      clerk.addListener(() => {
        if (clearingSession) return;
        if (acceptedSubject) notify();
        else if (!signInPending && subject()) void clearProviderSession();
      });
      return clerk;
    })().catch(error => { ready = null; throw error; });
    return ready;
  }
  return {
    getSubject: subject,
    getIdentity: identity,
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
      signInPending = true;
      try { await initialize(); } catch (error) { signInPending = false; throw error; }
      if (generation !== operation) throw new Error('Sign-in cancelled. Local progress is unchanged.');
      if (clerk.session && subject()) {
        acceptedSubject = subject(); signInPending = false;
        return account();
      }
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
          signInPending = false;
          if (error) {
            acceptedSubject = null;
            if (subject()) void clearProviderSession();
            reject(error);
          } else {
            acceptedSubject = subject(); resolve(account());
          }
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
    async signOut() {
      ++operation; signInPending = false; acceptedSubject = null; cancelModal?.();
      await clearProviderSession();
    }
  };
}
