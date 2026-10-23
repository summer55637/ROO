(() => {
  'use strict';

  const publicMode = document.getElementById('public-mode');
  const localMode = document.getElementById('local-mode');
  const publicButton = document.getElementById('show-public');
  const nativeButton = document.getElementById('show-native');
  const localButton = document.getElementById('show-local');
  const nativeToolbar = document.getElementById('native-toolbar');
  const localToolbar = document.getElementById('local-toolbar');
  let localModuleLoaded = false;

  function setMode(mode) {
    if (!['public', 'native', 'local'].includes(mode)) mode = 'public';

    const isPublic = mode === 'public';
    const isNative = mode === 'native';
    publicMode.hidden = !isPublic;
    localMode.hidden = isPublic;
    nativeToolbar.hidden = !isNative;
    localToolbar.hidden = isNative;
    publicButton.setAttribute('aria-pressed', String(isPublic));
    nativeButton.setAttribute('aria-pressed', String(isNative));
    localButton.setAttribute('aria-pressed', String(!isPublic && !isNative));

    if (!isPublic && !localModuleLoaded) {
      localModuleLoaded = true;
      const module = document.createElement('script');
      module.type = 'module';
      module.src = './ro_explorer.mjs';
      module.onload = () => window.dispatchEvent(new CustomEvent('roo-explorer-mode', { detail: mode }));
      module.onerror = () => {
        localModuleLoaded = false;
        document.getElementById('status').textContent = '地圖探索模組載入失敗；請確認網路連線或切回公開地圖預覽。';
        document.getElementById('status').classList.add('error');
      };
      document.body.appendChild(module);
    } else if (!isPublic) {
      window.dispatchEvent(new CustomEvent('roo-explorer-mode', { detail: mode }));
    }
  }

  publicButton.addEventListener('click', () => setMode('public'));
  nativeButton.addEventListener('click', () => setMode('native'));
  localButton.addEventListener('click', () => setMode('local'));

  const params = new URLSearchParams(window.location.search);
  const requestedMode = params.get('mode');
  const requestedView = params.get('view');
  if (requestedView === '2d' || requestedMode === 'native' || requestedMode === 'local') {
    setMode(requestedMode === 'local' && requestedView !== '2d' ? 'local' : 'native');
  }
})();
