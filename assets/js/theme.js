/* Тема оформления: светлая / тёмная.
   Классический (не defer) скрипт: подключается в <head> и выполняется до первой
   отрисовки, поэтому data-theme уже стоит на <html> — вспышки светлого фона нет.
   Выбор пользователя хранится в localStorage; если выбора нет — следуем за
   системной темой. */
(function(){
  'use strict';

  var LS_KEY = 'lb_theme_v1';
  var root = document.documentElement;
  var THEME_COLOR = {light:'#EBECE9', dark:'#15181A'};

  function readStored(){
    try{
      var value = window.localStorage.getItem(LS_KEY);
      return (value === 'dark' || value === 'light') ? value : '';
    }catch(err){
      return '';
    }
  }

  function systemTheme(){
    try{
      return (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) ? 'dark' : 'light';
    }catch(err){
      return 'light';
    }
  }

  function paint(theme){
    root.setAttribute('data-theme', theme);
    var meta = document.querySelector('meta[name="theme-color"]');
    if(meta) meta.setAttribute('content', THEME_COLOR[theme] || THEME_COLOR.light);
    var buttons = document.querySelectorAll('.theme-toggle');
    for(var i = 0; i < buttons.length; i++){
      buttons[i].setAttribute('aria-pressed', theme === 'dark' ? 'true' : 'false');
    }
  }

  function current(){
    return root.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
  }

  function setTheme(theme){
    var next = theme === 'dark' ? 'dark' : 'light';
    try{ window.localStorage.setItem(LS_KEY, next); }catch(err){}
    paint(next);
    document.dispatchEvent(new CustomEvent('lb:theme-changed', {detail:{theme:next}}));
  }

  paint(readStored() || systemTheme());

  /* Пока пользователь не выбрал тему вручную — следим за системной */
  try{
    var media = window.matchMedia('(prefers-color-scheme: dark)');
    var onSystemChange = function(){
      if(!readStored()) paint(systemTheme());
    };
    if(media.addEventListener) media.addEventListener('change', onSystemChange);
    else if(media.addListener) media.addListener(onSystemChange);
  }catch(err){}

  document.addEventListener('DOMContentLoaded', function(){
    paint(current());
    document.addEventListener('click', function(event){
      var target = event.target;
      var button = (target && target.closest) ? target.closest('.theme-toggle') : null;
      if(!button) return;
      setTheme(current() === 'dark' ? 'light' : 'dark');
    });
  });

  var app = window.LaBelle = window.LaBelle || {};
  app.theme = {get:current, set:setTheme};
})();
