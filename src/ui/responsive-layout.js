(() => {
  'use strict';

  if (window.top !== window.self) return;

  const HOST_ID = 'simnet-workbench-rail-host';
  const STYLE_ID = 'wb-responsive-layout-style';
  let documentObserver = null;

  function install(root) {
    if (!root || root.getElementById?.(STYLE_ID) || root.querySelector?.(`#${STYLE_ID}`)) return true;

    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      .drawer{
        container-type:inline-size;
        max-width:calc(100vw - 66px)
      }
      .shell.open .drawer{
        width:min(380px,calc(100vw - 66px))
      }
      .panel{
        width:100%;
        min-width:0
      }
      .shell.compact.open .drawer{
        width:min(330px,calc(100vw - 66px))
      }
      .shell.compact .panel{
        width:100%
      }

      #wb-human-settings,
      #wb-human-settings *{
        min-width:0
      }
      #wb-human-settings .wb-set-card{
        overflow:hidden
      }
      #wb-human-settings .wb-set-head{
        flex-wrap:wrap;
        align-items:flex-start
      }
      #wb-human-settings .wb-set-row{
        flex-wrap:nowrap;
        align-items:center
      }
      #wb-human-settings .wb-set-head>div,
      #wb-human-settings .wb-set-row>div{
        flex:1 1 150px;
        min-width:0
      }
      #wb-human-settings .switch{
        width:42px;
        height:24px;
        flex:0 0 42px;
        padding:2px;
        border:1px solid #cbd5e1;
        border-radius:999px;
        background:#e2e8f0;
        box-shadow:inset 0 1px 2px rgba(15,23,42,.08);
        cursor:pointer
      }
      #wb-human-settings .switch span{
        display:block;
        width:18px;
        height:18px;
        border-radius:50%;
        background:#fff;
        box-shadow:0 1px 3px rgba(15,23,42,.28);
        transition:transform .16s ease
      }
      #wb-human-settings .switch.on{
        border-color:#a50046;
        background:#a50046
      }
      #wb-human-settings .switch.on span{
        transform:translateX(18px)
      }
      #wb-human-settings .wb-set-title,
      #wb-human-settings .wb-set-sub,
      #wb-human-settings .wb-fallback,
      #wb-human-settings .wb-status,
      #wb-human-settings .wb-danger-body{
        overflow-wrap:anywhere
      }
      #wb-human-settings input,
      #wb-human-settings select,
      #wb-human-settings button{
        max-width:100%
      }
      #wb-human-settings [data-ai-options],
      #wb-human-settings [data-ai-delete]{
        flex:1 1 120px
      }
      #wb-human-settings [style*="display:flex"]{
        flex-wrap:wrap
      }

      @container (max-width: 305px){
        #wb-human-settings .wb-key,
        #wb-human-settings .wb-ai-grid,
        #wb-human-settings .wb-action-grid{
          grid-template-columns:1fr
        }
        #wb-human-settings .wb-key .wb-btn,
        #wb-human-settings .wb-ai-grid .wb-btn,
        #wb-human-settings .wb-action{
          width:100%
        }
        #wb-human-settings .wb-set-pill{
          max-width:100%;
          white-space:normal
        }
      }

      @media (max-width: 520px){
        .shell.open .drawer{
          width:min(356px,calc(100vw - 62px))
        }
        .shell.compact.open .drawer{
          width:min(310px,calc(100vw - 62px))
        }
        .body{
          padding:10px
        }
      }
    `;
    root.appendChild(style);
    return true;
  }

  function discover() {
    const host = document.getElementById(HOST_ID);
    if (host?.shadowRoot && install(host.shadowRoot)) {
      documentObserver?.disconnect();
      documentObserver = null;
      return;
    }
    if (documentObserver) return;
    documentObserver = new MutationObserver(discover);
    documentObserver.observe(document.documentElement, { childList: true, subtree: true });
  }

  discover();
})();
