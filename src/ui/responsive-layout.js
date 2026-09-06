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
        width:min(340px,calc(100vw - 66px))
      }
      .panel{
        width:100%;
        min-width:0
      }
      .shell.compact.open .drawer{
        width:min(290px,calc(100vw - 66px))
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
      #wb-human-settings .wb-set-head,
      #wb-human-settings .wb-set-row{
        flex-wrap:wrap;
        align-items:flex-start
      }
      #wb-human-settings .wb-set-head>div,
      #wb-human-settings .wb-set-row>div{
        flex:1 1 150px;
        min-width:0
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
          width:min(330px,calc(100vw - 62px))
        }
        .shell.compact.open .drawer{
          width:min(280px,calc(100vw - 62px))
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
