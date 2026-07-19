(function(){
  'use strict';

  const app = window.LaBelle = window.LaBelle || {};

  const LS_FAV_KEY = 'lb_favorites_v1';
  const LS_RECENT_KEY = 'lb_recent_v1';
  const RECENT_LIMIT = 12;
  const SIMILAR_LIMIT = 4;

  /* ── Хранилище (только клиент, localStorage) ───────────────────────────── */

  function readList(key){
    const list = app.storage.readJson(key, []);
    return Array.isArray(list) ? list.filter(item => typeof item === 'string') : [];
  }

  function getFavKeys(){ return readList(LS_FAV_KEY); }
  function getRecentKeys(){ return readList(LS_RECENT_KEY); }

  function isFav(productKey){
    return Boolean(productKey) && getFavKeys().includes(productKey);
  }

  function toggleFav(productKey){
    if(!productKey) return false;
    const list = getFavKeys();
    const index = list.indexOf(productKey);
    if(index > -1) list.splice(index, 1);
    else list.unshift(productKey);
    app.storage.writeJson(LS_FAV_KEY, list);
    return index === -1;
  }

  // Недавно смотренные: самый свежий — первым, без дублей, с лимитом.
  function recordView(productKey){
    if(!productKey) return;
    const list = getRecentKeys().filter(key => key !== productKey);
    list.unshift(productKey);
    app.storage.writeJson(LS_RECENT_KEY, list.slice(0, RECENT_LIMIT));
    renderStrips();
  }

  function clearFavorites(){
    app.storage.writeJson(LS_FAV_KEY, []);
    refreshButtons();
    renderStrips();
  }

  /* ── Резолв ключей в текущие товары ────────────────────────────────────── */

  function productsByKey(){
    const map = new Map();
    (app.state?.products || []).forEach(product => map.set(product.key, product));
    return map;
  }

  function resolve(keys){
    const map = productsByKey();
    return keys.map(key => map.get(key)).filter(Boolean);
  }

  /* ── Похожие ароматы (клиентский скоринг) ──────────────────────────────── */

  function noteTokens(product){
    return String([product.notes?.top, product.notes?.heart, product.notes?.base].join(' '))
      .toLowerCase()
      .split(/[\s,;/·—-]+/)
      .filter(token => token.length > 2 && token !== '—');
  }

  function getSimilar(product, products, limit){
    if(!product) return [];
    const baseNotes = new Set(noteTokens(product));
    return (products || [])
      .filter(candidate => candidate.key !== product.key)
      .map(candidate => {
        let score = 0;
        if(candidate.brand && candidate.brand === product.brand) score += 4;
        if(candidate.category && candidate.category === product.category) score += 2;
        if(candidate.gender && candidate.gender === product.gender) score += 1;
        if(candidate.season && candidate.season === product.season) score += 1;
        noteTokens(candidate).forEach(token => { if(baseNotes.has(token)) score += 1; });
        if(candidate.available) score += 0.5;
        return {candidate, score};
      })
      .filter(entry => entry.score > 0)
      .sort((a, b) => b.score - a.score || (a.candidate.minPrice ?? 1e12) - (b.candidate.minPrice ?? 1e12))
      .slice(0, limit || SIMILAR_LIMIT)
      .map(entry => entry.candidate);
  }

  /* ── Разметка ──────────────────────────────────────────────────────────── */

  function favButtonHtml(product, options){
    const active = isFav(product.key);
    const wide = options && options.wide;
    const label = active ? app.i18n.t('fav.inList') : app.i18n.t('fav.add');
    const aria = active ? app.i18n.t('fav.remove') : app.i18n.t('fav.add');
    return `<button class="fav-btn${wide ? ' fav-btn--wide' : ''}${active ? ' is-active' : ''}" type="button"`
      + ` data-fav-key="${app.dom.escapeHtml(product.key)}" aria-pressed="${active ? 'true' : 'false'}"`
      + ` aria-label="${app.dom.escapeHtml(aria)}" title="${app.dom.escapeHtml(aria)}">`
      + `<span class="fav-btn-icon" aria-hidden="true">${active ? '♥' : '♡'}</span>`
      + (wide ? `<span class="fav-btn-label">${app.dom.escapeHtml(label)}</span>` : '')
      + `</button>`;
  }

  function similarHtml(product){
    const items = getSimilar(product, app.state?.products || [], SIMILAR_LIMIT);
    if(!items.length) return '';
    const cards = items.map(item => {
      const priceHtml = item.minPrice
        ? app.i18n.t('product.fromPrice', {price:app.dom.rub(item.minPrice)})
        : app.i18n.t('product.priceRequest');
      return `
        <button class="similar-card" type="button" data-open-product="${item.id}">
          <span class="similar-card-image">
            <img src="${app.dom.escapeHtml(item.image)}" alt="${app.dom.escapeHtml(item.name)}" data-img-fallback="${app.dom.escapeHtml(item.emoji)}" data-img-fallback-class="similar-card-fallback">
          </span>
          <span class="similar-card-brand">${app.dom.escapeHtml(item.brand)}</span>
          <span class="similar-card-name">${app.dom.escapeHtml(item.name)}</span>
          <span class="similar-card-price">${priceHtml}</span>
        </button>`;
    }).join('');
    return `
      <div class="similar-block">
        <div class="detail-title">${app.i18n.t('similar.title')}</div>
        <div class="similar-grid">${cards}</div>
      </div>`;
  }

  /* ── Строки на главной (Избранное / Недавно смотренные) ────────────────── */

  function renderStripInto(containerId, sectionId, products){
    const container = app.dom.byId(containerId);
    const section = app.dom.byId(sectionId);
    if(!container || !section) return;
    if(!products.length){
      section.classList.add('is-hidden');
      container.innerHTML = '';
      return;
    }
    section.classList.remove('is-hidden');
    container.innerHTML = '';
    products.forEach(product => container.appendChild(app.products.renderProductCard(product)));
  }

  function renderStrips(){
    renderStripInto('favoritesStrip', 'favoritesSection', resolve(getFavKeys()));
    renderStripInto('recentStrip', 'recentSection', resolve(getRecentKeys()));
    const clearBtn = app.dom.byId('favClearBtn');
    if(clearBtn && clearBtn.dataset.bound !== 'true'){
      clearBtn.dataset.bound = 'true';
      clearBtn.addEventListener('click', clearFavorites);
    }
  }

  // Синхронизируем состояние всех кнопок-сердечек в текущем DOM.
  function refreshButtons(){
    app.dom.all('.fav-btn').forEach(button => {
      const active = isFav(button.dataset.favKey);
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-pressed', active ? 'true' : 'false');
      const aria = active ? app.i18n.t('fav.remove') : app.i18n.t('fav.add');
      button.setAttribute('aria-label', aria);
      button.setAttribute('title', aria);
      const icon = button.querySelector('.fav-btn-icon');
      if(icon) icon.textContent = active ? '♥' : '♡';
      const label = button.querySelector('.fav-btn-label');
      if(label) label.textContent = active ? app.i18n.t('fav.inList') : app.i18n.t('fav.add');
    });
  }

  /* ── Делегирование кликов по сердечкам (capture — до листенера карточки) ── */

  document.addEventListener('click', event => {
    const button = event.target instanceof Element ? event.target.closest('.fav-btn') : null;
    if(!button) return;
    // Останавливаем всплытие, чтобы клик по сердечку не открывал карточку товара.
    event.preventDefault();
    event.stopPropagation();
    toggleFav(button.dataset.favKey);
    refreshButtons();
    renderStrips();
  }, true);

  app.favorites = {
    isFav,
    toggleFav,
    recordView,
    getFavKeys,
    getRecentKeys,
    getSimilar,
    favButtonHtml,
    similarHtml,
    renderStrips,
    refreshButtons,
    clearFavorites
  };
})();
