/* Hartford AI 動態 icon 注入器（2026-11-11）
   提供 inline SVG（CSS 才能控制內層動畫）；搭配 static/css/ai-avatar.css 使用。
   用法：
     HartfordAI.inject(el, 64)                    → 注入 idle 狀態
     HartfordAI.setState(el, 'thinking')          → 思考中
     HartfordAI.flashAnswer(el)                   → 回答完成閃一次 */
(function () {
  'use strict';

  var HF_SVG =
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120" class="hf-svg" role="img" aria-label="Hartford AI">' +
    '<defs>' +
    '<linearGradient id="hfMetal" x1="0" y1="0" x2="0" y2="1">' +
    '<stop offset="0" stop-color="#f5f7f8"/><stop offset="1" stop-color="#b0bec5"/>' +
    '</linearGradient>' +
    '<linearGradient id="hfBlue" x1="0" y1="0" x2="0" y2="1">' +
    '<stop offset="0" stop-color="#42a5f5"/><stop offset="1" stop-color="#1976d2"/>' +
    '</linearGradient>' +
    '</defs>' +
    '<g class="hf-root">' +
    '<circle class="hf-halo" cx="60" cy="54" r="40" fill="none" stroke="#42a5f5" stroke-width="3" stroke-dasharray="12 8" opacity="0"/>' +
    '<g class="hf-antenna">' +
    '<line x1="60" y1="16" x2="60" y2="8" stroke="#546e7a" stroke-width="3" stroke-linecap="round"/>' +
    '<circle class="hf-light" cx="60" cy="5.5" r="4" fill="#ffca28"/>' +
    '</g>' +
    '<g class="hf-jaws" fill="url(#hfBlue)" stroke="#1565c0" stroke-width="1.5">' +
    '<rect x="51" y="14" width="18" height="13" rx="4.5"/>' +
    '<rect x="51" y="84" width="18" height="13" rx="4.5"/>' +
    '<rect x="17" y="45" width="13" height="18" rx="4.5"/>' +
    '<rect x="90" y="45" width="13" height="18" rx="4.5"/>' +
    '</g>' +
    '<circle class="hf-head" cx="60" cy="54" r="32" fill="url(#hfMetal)" stroke="#546e7a" stroke-width="2.5"/>' +
    '<g class="hf-eyes" fill="#0d47a1">' +
    '<rect class="hf-eye" x="44" y="45" width="9" height="14" rx="4.5"/>' +
    '<rect class="hf-eye" x="67" y="45" width="9" height="14" rx="4.5"/>' +
    '</g>' +
    '<path class="hf-smile" d="M47 65 Q60 74 73 65" fill="none" stroke="#0d47a1" stroke-width="3" stroke-linecap="round"/>' +
    '<rect class="hf-arm" x="22" y="89" width="11" height="17" rx="5.5" fill="url(#hfBlue)" stroke="#1565c0" stroke-width="2"/>' +
    '<rect class="hf-arm" x="87" y="89" width="11" height="17" rx="5.5" fill="url(#hfBlue)" stroke="#1565c0" stroke-width="2"/>' +
    '<rect class="hf-body" x="35" y="92" width="50" height="24" rx="11" fill="url(#hfBlue)" stroke="#1565c0" stroke-width="2"/>' +
    '<g class="hf-chest">' +
    '<circle cx="60" cy="104" r="8" fill="#f5f7f8" stroke="#0d47a1" stroke-width="1.5"/>' +
    '<path d="M60 99.5 V108.5 M55.5 104 H64.5" stroke="#0d47a1" stroke-width="2" stroke-linecap="round"/>' +
    '</g>' +
    '</g>' +
    '</svg>';

  // 同一頁多顆 icon 時 gradient id 會重複 → 給每份 SVG 獨立 id 前綴
  function svgWithUid(uid) {
    return HF_SVG
      .replace(/id="hfMetal"/g, 'id="hfMetal' + uid + '"')
      .replace(/id="hfBlue"/g, 'id="hfBlue' + uid + '"')
      .replace(/url\(#hfMetal\)/g, 'url(#hfMetal' + uid + ')')
      .replace(/url\(#hfBlue\)/g, 'url(#hfBlue' + uid + ')');
  }

  var uidCounter = 0;

  window.HartfordAI = {
    inject: function (el, size) {
      var uid = 'u' + (++uidCounter);
      el.classList.add('hartford-ai', 'is-idle');
      el.style.width = (size || 64) + 'px';
      el.style.height = (size || 64) + 'px';
      el.innerHTML = svgWithUid(uid);
      return el;
    },
    setState: function (el, state) {
      el.classList.remove('is-idle', 'is-thinking', 'is-answering');
      el.classList.add('is-' + (state || 'idle'));
    },
    // 回答完成：提亮一次，動畫結束後自動回 idle 動畫
    flashAnswer: function (el) {
      el.classList.remove('is-answering');
      void el.offsetWidth; // 重啟動畫
      el.classList.add('is-answering');
      el.addEventListener('animationend', function h(e) {
        if (e.animationName === 'hf-answer') {
          el.classList.remove('is-answering');
          el.removeEventListener('animationend', h);
        }
      });
    }
  };
})();