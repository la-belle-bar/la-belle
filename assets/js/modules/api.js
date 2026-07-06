(function(){
  'use strict';

  const app = window.LaBelle = window.LaBelle || {};
  const SS_ADMIN_TOKEN_KEY = 'lb_admin_token_v1';

  function apiUrl(){
    return app.config?.apiUrl || '';
  }

  function isConfigured(){
    return Boolean(apiUrl());
  }

  async function get(params){
    if(!isConfigured()) return {ok:false, skipped:true};
    const url = new URL(apiUrl());
    Object.entries(params || {}).forEach(([key, value]) => {
      if(value != null && value !== '') url.searchParams.set(key, value);
    });
    url.searchParams.set('t', Date.now());
    const response = await fetch(url.toString(), {method:'GET', redirect:'follow'});
    if(!response.ok) throw new Error(`API HTTP ${response.status}`);
    return response.json();
  }

  // POST без заголовка Content-Type: запрос уходит как text/plain и не требует
  // CORS preflight, который Apps Script не поддерживает.
  async function post(payload){
    if(!isConfigured()) return {ok:false, skipped:true};
    const response = await fetch(apiUrl(), {
      method:'POST',
      redirect:'follow',
      body:JSON.stringify(payload)
    });
    if(!response.ok) throw new Error(`API HTTP ${response.status}`);
    let data = null;
    try{ data = await response.json(); }catch(_){}
    return data || {ok:true};
  }

  // Токен админа живёт только в sessionStorage текущей вкладки и никогда
  // не попадает в код сайта. Его проверяет Apps Script на каждом запросе.
  function getAdminToken(){
    try{ return sessionStorage.getItem(SS_ADMIN_TOKEN_KEY) || ''; }catch(_){ return ''; }
  }

  function setAdminToken(token){
    try{
      if(token) sessionStorage.setItem(SS_ADMIN_TOKEN_KEY, token);
      else sessionStorage.removeItem(SS_ADMIN_TOKEN_KEY);
    }catch(_){}
  }

  app.api = {get, post, isConfigured, getAdminToken, setAdminToken};
})();
