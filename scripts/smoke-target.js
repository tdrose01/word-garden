export function resolveSmokeTarget(env = process.env) {
  const externalUrl = env.WORD_GARDEN_SMOKE_URL?.trim();

  if (externalUrl) {
    const parsed = new URL(externalUrl);
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      throw new Error('WORD_GARDEN_SMOKE_URL must use http or https');
    }

    return {
      external: true,
      url: parsed.href
    };
  }

  return {
    external: false,
    url: null
  };
}

export function resolveSmokeBrowser(env = process.env, systemChromiumAvailable = false) {
  const configuredPath = env.CHROMIUM_PATH?.trim();

  if (configuredPath) {
    return {
      mode: 'cdp',
      executablePath: configuredPath
    };
  }

  if (env.CI === 'true') {
    return {
      mode: 'playwright',
      executablePath: null
    };
  }

  if (systemChromiumAvailable) {
    return {
      mode: 'cdp',
      executablePath: '/usr/bin/chromium'
    };
  }

  return {
    mode: 'playwright',
    executablePath: null
  };
}
