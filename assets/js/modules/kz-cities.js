(function(){
  'use strict';

  const app = window.LaBelle = window.LaBelle || {};

  // Города Казахстана для подсказок в поле «Город» (крупные — первыми,
  // дальше по алфавиту). Список встроенный: без внешних API и ключей.
  const KZ_CITIES = [
    'Алматы','Астана','Шымкент','Караганда','Актобе','Тараз','Павлодар',
    'Усть-Каменогорск','Семей','Атырау','Костанай','Кызылорда','Уральск',
    'Петропавловск','Актау','Темиртау','Туркестан','Кокшетау','Талдыкорган',
    'Экибастуз',
    'Абай','Аксай','Аксу','Алтай','Аральск','Арыс','Атбасар','Аягоз',
    'Байконур','Балхаш','Есик','Жанаозен','Жаркент','Жезказган','Жетысай',
    'Житикара','Зайсан','Кандыагаш','Каражал','Каратау','Каскелен','Кентау',
    'Конаев','Кульсары','Курчатов','Лисаковск','Макинск','Приозерск','Риддер',
    'Рудный','Сарань','Сарканд','Сатпаев','Степногорск','Талгар','Текели',
    'Ушарал','Уштобе','Форт-Шевченко','Хромтау','Шахтинск','Шу','Щучинск','Эмба'
  ];

  function initCityAutocomplete(){
    const input = app.dom.byId('c_city');
    if(!input || app.dom.byId('kzCityList')) return;
    const datalist = document.createElement('datalist');
    datalist.id = 'kzCityList';
    datalist.innerHTML = KZ_CITIES
      .map(city => `<option value="${app.dom.escapeHtml(city)}"></option>`)
      .join('');
    document.body.appendChild(datalist);
    input.setAttribute('list', 'kzCityList');
    input.setAttribute('autocomplete', 'off');
  }

  document.addEventListener('DOMContentLoaded', initCityAutocomplete);
})();
