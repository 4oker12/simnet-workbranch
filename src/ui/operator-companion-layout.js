(() => {
  'use strict';

  const WB = globalThis.SIMNET_WB;
  if (!WB || window.top !== window.self || WB.__operatorCompanionLayoutLoaded) return;
  WB.__operatorCompanionLayoutLoaded = true;

  const HOST_ID = 'simnet-workbench-operator-companion';
  const STYLE_ID = 'simnet-operator-companion-layout-v2';

  function apply() {
    const root = document.getElementById(HOST_ID)?.shadowRoot;
    if (!root || root.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      .panel{
        width:min(420px,calc(100vw - 82px))!important;
        height:min(560px,calc(100vh - 104px))!important;
      }
      .messages{padding:13px 12px 14px!important}
      .bubble{max-width:92%!important;font-size:13px!important;line-height:1.46!important}
      .composer textarea{min-height:44px!important;font-size:13px!important}
      @media(max-width:620px){
        .panel{width:auto!important;height:auto!important}
      }
    `;
    root.appendChild(style);
  }

  if (document.documentElement) apply();
  else window.addEventListener('DOMContentLoaded', apply, { once: true });
})();
