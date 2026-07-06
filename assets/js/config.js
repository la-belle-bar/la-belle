window.LaBelle = window.LaBelle || {};

// ВАЖНО: этот файл публичный (GitHub Pages). Здесь не должно быть ни одного
// секрета: ни паролей, ни токенов, ни ID приватных таблиц. Все секреты живут
// в Google Apps Script -> Project Settings -> Script Properties.
window.LaBelle.config = {
  // URL веб-приложения Google Apps Script (Deploy -> Web app -> /exec).
  // Единственная точка доступа к приватной Google-таблице.
  apiUrl: 'https://script.google.com/macros/s/AKfycbz4yILKiRKPB_-B-E5XGVTNNv86Gix6U8_bRbpMk4MGbqLqRsWRQG0nLa0lHild1tSk/exec',

  whatsappPhone: '77022266500',

  payments: {
    kaspi: {
      enabled: true,
      // Temporary manual flow: set Kaspi Pay remote payment link here, or leave '#'.
      paymentUrl: '#',
      // Optional static QR image URL. The order status remains "awaiting_payment" until admin marks it paid.
      qrImageUrl: ''
    }
  }
};
