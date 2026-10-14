// ApartmentScout landing page: glass nav on scroll, theme toggle, copy buttons and the gallery lightbox.
// No dependencies. Everything degrades to plain links and static content without JavaScript.
(() => {
  const root = document.documentElement;
  const $ = (sel, el = document) => el.querySelector(sel);

  // Repository links are filled in by the Pages workflow. When the page is served without that step,
  // derive them from a <user>.github.io/<repo>/ address, or fall back to GitHub's search.
  const fixRepoLinks = () => {
    const els = document.querySelectorAll('a[href*="__REPO__"]');
    if (!els.length) return;
    const host = location.hostname;
    const seg = location.pathname.split('/').filter(Boolean)[0];
    const repo = host.endsWith('.github.io') && seg
      ? `https://github.com/${host.split('.')[0]}/${seg}`
      : 'https://github.com/search?q=ApartmentScout&type=repositories';
    els.forEach((a) => { a.href = a.getAttribute('href').replace('__REPO__', repo); });
    document.querySelectorAll('pre code').forEach((c) => {
      if (c.textContent.includes('__REPO__')) c.innerHTML = c.innerHTML.replace('__REPO__.git', host.endsWith('.github.io') && seg ? `${repo}.git` : '&lt;repository-url&gt;');
    });
  };

  // Nav turns to glass once the page scrolls.
  const nav = $('.nav');
  const onScroll = () => nav.classList.toggle('scrolled', window.scrollY > 8);

  // Theme: same storage key and values as the dashboard, so /demo/ opens in the theme chosen here.
  const themeBtn = $('#themeBtn');
  const syncThemeUi = () => {
    const light = root.dataset.theme === 'light';
    themeBtn.setAttribute('aria-label', light ? 'Switch to dark theme' : 'Switch to light theme');
    const ground = getComputedStyle(root).getPropertyValue('--ground').trim();
    if (ground) $('meta[name=theme-color]').setAttribute('content', ground);
  };
  const flipTheme = () => {
    root.dataset.theme = root.dataset.theme === 'light' ? 'dark' : 'light';
    try { localStorage.setItem('as:theme', JSON.stringify(root.dataset.theme)); } catch { /* storage unavailable */ }
    syncThemeUi();
  };

  // Copy buttons copy the command text only (comments stripped).
  const status = $('#copyStatus');
  const copyText = async (text) => {
    try { await navigator.clipboard.writeText(text); return true; } catch { /* fall back below */ }
    const ta = Object.assign(document.createElement('textarea'), { value: text });
    ta.setAttribute('readonly', ''); ta.style.cssText = 'position:fixed;opacity:0';
    document.body.append(ta); ta.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch { ok = false; }
    ta.remove();
    return ok;
  };
  const onCopy = async (btn) => {
    const pre = document.getElementById(btn.dataset.copy);
    const text = pre.textContent.split('\n').map((l) => l.replace(/\s+#.*$/, '')).join('\n').trim();
    const ok = await copyText(text);
    btn.textContent = ok ? 'Copied' : 'Press ⌘C';
    btn.classList.toggle('ok', ok);
    status.textContent = ok ? 'Commands copied to the clipboard' : 'Copy failed; select the text instead';
    if (!ok) getSelection().selectAllChildren(pre);
    clearTimeout(btn._t);
    btn._t = setTimeout(() => { btn.textContent = 'Copy'; btn.classList.remove('ok'); }, 1800);
  };

  // Gallery lightbox: a larger look plus a link to the same view in the demo.
  const lb = $('#lightbox');
  const openShot = (a) => {
    if (!lb || typeof lb.showModal !== 'function') return false;
    const img = $('img', a);
    $('#lbImg').src = a.getAttribute('href');
    $('#lbImg').alt = img.alt;
    $('#lbCap').textContent = $('span', a).textContent;
    $('#lbDemo').href = `./demo/#${a.dataset.view || 'map'}`;
    lb.showModal();
    return true;
  };

  document.addEventListener('DOMContentLoaded', () => {
    fixRepoLinks();
    onScroll();
    syncThemeUi();
    addEventListener('scroll', onScroll, { passive: true });
    themeBtn.addEventListener('click', flipTheme);
    document.querySelectorAll('.copy').forEach((b) => b.addEventListener('click', () => onCopy(b)));
    document.querySelectorAll('.shot').forEach((a) => a.addEventListener('click', (e) => {
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
      if (openShot(a)) e.preventDefault();
    }));
    lb?.addEventListener('click', (e) => { if (e.target === lb) lb.close(); });
  });
})();
