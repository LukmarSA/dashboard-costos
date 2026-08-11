(function () {
  'use strict';

  const script = document.currentScript;
  const scriptUrl = new URL(script.src, window.location.href);
  const siteRoot = new URL('../', scriptUrl);
  const pageUrl = new URL(window.location.href);
  const requestedBuild = pageUrl.searchParams.get('build') || '';

  document.documentElement.style.visibility = 'hidden';
  window.APP_BUILD = requestedBuild;

  function revealPage() {
    document.documentElement.style.visibility = '';
  }

  function buildUrl(path) {
    const url = new URL(path, window.location.href);
    if (url.origin === window.location.origin && window.APP_BUILD) {
      url.searchParams.set('build', window.APP_BUILD);
    }
    return url.href;
  }

  window.withBuild = buildUrl;
  window.navigateWithBuild = function (path) {
    window.location.assign(buildUrl(path));
  };

  let resolveReady;
  window.APP_BUILD_READY = new Promise(function (resolve) {
    resolveReady = resolve;
  });

  async function loadCurrentBuild() {
    const controller = new AbortController();
    const timeoutId = window.setTimeout(function () {
      controller.abort();
    }, 3000);

    try {
      const manifestUrl = new URL('version.json', siteRoot);
      manifestUrl.searchParams.set('_', Date.now().toString());
      const response = await fetch(manifestUrl.href, {
        cache: 'no-store',
        signal: controller.signal,
      });
      if (!response.ok) {
        throw new Error('HTTP ' + response.status + ' al consultar version.json');
      }

      const manifest = await response.json();
      const currentBuild = typeof manifest.build === 'string' ? manifest.build.trim() : '';
      if (!currentBuild) {
        throw new Error('version.json no contiene un build válido');
      }

      window.APP_BUILD = currentBuild;
      if (requestedBuild !== currentBuild) {
        pageUrl.searchParams.set('build', currentBuild);
        window.location.replace(pageUrl.href);
        return;
      }

      revealPage();
      resolveReady(currentBuild);
    } catch (error) {
      console.warn('[version-guard] No se pudo comprobar la versión actual.', error);
      revealPage();
      resolveReady(requestedBuild || null);
    } finally {
      window.clearTimeout(timeoutId);
    }
  }

  function rewriteInternalLinks(root) {
    const links = root.querySelectorAll ? root.querySelectorAll('a[href]') : [];
    links.forEach(function (link) {
      const href = link.getAttribute('href');
      if (!href || href.startsWith('#') || href.startsWith('mailto:') ||
          href.startsWith('tel:') || href.startsWith('javascript:')) return;

      const url = new URL(href, window.location.href);
      if (url.origin !== window.location.origin) return;
      link.href = buildUrl(url.href);
    });
  }

  document.addEventListener('DOMContentLoaded', function () {
    window.APP_BUILD_READY.then(function () {
      rewriteInternalLinks(document);
      const observer = new MutationObserver(function (mutations) {
        mutations.forEach(function (mutation) {
          mutation.addedNodes.forEach(function (node) {
            if (node.nodeType !== Node.ELEMENT_NODE) return;
            if (node.matches && node.matches('a[href]')) rewriteInternalLinks(node.parentNode);
            else rewriteInternalLinks(node);
          });
        });
      });
      observer.observe(document.body, { childList: true, subtree: true });
    });
  });

  loadCurrentBuild();
})();
