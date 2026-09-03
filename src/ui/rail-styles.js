(() => {
  'use strict';
  const WB = globalThis.SIMNET_WB;
  if (!WB || WB.railStyles) return;

  // Presentation-only stylesheet bundle. Keeping CSS outside RailController
  // prevents layout/theme code from obscuring interaction and case-view logic.
  const base = `<style>
        :host{
          all:initial;
          color-scheme:dark;
          --bg:rgba(14,18,24,.975);
          --rail:rgba(22,28,36,.985);
          --card:rgba(255,255,255,.055);
          --line:rgba(255,255,255,.105);
          --muted:rgba(255,255,255,.58);
          --text:#f7f9fb;
          --accent:#35d07f;
          --warn:#f6c453;
          --danger:#fb7185;
          --blue:#60a5fa;
          --focus:#58a6ff;
          --cyan:#22d3ee;
          --violet:#a78bfa
        }
        *{box-sizing:border-box}
        button{font:inherit}
        .shell{
          display:flex;
          align-items:flex-start;
          gap:4px;
          height:auto;
          max-height:min(78vh,640px);
          color:var(--text);
          font:12px/1.4 Inter,system-ui,-apple-system,"Segoe UI",sans-serif;
          filter:drop-shadow(-8px 12px 28px rgba(0,0,0,.28));
          user-select:none
        }
        .drawer{
          width:0;
          height:auto;
          max-height:min(78vh,640px);
          overflow:hidden;
          opacity:0;
          transform:translateX(8px);
          transition:width .2s ease,opacity .14s ease,transform .2s ease;
          border:1px solid transparent;
          border-radius:10px;
          background:var(--bg);
          backdrop-filter:blur(16px)
        }
        .shell.open .drawer{
          width:220px;
          opacity:1;
          transform:none;
          border-color:var(--line)
        }
        .shell.compact.open .drawer{width:220px}
        .panel{
          width:220px;
          height:auto;
          max-height:min(78vh,640px);
          overflow:auto;
          scrollbar-width:thin
        }
        .shell.compact .panel{width:220px}
        .rail{
          width:46px;
          height:auto;
          align-self:flex-start;
          display:flex;
          flex-direction:column;
          overflow:hidden;
          border:1px solid var(--line);
          border-radius:11px;
          background:var(--rail);
          backdrop-filter:blur(16px);
          padding:3px 0;
          box-shadow:0 5px 18px rgba(0,0,0,.20)
        }
        .rail-spacer{
          display:none
        }
        .brand,.rail-btn{
          position:relative;
          width:40px;
          height:40px;
          margin:1px 3px;
          display:grid;
          place-items:center;
          border:0;
          border-radius:8px;
          border-bottom:0;
          color:rgba(255,255,255,.72);
          background:transparent;
          cursor:pointer
        }
        .brand{
          height:40px;
          color:#fff;
          font-weight:900;
          letter-spacing:-.08em
        }
        .rail-btn:hover,.rail-btn.active{
          color:#fff;
          background:rgba(255,255,255,.10)
        }
        .rail-btn.call-quick{
          color:var(--cyan);
          background:rgba(34,211,238,.055)
        }
        .rail-btn.call-quick:hover{
          color:#a5f3fc;
          background:rgba(34,211,238,.12)
        }
        .rail-btn.active:before{
          content:"";
          position:absolute;
          left:0;
          width:3px;
          height:18px;
          border-radius:0 4px 4px 0;
          background:var(--accent)
        }
        svg{
          width:20px;
          height:20px;
          fill:none;
          stroke:currentColor;
          stroke-width:1.7;
          stroke-linecap:round;
          stroke-linejoin:round
        }
        .head{
          position:sticky;
          top:0;
          z-index:2;
          display:flex;
          align-items:center;
          gap:9px;
          min-height:52px;
          padding:0 12px;
          border-bottom:1px solid var(--line);
          background:rgba(14,18,24,.96);
          cursor:ns-resize
        }
        .head-title{min-width:0;flex:1}
        .head-title b{display:block;font-size:13px}
        .head-title small{
          display:block;
          color:var(--muted);
          white-space:nowrap;
          overflow:hidden;
          text-overflow:ellipsis
        }
        .dot{
          width:8px;
          height:8px;
          border-radius:50%;
          background:var(--accent);
          box-shadow:0 0 0 4px rgba(53,208,127,.12)
        }
        .dot.warn{
          background:var(--warn);
          box-shadow:0 0 0 4px rgba(246,196,83,.12)
        }
        .icon-btn{
          width:30px;
          height:30px;
          display:grid;
          place-items:center;
          border:0;
          border-radius:8px;
          color:var(--muted);
          background:transparent;
          cursor:pointer
        }
        .icon-btn:hover{
          color:#fff;
          background:rgba(255,255,255,.07)
        }
        .body{padding:12px}
        .eyebrow{
          margin:0 0 7px;
          color:rgba(255,255,255,.42);
          font-size:9px;
          font-weight:800;
          letter-spacing:.12em;
          text-transform:uppercase
        }
        .hero{
          position:relative;
          overflow:hidden;
          padding:14px;
          border:1px solid rgba(88,166,255,.28);
          border-radius:15px;
          background:
            radial-gradient(circle at 100% 0,rgba(34,211,238,.14),transparent 38%),
            linear-gradient(145deg,rgba(88,166,255,.15),rgba(53,208,127,.045))
        }
        .hero:after{
          content:"";
          position:absolute;
          right:-28px;
          bottom:-48px;
          width:120px;
          height:120px;
          border:1px solid rgba(255,255,255,.065);
          border-radius:50%;
          pointer-events:none
        }
        .hero-line{
          display:flex;
          align-items:flex-start;
          gap:9px
        }
        .hero h2{
          margin:0;
          font-size:16px;
          line-height:1.15;
          overflow-wrap:anywhere
        }
        .hero p{margin:5px 0 0;color:var(--muted)}
        .case-kicker{
          display:flex;
          align-items:center;
          gap:6px;
          margin-bottom:8px;
          color:#b9dbff;
          font-size:9px;
          font-weight:850;
          letter-spacing:.1em;
          text-transform:uppercase
        }
        .case-kicker span{
          width:6px;
          height:6px;
          border-radius:50%;
          background:var(--focus);
          box-shadow:0 0 0 4px rgba(88,166,255,.12)
        }
        .chips{
          display:flex;
          flex-wrap:wrap;
          gap:6px;
          margin-top:10px
        }
        .chip{
          max-width:100%;
          padding:5px 7px;
          border:1px solid var(--line);
          border-radius:8px;
          color:rgba(255,255,255,.78);
          background:rgba(255,255,255,.045);
          white-space:nowrap;
          overflow:hidden;
          text-overflow:ellipsis
        }
        .chip strong{color:#fff}
        .section{margin-top:7px}
        .card{
          padding:10px;
          border:1px solid var(--line);
          border-radius:12px;
          background:var(--card)
        }
        .card.warn{border-color:rgba(246,196,83,.28)}
        .card.ready{border-color:rgba(53,208,127,.3)}
        .card.pending{border-color:rgba(96,165,250,.34);background:rgba(96,165,250,.075)}
        .card+.card{margin-top:7px}
        .label{color:var(--muted);font-size:10px}
        .value{
          margin-top:2px;
          color:#fff;
          font-weight:700;
          overflow-wrap:anywhere
        }
        .empty{color:rgba(255,255,255,.36);font-weight:500}
        .grid{
          display:grid;
          grid-template-columns:1fr 1fr;
          gap:7px
        }
        .shell.compact .grid{grid-template-columns:1fr}
        .fact{
          min-height:70px;
          padding:9px;
          border:1px solid var(--line);
          border-radius:10px;
          background:var(--card)
        }
        .fact .value{font-size:12px}
        .source{
          margin-top:4px;
          color:rgba(255,255,255,.34);
          font-size:9px;
          white-space:nowrap;
          overflow:hidden;
          text-overflow:ellipsis
        }
        .card .source{
          white-space:normal;
          overflow:visible;
          text-overflow:clip;
          line-height:1.4
        }
        .fact .source{
          white-space:nowrap;
          overflow:hidden;
          text-overflow:ellipsis
        }
        .learning{
          margin-top:8px;
          padding:7px 8px;
          border:1px solid rgba(96,165,250,.18);
          border-radius:8px;
          color:rgba(232,242,255,.78);
          background:rgba(96,165,250,.065);
          font-size:10.5px;
          line-height:1.4
        }
        .learning b{color:#dcecff}
        .live-case{
          padding:10px 11px;
          border:1px solid var(--line);
          border-radius:12px;
          background:rgba(255,255,255,.035)
        }
        .live-case-main{
          display:flex;
          align-items:center;
          gap:8px
        }
        .live-case-main>div{min-width:0;flex:1}
        .live-case-main .value{
          margin:0;
          overflow:hidden;
          text-overflow:ellipsis;
          white-space:nowrap
        }
        .snapshot-light{
          width:8px;
          height:8px;
          flex:0 0 auto;
          border-radius:50%;
          background:var(--warn)
        }
        .snapshot-light.ready{background:var(--accent)}
        .snapshot-light.error{background:var(--danger)}
        .live-stage{
          max-width:46%;
          color:rgba(255,255,255,.54);
          font-size:9px;
          text-align:right
        }
        .snapshot-meta{
          display:flex;
          flex-wrap:wrap;
          gap:4px 10px;
          margin-top:6px;
          color:rgba(255,255,255,.38);
          font-size:9px
        }
        .live-fingerprint{
          padding:10px 11px;
          overflow:hidden;
          border:1px solid rgba(255,255,255,.12);
          border-radius:12px;
          background:rgba(255,255,255,.035)
        }
        .live-fingerprint.ready{border-color:rgba(53,208,127,.25)}
        .live-fingerprint.warn{border-color:rgba(246,196,83,.25)}
        .fingerprint-head{
          display:flex;
          align-items:center;
          justify-content:space-between;
          gap:10px
        }
        .fingerprint-state{
          min-width:0;
          display:flex;
          align-items:center;
          gap:7px
        }
        .fingerprint-state strong{
          overflow:hidden;
          text-overflow:ellipsis;
          white-space:nowrap
        }
        .fingerprint-head small{
          flex:0 0 auto;
          color:rgba(255,255,255,.32);
          font-size:8.5px
        }
        .fingerprint-facts{
          display:grid;
          grid-template-columns:repeat(2,minmax(0,1fr));
          margin-top:8px;
          border-top:1px solid rgba(255,255,255,.075);
          border-left:1px solid rgba(255,255,255,.075)
        }
        .snapshot-fact{
          min-width:0;
          padding:6px 7px;
          border-right:1px solid rgba(255,255,255,.075);
          border-bottom:1px solid rgba(255,255,255,.075)
        }
        .snapshot-fact span{
          display:block;
          color:rgba(255,255,255,.34);
          font-size:8px;
          letter-spacing:.04em;
          text-transform:uppercase
        }
        .snapshot-fact strong{
          display:block;
          margin-top:1px;
          overflow:hidden;
          color:rgba(255,255,255,.88);
          font-size:10px;
          text-overflow:ellipsis;
          white-space:nowrap
        }
        .fingerprint-foot{
          margin-top:6px;
          overflow:hidden;
          color:rgba(255,255,255,.34);
          font-size:8.5px;
          text-overflow:ellipsis;
          white-space:nowrap
        }
        .line-snapshot{
          display:grid;
          grid-template-columns:minmax(0,1fr) auto;
          gap:3px 10px;
          align-items:center;
          padding:9px 11px;
          border:1px solid var(--line);
          border-radius:12px;
          background:rgba(255,255,255,.03)
        }
        .line-snapshot.ready{border-color:rgba(53,208,127,.25)}
        .line-snapshot.warn{border-color:rgba(246,196,83,.25)}
        .line-snapshot .line-state{font-weight:750;text-align:right}
        .line-snapshot .line-facts{
          grid-column:1/-1;
          overflow:hidden;
          color:rgba(255,255,255,.38);
          font-size:8.5px;
          text-overflow:ellipsis;
          white-space:nowrap
        }
        .live-next{
          padding:9px 11px;
          border-left:3px solid var(--focus);
          border-radius:0 10px 10px 0;
          background:rgba(88,166,255,.055)
        }
        .live-next .source{margin-top:2px}
        .terminal-evidence{
          display:grid;
          gap:6px;
          margin-top:9px
        }
        .terminal-evidence-row{
          display:grid;
          grid-template-columns:18px 58px minmax(0,1fr);
          align-items:center;
          gap:6px;
          padding:7px;
          border:1px solid rgba(255,255,255,.09);
          border-radius:9px;
          background:rgba(255,255,255,.035)
        }
        .terminal-evidence-row .signal{
          width:18px;
          height:18px;
          display:grid;
          place-items:center;
          border-radius:50%;
          color:#07150e;
          background:var(--accent);
          font-size:11px;
          font-weight:900
        }
        .terminal-evidence-row.attention .signal,
        .terminal-evidence-row.conflict .signal{
          color:#211400;
          background:var(--warn)
        }
        .terminal-evidence-row .evidence-name{
          color:rgba(255,255,255,.55);
          font-size:9px;
          font-weight:800;
          letter-spacing:.05em;
          text-transform:uppercase
        }
        .terminal-evidence-row .evidence-value{
          min-width:0;
          color:#fff;
          font-size:10px;
          font-weight:700;
          overflow-wrap:anywhere
        }
        .confidence{color:rgba(255,255,255,.46)}
        .progress{
          height:6px;
          margin-top:10px;
          overflow:hidden;
          border-radius:99px;
          background:rgba(255,255,255,.08)
        }
        .progress span{
          display:block;
          height:100%;
          border-radius:inherit;
          background:linear-gradient(90deg,var(--blue),var(--accent))
        }
        .progress-label{
          display:flex;
          justify-content:space-between;
          gap:8px;
          margin-top:6px;
          color:var(--muted);
          font-size:10px
        }
        .journal{display:grid;gap:7px}
        .event{
          padding:9px;
          border-left:2px solid rgba(255,255,255,.18);
          border-radius:0 9px 9px 0;
          background:rgba(255,255,255,.04)
        }
        .event.fact{border-left-color:var(--accent)}
        .event.navigation{border-left-color:var(--blue)}
        .event.diagnostic{border-left-color:var(--warn)}
        .event.handoff{border-left-color:#a78bfa}
        .event.operator_click,.event.operator_double_click{border-left-color:#fb923c}
        .event.operator_selection{border-left-color:#f472b6}
        .event.operator_navigation,.event.operator_return{border-left-color:#38bdf8}
        .event.operator_change,.event.operator_submit,.event.operator_key{border-left-color:#c084fc}
        .event.operator_hover,.event.operator_scroll{border-left-color:#94a3b8}
        .event.route_guard,.event.interaction_guard,.event.interaction_warning{border-left-color:#f59e0b}
        .event .time{
          color:rgba(255,255,255,.36);
          font-size:9px
        }
        .event .message{
          margin-top:2px;
          color:rgba(255,255,255,.82);
          overflow-wrap:anywhere
        }
        .event .trace-detail{margin-top:6px;padding-top:6px;border-top:1px dashed rgba(255,255,255,.1);display:grid;gap:3px;color:rgba(255,255,255,.53);font-size:9px;overflow-wrap:anywhere}
        .event .trace-detail b{color:rgba(255,255,255,.75);font-weight:700}
        .event .trace-dom{font-family:ui-monospace,SFMono-Regular,Consolas,monospace;color:rgba(255,255,255,.42)}
        .actions{
          display:flex;
          flex-wrap:wrap;
          gap:7px
        }
        .action{
          min-height:34px;
          padding:0 10px;
          display:inline-flex;
          align-items:center;
          gap:6px;
          border:1px solid var(--line);
          border-radius:9px;
          color:#fff;
          background:rgba(255,255,255,.065);
          cursor:pointer
        }
        .action:hover{filter:brightness(1.15)}
        .action.primary{
          border-color:rgba(53,208,127,.28);
          color:#07150e;
          background:var(--accent);
          font-weight:800
        }
        .action.danger{
          color:#fecdd3;
          background:rgba(251,113,133,.12)
        }
        .toggle{
          display:flex;
          align-items:center;
          justify-content:space-between;
          gap:10px;
          padding:10px 0;
          border-bottom:1px solid var(--line)
        }
        .toggle:last-child{border-bottom:0}
        .switch{
          width:38px;
          height:22px;
          padding:2px;
          border:0;
          border-radius:99px;
          background:rgba(255,255,255,.14);
          cursor:pointer
        }
        .switch span{
          display:block;
          width:18px;
          height:18px;
          border-radius:50%;
          background:#fff;
          transition:.18s
        }
        .switch.on{background:var(--accent)}
        .switch.on span{transform:translateX(16px)}
        .toast{
          position:absolute;
          right:64px;
          bottom:12px;
          max-width:280px;
          padding:8px 10px;
          border:1px solid var(--line);
          border-radius:9px;
          color:#fff;
          background:rgba(18,23,30,.98);
          opacity:0;
          transform:translateY(5px);
          transition:.16s;
          pointer-events:none;
          font:12px/1.35 system-ui
        }
        .toast.show{opacity:1;transform:none}
      </style>`;
  const plum = `<style>
        :host{
          color-scheme:light;
          --plum:#A50046;
          --plum-hover:#870039;
          --plum-soft:#FFF1F6;
          --plum-line:#E7B7CB;
          --bg:#FFFFFF;
          --rail:#FFFFFF;
          --card:#FFFFFF;
          --line:#E4E7EC;
          --muted:#667085;
          --text:#1D2939;
          --accent:#A50046;
          --warn:#D97706;
          --danger:#D92D20;
          --blue:#2563EB;
          --focus:#A50046;
          --cyan:#A50046;
          --violet:#7C3AED
        }
        .shell{
          position:relative;
          display:flex;
          align-items:flex-start;
          gap:4px;
          width:auto;
          height:auto;
          margin-top:168px;
          filter:none;
          color:var(--text);
          font:12px/1.45 Inter,system-ui,-apple-system,"Segoe UI",sans-serif
        }
        .view-backdrop{
          position:fixed;
          inset:0;
          z-index:0;
          opacity:0;
          pointer-events:none;
          background:rgba(24,30,42,.08);
          backdrop-filter:saturate(.9);
          transition:opacity .18s ease
        }
        .view-backdrop.show{opacity:1;pointer-events:auto}
        .view-backdrop.live{background:rgba(24,30,42,.06)}
        .view-backdrop.full{background:rgba(24,30,42,.08)}
        .drawer{
          position:relative;
          right:auto;
          top:auto;
          bottom:auto;
          width:0;
          height:auto;
          max-height:min(72vh,560px);
          z-index:1;
          overflow:hidden;
          opacity:0;
          transform:translateX(6px);
          border:1px solid transparent;
          border-radius:9px;
          background:rgba(255,255,255,.99);
          box-shadow:0 8px 28px rgba(0,0,0,.18);
          backdrop-filter:blur(14px);
          transition:width .2s ease,opacity .14s ease,transform .2s ease,border-color .14s ease
        }
        .shell.open .drawer{width:220px;opacity:1;transform:none;border-color:var(--line)}
        .shell.full.open .drawer{width:min(252px,calc(100vw - 72px))}
        .shell.compact.open .drawer{width:220px}
        .panel{width:220px;height:auto;max-height:min(72vh,560px);color:var(--text);scrollbar-color:#CBD5E1 transparent;overflow:auto}
        .shell.full .panel{width:min(252px,calc(100vw - 72px))}
        .shell.compact .panel{width:220px}
        .rail{
          position:relative;
          z-index:2;
          width:46px;
          height:auto;
          display:flex;
          flex-direction:column;
          gap:0;
          overflow:hidden;
          border:1px solid #343941;
          border-radius:11px;
          background:#202329;
          box-shadow:0 5px 18px rgba(0,0,0,.20);
          backdrop-filter:none;
          padding:4px 3px
        }
        .rail-stack{display:flex;flex-direction:column;gap:1px}
        .rail-divider{height:1px;background:#3b4048;margin:4px 4px;display:block}
        .brand,.rail-btn{
          position:relative;
          width:38px;height:40px;margin:1px 0;border:0;border-radius:8px;
          color:#cbd1d8;background:transparent;
          box-shadow:none;
          backdrop-filter:none;
          transition:background .12s ease,color .12s ease
        }
        .rail-btn:hover{
          color:#fff;background:#373c44;border-color:transparent;transform:none
        }
        .rail-btn.active{
          color:#fff;background:var(--plum);border-color:transparent;
          box-shadow:none
        }
        .rail-btn.active:before{display:none}
        .rail-btn.call-quick{color:#cbd1d8;background:transparent;border-color:transparent}
        .rail-btn.call-quick:hover{color:#fff;background:#373c44;border-color:transparent}
        .rail-btn.call-quick.active{color:#fff;background:var(--plum);border-color:transparent}
        .rail-btn.live-ready:after{
          content:"";position:absolute;right:5px;top:5px;width:6px;height:6px;border-radius:50%;
          background:#12B76A;border:1.5px solid #202329;box-shadow:none
        }
        .rail-btn.more{width:38px;height:40px;margin:1px 0;color:#cbd1d8;background:transparent;border-color:transparent}
        .rail-btn.more.active{color:#fff;background:var(--plum)}
        .rail-label{
          position:absolute;right:48px;top:50%;transform:translateY(-50%) translateX(5px);
          opacity:0;pointer-events:none;white-space:nowrap;padding:5px 7px;border:1px solid #E4E7EC;
          border-radius:6px;background:#fff;color:#344054;box-shadow:0 5px 14px rgba(16,24,40,.12);
          font-size:10px;font-weight:700;transition:.12s;z-index:5
        }
        .rail-btn:hover .rail-label{opacity:1;transform:translateY(-50%) translateX(0)}
        .head{
          background:rgba(255,255,255,.97);border-bottom-color:#EAECF0;cursor:default;
          min-height:44px;padding:0 10px
        }
        .head-title b{color:#1D2939;font-size:13.5px}.head-title small{color:#667085}
        .dot{background:var(--plum);box-shadow:0 0 0 4px rgba(165,0,70,.10)}
        .dot.warn{background:#F79009;box-shadow:0 0 0 4px rgba(247,144,9,.12)}
        .icon-btn{color:#667085}.icon-btn:hover{color:#344054;background:#F2F4F7}
        .body{padding:9px;background:#FCFCFD}
        .eyebrow{color:#98A2B3}
        .hero{
          border-color:#E9C2D2;background:linear-gradient(145deg,#FFF5F8,#FFFFFF 72%);
          box-shadow:0 1px 0 rgba(165,0,70,.03)
        }
        .hero p,.label{color:#667085}.hero h2,.value{color:#1D2939}
        .case-kicker{color:var(--plum)}.case-kicker span{background:var(--plum);box-shadow:0 0 0 4px rgba(165,0,70,.10)}
        .chip{border-color:#E4E7EC;color:#475467;background:#F9FAFB}.chip strong{color:#1D2939}
        .card,.fact{border-color:#E4E7EC;background:#fff;box-shadow:0 1px 2px rgba(16,24,40,.025);padding:8px 9px;border-radius:9px}
        .card.warn{border-color:#FEDF89;background:#FFFAEB}.card.ready{border-color:#ABEFC6;background:#F6FEF9}
        .card.pending{border-color:#C7D7FE;background:#F5F8FF}
        .source{color:#98A2B3}.empty{color:#98A2B3}
        .learning{border-color:#E9C2D2;color:#694052;background:#FFF5F8}.learning b{color:#4A1630}
        .live-case,.live-fingerprint,.line-snapshot{border-color:#E4E7EC;background:#fff;box-shadow:0 1px 2px rgba(16,24,40,.025)}
        .live-fingerprint.ready,.line-snapshot.ready{border-color:#ABEFC6;background:#F6FEF9}.live-fingerprint.warn,.line-snapshot.warn{border-color:#FEDF89;background:#FFFAEB}
        .live-stage,.snapshot-meta,.fingerprint-head small,.fingerprint-foot,.line-snapshot .line-facts{color:#98A2B3}
        .fingerprint-facts{border-top-color:#EAECF0;border-left-color:#EAECF0}.snapshot-fact{border-right-color:#EAECF0;border-bottom-color:#EAECF0}.snapshot-fact span{color:#98A2B3}.snapshot-fact strong{color:#344054}
        .live-next{border-left-color:var(--plum);background:#FFF5F8}.live-next .value{color:#4A1630}
        .pon-ready-action{margin-top:10px}
        .live-context-card{
          padding:8px 9px;border:1px solid #E4E7EC;border-radius:9px;background:#fff;
          box-shadow:0 1px 2px rgba(16,24,40,.025)
        }
        .live-context-card.attention{border-color:#E9C2D2;background:#FFF8FB}
        .live-context-card.final-step{border-color:#E9C2D2;background:#FFF8FB;box-shadow:0 1px 2px rgba(165,0,70,.035)}
        .live-context-card.final-step .live-nav-title{color:#4A1630}
        .live-context-card .value{margin-top:2px;font-size:11px;font-weight:800}
        .live-context-card .source{margin-top:3px;line-height:1.35;font-size:9.5px}
        .live-nav-title{display:flex;align-items:center;gap:6px;color:#1D2939;font-size:11px;font-weight:800}
        .live-nav-title span:first-child{min-width:0;flex:0 1 auto}
        .live-nav-help{position:relative;display:inline-grid;place-items:center;width:18px;height:18px;flex:0 0 18px;border:1px solid #D0D5DD;border-radius:50%;background:#fff;color:#667085;font:800 10px/1 Arial,sans-serif;cursor:help;outline:none}
        .live-nav-help:hover,.live-nav-help:focus-visible{border-color:#C86B91;color:var(--plum);background:#FFF5F8}
        .live-nav-help:after{content:attr(data-help);position:absolute;right:calc(100% + 8px);top:50%;width:250px;max-width:min(250px,65vw);padding:8px 10px;border:1px solid #E4E7EC;border-radius:9px;background:#fff;color:#344054;box-shadow:0 10px 28px rgba(16,24,40,.16);font:500 11px/1.35 Inter,system-ui,-apple-system,"Segoe UI",sans-serif;text-align:left;white-space:normal;opacity:0;visibility:hidden;transform:translateY(-50%) translateX(4px);transition:opacity .12s ease,transform .12s ease,visibility .12s ease;pointer-events:none;z-index:8}
        .live-nav-help:hover:after,.live-nav-help:focus-visible:after{opacity:1;visibility:visible;transform:translateY(-50%) translateX(0)}
        .juniper-essential{grid-template-columns:repeat(2,minmax(0,1fr))}
        .live-onu-result .value{color:#067647}
        .terminal-evidence-row{border-color:#E4E7EC;background:#fff}.terminal-evidence-row .signal{color:#fff;background:#12B76A}.terminal-evidence-row.attention .signal,.terminal-evidence-row.conflict .signal{color:#fff;background:#F79009}.terminal-evidence-row .evidence-name{color:#667085}.terminal-evidence-row .evidence-value{color:#344054}.confidence{color:#98A2B3}
        .progress{background:#EAECF0}.progress span{background:linear-gradient(90deg,#C34C7D,var(--plum))}
        .live-progress{height:5px;margin:2px 0 6px;border-radius:99px;overflow:hidden;background:#EAECF0}
        .live-progress span{display:block;height:100%;border-radius:inherit;background:linear-gradient(90deg,#C34C7D,var(--plum));transition:width .2s ease}
        .evidence-row.pending{border-color:#EEF0F3;background:#FAFBFC}
        .evidence-row.pending .check{background:#F2F4F7;color:#98A2B3;font-size:11px;font-weight:700}
        .evidence-row.pending .evidence-row-main b{color:#98A2B3}
        .evidence-row.pending .evidence-row-main span{color:#B0B7C3}
        .evidence-spacer{width:22px;height:22px}
        .event{border-left-color:#D0D5DD;background:#fff;box-shadow:0 1px 2px rgba(16,24,40,.025)}.event .time{color:#98A2B3}.event .message{color:#344054}.event .trace-detail{border-top-color:#EAECF0;color:#667085}.event .trace-detail b{color:#475467}.event .trace-dom{color:#98A2B3}
        .action{
          border-color:#D0D5DD!important;background:#fff!important;color:#344054!important;
          box-shadow:0 1px 2px rgba(16,24,40,.04)
        }
        .action:hover{background:#F9FAFB!important;border-color:#98A2B3!important}
        .action.primary{border-color:var(--plum)!important;background:var(--plum)!important;color:#fff!important}
        .action.primary:hover{background:var(--plum-hover)!important}
        .action.danger{border-color:#FECDCA!important;color:#B42318!important;background:#FFF8F7!important}
        .full-nav{display:grid;grid-template-columns:repeat(5,1fr);gap:6px;margin-bottom:12px}
        .full-nav button{
          min-width:0;height:62px;padding:6px;border:1px solid #E4E7EC;border-radius:11px;
          background:#fff;color:#475467;display:grid;place-items:center;gap:3px;cursor:pointer;font:700 9px/1.2 inherit
        }
        .full-nav button svg{width:19px;height:19px;color:var(--plum)}
        .full-nav button.active{border-color:#E3A8C0;background:#FFF1F6;color:#6D1438}
        .diagnostics-badge{position:absolute;right:5px;top:5px;min-width:17px;height:17px;padding:0 4px;border-radius:9px;background:#A50046;color:#fff;font:800 9px/17px Inter,system-ui;text-align:center;box-shadow:0 0 0 2px #fff}
        .diag-list{display:grid;gap:7px}
        .diag-item{border:1px solid #E4E7EC;border-radius:11px;background:#fff;padding:10px}
        .diag-item.unread{border-color:#E3A8C0;box-shadow:inset 3px 0 0 #A50046}
        .diag-top{display:flex;align-items:center;gap:6px;flex-wrap:wrap}
        .diag-level{font:800 9px/1 Inter,system-ui;padding:4px 6px;border-radius:999px;background:#F2F4F7;color:#344054}
        .diag-level.ERROR,.diag-level.CRITICAL{background:#FEF3F2;color:#B42318}.diag-level.WARNING{background:#FFFAEB;color:#B54708}.diag-level.NOTICE{background:#F4EBFF;color:#6941C6}
        .diag-code{font:800 10px/1.2 ui-monospace,SFMono-Regular,Consolas,monospace;color:#344054;overflow-wrap:anywhere}
        .diag-message{margin-top:6px;font:650 11px/1.35 Inter,system-ui;color:#101828;overflow-wrap:anywhere}
        .diag-meta{margin-top:5px;font:500 9px/1.35 Inter,system-ui;color:#667085}
        .diag-details{margin-top:7px;padding-top:7px;border-top:1px solid #F2F4F7;font:500 9px/1.4 ui-monospace,SFMono-Regular,Consolas,monospace;color:#475467;white-space:pre-wrap;overflow-wrap:anywhere}

        .live-case.compact-identity{padding:8px 9px;display:grid;gap:5px}
        .live-identity-row{display:flex;align-items:flex-start;justify-content:space-between;gap:10px}
        .live-identity-main{min-width:0}
        .live-identity-main .value{font-size:13px;font-weight:850;line-height:1.2;color:#1D2939}
        .live-identity-main .source{margin-top:2px;color:#98A2B3;font-size:9px}
        .live-connectivity{display:inline-flex;align-items:center;gap:4px;flex:0 0 auto;padding:3px 6px;border-radius:999px;background:#F2F4F7;color:#667085;font-size:8.5px;font-weight:850}
        .live-connectivity.online{background:#ECFDF3;color:#067647}.live-connectivity.offline{background:#FEF3F2;color:#B42318}.live-connectivity.unknown{background:#F2F4F7;color:#667085}
        .live-connectivity i{width:6px;height:6px;border-radius:50%;background:currentColor}
        .live-traffic-row{display:flex;align-items:center;gap:10px;flex-wrap:wrap;color:#667085;font-size:9px}
        .live-traffic-row b{color:#344054;font-weight:750}.live-traffic-row time{margin-left:auto;color:#98A2B3}
        .evidence-history{display:grid;gap:4px}.evidence-history-head{display:flex;align-items:center;justify-content:space-between;color:#667085;font-size:8.5px;font-weight:800;text-transform:uppercase;letter-spacing:.04em}
        .evidence-row{display:grid;grid-template-columns:18px minmax(0,1fr) 24px;align-items:center;gap:6px;padding:5px 7px;border:1px solid #E4E7EC;border-radius:8px;background:#fff}
        .evidence-row .check{display:grid;place-items:center;width:18px;height:18px;border-radius:50%;background:#ECFDF3;color:#067647;font-size:10px;font-weight:900}.evidence-row.attention .check{background:#FFFAEB;color:#B54708}.evidence-row.active .check{background:#FFF1F6;color:#A50046}
        .evidence-row-main{min-width:0}.evidence-row-main b{display:block;color:#344054;font-size:10px}.evidence-row-main span{display:block;margin-top:1px;color:#667085;font-size:8.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
        .evidence-replay{display:grid;place-items:center;width:22px;height:22px;border:1px solid #E4E7EC;border-radius:6px;background:#fff;color:#A50046;font:900 13px/1 system-ui;cursor:pointer}.evidence-replay:hover{border-color:#D6A0B7;background:#FFF5F8}
        .live-next-one{display:none}.compact-actions .actions{margin:0}.compact-actions .action{padding:5px 8px;font-size:10px;border-radius:7px}

        .toast{position:fixed;right:82px;bottom:20px;border-color:#E4E7EC;background:#fff;color:#344054;box-shadow:0 12px 32px rgba(16,24,40,.16)}
        .attention-wrap{
          position:absolute;top:0;right:0;display:flex;flex-direction:column;align-items:flex-end;
          margin:0;z-index:3;pointer-events:auto
        }
        .attention-bell{
          width:40px;height:40px;border-radius:9px;border:1px solid #343941;
          background:#202329;color:#f3f5f7;display:grid;place-items:center;
          cursor:pointer;position:relative;box-shadow:0 5px 16px rgba(0,0,0,.16);
          padding:0
        }
        .attention-bell svg{width:20px;height:20px;stroke:currentColor;fill:none;stroke-width:1.7;stroke-linecap:round;stroke-linejoin:round}
        .attention-bell:hover{background:#2a2f37}
        .attention-bell.has-items{border-color:#5a2a3a}
        .attention-badge{
          position:absolute;right:-6px;top:-7px;min-width:19px;height:19px;padding:0 4px;
          border-radius:11px;display:grid;place-items:center;background:var(--plum);color:#fff;
          border:2px solid #e7eaee;font:bold 9px Arial
        }
        .attention-popup{
          position:absolute;right:0;top:46px;width:228px;background:#fff;border:1px solid var(--line);
          border-radius:8px;box-shadow:0 8px 25px rgba(0,0,0,.18);overflow:hidden;z-index:6
        }
        .attention-head{
          height:33px;display:flex;align-items:center;padding:0 8px;background:#fafafa;
          border-bottom:1px solid #e3e6e9;font-size:10.5px;color:#1D2939
        }
        .attention-head b{font-size:10.5px}
        .attention-x{margin-left:auto;border:0;background:transparent;color:#838b95;font-size:15px;cursor:pointer;line-height:1}
        .attention-issue{
          display:grid;grid-template-columns:18px 1fr;padding:7px 8px;border-bottom:1px solid #eee;
          font-size:10.5px;color:#1D2939;gap:4px
        }
        .attention-issue:last-child{border:0}
        .attention-issue small{display:block;color:#7b838d;margin-top:2px;font-size:9.5px}
        .attention-issue .warn{color:#b47c00;font-weight:800}
        .attention-issue .unk{color:#9099a4;font-weight:800}

        .toast[data-kind="warning"]{max-width:460px;padding:14px 16px;border:1px solid #E6B2C8;border-left:4px solid var(--plum);border-radius:12px;background:#FFF8FB;color:#4A1630;box-shadow:0 18px 46px rgba(16,24,40,.22);font:700 14px/1.42 system-ui}
        @media (prefers-reduced-motion:reduce){.drawer,.view-backdrop,.rail-btn,.rail-label{transition:none!important}}
      </style>`;
  WB.railStyles = Object.freeze({ base, plum });
})();
