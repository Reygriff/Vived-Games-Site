(function () {
  // Download settings (also in config.js — this block wins so stale hosting cache can't keep old Drive links)
  const DOWNLOAD = {
    url: 'https://github.com/Reygriff/Luma-Client/releases/download/v1.0.0/Luma-Client-Setup-1.0.0.zip',
    version: '1.0.0',
    platform: 'Windows 10 / 11 (64-bit)',
    approxSize: '~179 MB',
    filename: 'Luma-Client-Setup-1.0.0.zip'
  };

  const cfg = { ...DOWNLOAD, ...(window.LUMA_DOWNLOAD || {}) };
  // Never use Google Drive even if an old config.js is still cached on the host
  if (!cfg.url || cfg.url === '#' || /drive\.google|googleusercontent/i.test(cfg.url)) {
    cfg.url = DOWNLOAD.url;
  }

  const setText = (id, value) => {
    const el = document.getElementById(id);
    if (el && value) el.textContent = value;
  };

  setText('hero-version', `v${cfg.version}`);
  setText('hero-platform', cfg.platform);
  setText('hero-size', cfg.approxSize);
  setText('dl-version', `v${cfg.version}`);
  setText('dl-platform', cfg.platform);
  setText('dl-size', cfg.approxSize);

  const downloadButtons = [
    document.getElementById('hero-download-btn'),
    document.getElementById('main-download-btn')
  ].filter(Boolean);

  downloadButtons.forEach((btn) => {
    btn.setAttribute('href', cfg.url);
    btn.setAttribute('download', cfg.filename || 'Luma-Client-Setup-1.0.0.zip');
    btn.removeAttribute('target');
  });

  const hint = document.getElementById('download-hint');
  if (hint) {
    hint.textContent =
      'By downloading you agree this is an unofficial, fan-made client not affiliated with Mojang or Microsoft.';
  }

  const year = document.getElementById('year');
  if (year) year.textContent = new Date().getFullYear();
})();
