(function(){
  'use strict';

  const app = window.LaBelle = window.LaBelle || {};

  let loaded = false;
  let byKey = new Map();   // product_key -> [review, ...]

  function buildIndex(rows){
    byKey = new Map();
    (rows || []).forEach(row => {
      const key = String(row.product_key || '');
      if(!key) return;
      if(!byKey.has(key)) byKey.set(key, []);
      byKey.get(key).push({
        name:String(row.name || '').trim() || app.i18n.t('reviews.anon'),
        rating:Math.max(1, Math.min(5, Number(row.rating) || 0)),
        text:String(row.text || ''),
        timestamp:row.timestamp || ''
      });
    });
  }

  async function load(){
    if(!app.api.isConfigured()){ loaded = true; return; }
    try{
      const data = await app.api.get({action:'reviews'});
      if(data && data.ok && Array.isArray(data.rows)) buildIndex(data.rows);
    }catch(err){
      console.warn('Reviews load failed:', err);
    }
    loaded = true;
  }

  function listFor(productKey){
    return byKey.get(productKey) || [];
  }

  function ratingFor(productKey){
    const list = listFor(productKey);
    if(!list.length) return null;
    const sum = list.reduce((acc, review) => acc + review.rating, 0);
    return {count:list.length, avg:Math.round((sum / list.length) * 10) / 10};
  }

  function stars(rating){
    const full = Math.round(rating);
    return '★★★★★'.slice(0, full) + '☆☆☆☆☆'.slice(0, 5 - full);
  }

  function badgeHtml(product){
    const rating = ratingFor(product.key);
    if(!rating) return '';
    return `<span class="rating-badge" title="${app.dom.escapeHtml(app.i18n.t('reviews.title'))}">★ ${rating.avg} <span>(${rating.count})</span></span>`;
  }

  function reviewsListHtml(productKey){
    const list = listFor(productKey);
    if(!list.length){
      return `<div class="reviews-empty">${app.dom.escapeHtml(app.i18n.t('reviews.empty'))}</div>`;
    }
    return list.map(review => `
      <div class="review-item">
        <div class="review-head">
          <span class="review-name">${app.dom.escapeHtml(review.name)}</span>
          <span class="review-stars" aria-label="${review.rating}/5">${stars(review.rating)}</span>
        </div>
        <div class="review-text">${app.dom.escapeHtml(review.text)}</div>
      </div>
    `).join('');
  }

  function sectionHtml(product){
    const rating = ratingFor(product.key);
    const summary = rating
      ? `★ ${rating.avg} · ${rating.count}`
      : app.dom.escapeHtml(app.i18n.t('reviews.none'));
    const key = app.dom.escapeHtml(product.key);
    return `
      <div class="reviews-block" data-review-key="${key}">
        <div class="reviews-head">
          <div class="detail-title">${app.i18n.t('reviews.title')}</div>
          <span class="reviews-summary">${summary}</span>
        </div>
        <div class="reviews-list">${reviewsListHtml(product.key)}</div>
        <form class="review-form" data-review-form="${key}" autocomplete="off">
          <div class="review-form-label">${app.i18n.t('reviews.leave')}</div>
          <div class="review-form-row">
            <input id="reviewName" type="text" maxlength="80" data-i18n-placeholder="reviews.namePlaceholder" placeholder="Имя">
            <select id="reviewRating" aria-label="${app.dom.escapeHtml(app.i18n.t('reviews.rating'))}">
              <option value="5">★★★★★</option>
              <option value="4">★★★★</option>
              <option value="3">★★★</option>
              <option value="2">★★</option>
              <option value="1">★</option>
            </select>
          </div>
          <textarea id="reviewText" maxlength="1000" data-i18n-placeholder="reviews.textPlaceholder" placeholder="Ваше впечатление об аромате"></textarea>
          <div class="hp-field" aria-hidden="true">
            <label for="reviewWebsite">Website</label>
            <input id="reviewWebsite" name="website" type="text" tabindex="-1" autocomplete="off">
          </div>
          <div class="review-form-actions">
            <button class="btn-primary" type="button" id="reviewSubmitBtn" data-review-submit="${key}">${app.i18n.t('reviews.submit')}</button>
            <span class="review-message" id="reviewMessage" role="status" aria-live="polite"></span>
          </div>
        </form>
      </div>
    `;
  }

  async function submit(productKey){
    const nameEl = app.dom.byId('reviewName');
    const ratingEl = app.dom.byId('reviewRating');
    const textEl = app.dom.byId('reviewText');
    const websiteEl = app.dom.byId('reviewWebsite');
    const button = app.dom.byId('reviewSubmitBtn');
    const message = app.dom.byId('reviewMessage');
    const setMsg = (text, tone) => { if(message){ message.textContent = text || ''; message.dataset.tone = text ? (tone || '') : ''; } };

    const text = (textEl?.value || '').trim();
    if(!text){ setMsg(app.i18n.t('reviews.errText'), 'danger'); return; }
    if(!app.api.isConfigured()){ setMsg(app.i18n.t('reviews.errUnavailable'), 'danger'); return; }

    if(button) button.disabled = true;
    setMsg(app.i18n.t('reviews.sending'), '');
    let res;
    try{
      res = await app.api.post({
        action:'submit_review',
        website:websiteEl?.value || '',
        product_key:productKey,
        name:(nameEl?.value || '').trim(),
        rating:ratingEl?.value || '5',
        text
      });
    }catch(err){
      res = {ok:false, error:err.message};
    }
    if(button) button.disabled = false;

    if(res && res.ok){
      if(textEl) textEl.value = '';
      if(nameEl) nameEl.value = '';
      setMsg(app.i18n.t('reviews.thanks'), 'ok');
    }else{
      const key = res && res.error === 'rate_limited' ? 'reviews.errRate' : 'reviews.errFailed';
      setMsg(app.i18n.t(key), 'danger');
    }
  }

  // Отправка отзыва делегируется на документ — модалка пересоздаётся при каждом открытии.
  document.addEventListener('click', event => {
    const button = event.target instanceof Element ? event.target.closest('[data-review-submit]') : null;
    if(!button) return;
    event.preventDefault();
    submit(button.dataset.reviewSubmit);
  });

  app.reviews = {load, ratingFor, listFor, badgeHtml, sectionHtml, submit, isLoaded: () => loaded};
})();
