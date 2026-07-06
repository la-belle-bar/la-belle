(function(){
  'use strict';

  const app = window.LaBelle = window.LaBelle || {};

  function getPaymentMethod(){
    return app.dom.byId('paymentMethod')?.value || 'cash';
  }

  function getKaspiConfig(){
    const cfg = app.config.payments?.kaspi || {};
    return {
      enabled: cfg.enabled !== false,
      paymentUrl: cfg.paymentUrl || '',
      qrImageUrl: cfg.qrImageUrl || ''
    };
  }

  function hasKaspiPaymentTarget(){
    const cfg = getKaspiConfig();
    return Boolean((cfg.paymentUrl && cfg.paymentUrl !== '#') || cfg.qrImageUrl);
  }

  function getPaymentInfo(){
    const method = getPaymentMethod();
    return {
      method,
      status: method === 'kaspi' ? 'awaiting_payment' : 'pending'
    };
  }

  function getOrderStatusForPayment(paymentInfo){
    return paymentInfo.method === 'kaspi' ? 'awaiting_payment' : 'new';
  }

  function syncPaymentUi(){
    const kaspi = getKaspiConfig();
    const select = app.dom.byId('paymentMethod');
    const kaspiOption = select?.querySelector('option[value="kaspi"]');
    if(kaspiOption){
      kaspiOption.hidden = !kaspi.enabled;
      kaspiOption.disabled = !kaspi.enabled;
    }
    if(select && select.value === 'kaspi' && !kaspi.enabled) select.value = 'cash';

    const method = getPaymentMethod();
    const panel = app.dom.byId('kaspiPaymentPanel');
    const link = app.dom.byId('kaspiPaymentLink');
    const qr = app.dom.byId('kaspiQrImage');
    if(panel) panel.classList.toggle('is-hidden', method !== 'kaspi');
    if(link){
      const url = kaspi.paymentUrl || '#';
      link.setAttribute('href', url);
      link.classList.toggle('is-disabled', !url || url === '#');
    }
    if(qr){
      const qrUrl = kaspi.qrImageUrl || '';
      qr.classList.toggle('is-hidden', method !== 'kaspi' || !qrUrl);
      if(qrUrl) qr.setAttribute('src', qrUrl);
    }
  }

  function init(){
    const method = app.dom.byId('paymentMethod');
    if(method) method.addEventListener('change', syncPaymentUi);
    syncPaymentUi();
  }

  app.payments = {
    init,
    getPaymentInfo,
    getOrderStatusForPayment,
    syncPaymentUi,
    getKaspiConfig,
    hasKaspiPaymentTarget
  };
})();
