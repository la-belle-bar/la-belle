(function(){
  'use strict';

  function initHeroSlider(){
    const slider = document.getElementById('heroSlider');
    const track = document.getElementById('heroSlides');
    if(!slider || !track) return;
    const slides = Array.from(track.children);
    if(!slides.length) return;

    const dotsWrap = document.getElementById('heroSliderDots');
    let index = 0;
    let timer = null;

    // Если файл баннера ещё не положили в assets/images/banners/ —
    // картинка прячется и слайд показывает HTML-подпись на градиенте.
    slider.addEventListener('error', event => {
      const img = event.target;
      if(img instanceof HTMLImageElement){
        img.style.display = 'none';
        img.closest('.hero-slide')?.classList.add('is-noimg');
      }
    }, true);

    const dots = slides.map((_, i) => {
      const dot = document.createElement('button');
      dot.type = 'button';
      dot.setAttribute('aria-label', `Баннер ${i + 1}`);
      dot.addEventListener('click', () => { go(i); restart(); });
      dotsWrap?.appendChild(dot);
      return dot;
    });

    function go(next){
      index = (next + slides.length) % slides.length;
      track.style.transform = `translateX(-${index * 100}%)`;
      dots.forEach((dot, i) => dot.classList.toggle('is-active', i === index));
    }

    function stop(){
      if(timer){ clearInterval(timer); timer = null; }
    }

    function restart(){
      stop();
      if(slides.length < 2) return;
      if(window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
      timer = setInterval(() => go(index + 1), 6000);
    }

    slider.querySelector('.hero-slider-arrow--prev')?.addEventListener('click', () => { go(index - 1); restart(); });
    slider.querySelector('.hero-slider-arrow--next')?.addEventListener('click', () => { go(index + 1); restart(); });
    slider.addEventListener('mouseenter', stop);
    slider.addEventListener('mouseleave', restart);
    document.addEventListener('visibilitychange', () => {
      if(document.hidden) stop();
      else restart();
    });

    // Свайп на тач-экранах; клик по ссылке после перетаскивания подавляем
    let startX = null;
    let moved = false;
    slider.addEventListener('pointerdown', event => { startX = event.clientX; moved = false; });
    slider.addEventListener('pointermove', event => {
      if(startX != null && Math.abs(event.clientX - startX) > 10) moved = true;
    });
    slider.addEventListener('pointerup', event => {
      if(startX == null) return;
      const delta = event.clientX - startX;
      startX = null;
      if(Math.abs(delta) > 40){
        go(index + (delta < 0 ? 1 : -1));
        restart();
      }
    });
    slider.addEventListener('click', event => {
      if(moved){
        event.preventDefault();
        moved = false;
      }
    }, true);

    go(0);
    restart();
  }

  document.addEventListener('DOMContentLoaded', initHeroSlider);
})();
