'use strict';

(() => {
  const panel = document.querySelector('.settings-panel-lab');
  const manual = panel?.querySelector('[data-accordion-panel="manual"]');
  const body = manual?.querySelector('.lab-section-body');
  if (!body || document.getElementById('aiLabWorkspace')) return;
  const create = (tag, className, text) => {
    const node = document.createElement(tag); node.className = className || '';
    if (text) node.textContent = text; return node;
  };
  const style = create('link'); style.rel = 'stylesheet';
  style.href = chrome.runtime.getURL('src/ui/ai-operator-lab-workspace.css');
  document.head.append(style);
  panel.classList.add('ai-lab-workspace-panel'); manual.open = true;
  manual.removeAttribute('data-accordion-group');
  const toolbar = create('header', 'ai-workspace-toolbar');
  toolbar.append(create('strong', '', 'AI Lab'));
  const model = create('span', 'ai-workspace-model', 'Модель появится после ответа'); model.id = 'aiLabWorkspaceModel'; toolbar.append(model);
  const actions = create('div', 'ai-workspace-actions');
  const settings = create('details', 'ai-workspace-settings');
  settings.append(create('summary', '', 'Настроить'));
  const settingsBody = create('div', 'ai-workspace-settings-body');
  settingsBody.append(document.getElementById('aiLabExperiment'), document.getElementById('aiLabIdentity'));
  settings.append(settingsBody);
  const settingsButton = create('button', '', 'Настроить'); settingsButton.type = 'button'; settingsButton.setAttribute('aria-expanded', 'false');
  settingsButton.onclick = () => { settings.open = !settings.open; settingsButton.setAttribute('aria-expanded', String(settings.open)); };
  const exports = create('details', 'ai-workspace-export'); exports.append(create('summary', '', 'Экспорт'));
  const exportBody = create('div'); exportBody.append(document.getElementById('aiLabDownloadTxt'), document.getElementById('aiLabDownloadJson')); exports.append(exportBody);
  if (!document.body.classList.contains('ai-lab-standalone')) {
    const standalone = create('a', 'ai-workspace-open', 'Открыть отдельно ↗');
    standalone.href = chrome.runtime.getURL('ai-operator-lab.html'); standalone.target = '_blank'; standalone.rel = 'noopener'; actions.append(standalone);
  }
  actions.append(settingsButton, exports, document.getElementById('aiLabReset')); toolbar.append(actions);
  const workspace = create('div', 'ai-workspace'); workspace.id = 'aiLabWorkspace';
  const chat = create('section', 'ai-workspace-chat'); chat.setAttribute('aria-label', 'Диалог с абонентом');
  const chatHead = create('header', 'ai-workspace-chat-head'); chatHead.append(create('strong', '', 'Диалог'), create('span', '', 'Ты пишешь как абонент'));
  const questions = create('details', 'ai-workspace-questions'); questions.append(create('summary', '', 'Тестовая реплика'));
  questions.append(body.querySelector('.ai-lab-question-bank'));
  const questionControls = create('div', 'ai-workspace-question-kinds');
  const kinds = [['basic', 'Прямой'], ['Контекст', 'С контекстом'], ['Неоднозначно', 'Неоднозначный'], ['Продолжение', 'Продолжение']];
  const selectKind = value => {
    questions.dataset.kind = value;
    questionControls.querySelectorAll('button').forEach(button => { const active = button.dataset.kind === value; button.classList.toggle('active', active); button.setAttribute('aria-pressed', String(active)); });
  };
  for (const [value, label] of kinds) { const button = create('button', '', label); button.type = 'button'; button.dataset.kind = value; button.onclick = () => selectKind(value); questionControls.append(button); }
  questions.querySelector('.ai-lab-question-tabs').after(questionControls); selectKind('basic');
  questions.querySelectorAll('[data-ai-lab-prompt]').forEach(button => button.addEventListener('click', () => { questions.open = false; document.getElementById('aiLabInput').focus(); }));
  chat.append(chatHead, document.getElementById('aiLabTranscript'), questions, body.querySelector('.ai-lab-compose'), document.getElementById('aiLabStatus'));
  document.getElementById('aiLabSend').textContent = 'Отправить';
  const inspector = create('aside', 'ai-workspace-inspector'); inspector.setAttribute('aria-label', 'Разбор ответа'); inspector.dataset.view = 'decision';
  const inspectorHead = create('header', 'ai-workspace-inspector-head'); inspectorHead.append(create('strong', '', 'Разбор ответа'));
  const tabs = create('div', 'ai-workspace-tabs'); tabs.setAttribute('role', 'tablist'); tabs.setAttribute('aria-label', 'Разделы разбора');
  for (const [view, label] of [['decision', 'Решение'], ['calls', 'Вызовы'], ['data', 'Данные']]) {
    const button = create('button', view === 'decision' ? 'active' : '', label); button.type = 'button'; button.setAttribute('role', 'tab'); button.setAttribute('aria-selected', String(view === 'decision')); button.dataset.view = view;
    button.onclick = () => { inspector.dataset.view = view; tabs.querySelectorAll('button').forEach(b => { b.classList.toggle('active', b === button); b.setAttribute('aria-selected', String(b === button)); }); }; tabs.append(button);
  }
  inspector.append(inspectorHead, tabs, document.getElementById('aiLabEvents')); workspace.append(chat, inspector);
  const diagnostics = document.querySelector('.ai-lab-diagnostics'); if (diagnostics) { diagnostics.open = false; settingsBody.append(diagnostics); }
  body.querySelector('.ai-lab-head')?.remove(); body.querySelector('.ai-lab-log')?.remove(); body.querySelector('.ai-lab-safety')?.remove();
  body.prepend(toolbar, settings, workspace);
})();
