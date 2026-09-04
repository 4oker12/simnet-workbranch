import { postprocessTranscript } from './ai-postprocessor.js';

const USERSIDE_ORIGIN = 'https://userside.simnet.kiev.ua';
const SUPPORT_PATH = '/customer/tab';
const COMMENT_DIALOG_PATH = '/task/dialog_add_comment';
const COMMENT_POST_PATH = '/task/comment_add';
const TASK_MATCH_WINDOW_MINUTES = 5;
const VERIFY_MARKER_PREFIX = 'CALL #';

function clean(value, max = 500) {
  return String(value == null ? '' : value).replace(/\s+/g, ' ').trim().slice(0, max);
}

function digits(value, max = 24) {
  return String(value == null ? '' : value).replace(/\D+/g, '').slice(0, max);
}

function decodeHtml(value) {
  return String(value == null ? '' : value)
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#0*39;|&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#([0-9]+);/g, (_, dec) => String.fromCodePoint(parseInt(dec, 10)))
    .replace(/&nbsp;/gi, ' ');
}

function textFromHtml(value) {
  return decodeHtml(String(value == null ? '' : value)
    .replace(/<br\s*\/?\s*>/gi, '\n')
    .replace(/<[^>]+>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim();
}

function comparable(value) {
  return textFromHtml(value)
    .toLowerCase()
    .replace(/[^0-9a-zа-яёіїєґ#]+/giu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function attrValue(tag, name) {
  const escaped = String(name).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = String(tag || '').match(new RegExp(`\\b${escaped}\\s*=\\s*(["'])([\\s\\S]*?)\\1`, 'i'));
  return match ? decodeHtml(match[2]) : '';
}

async function fetchText(url, options = {}, label = 'UserSide') {
  const response = await fetch(url, {
    credentials: 'include',
    cache: 'no-store',
    redirect: 'follow',
    ...options
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`${label}: HTTP ${response.status}`);
  }
  const finalUrl = String(response.url || '');
  if (finalUrl && !finalUrl.startsWith(USERSIDE_ORIGIN)) {
    throw new Error(`${label}: неожиданный redirect`);
  }
  return { response, text };
}

function kyivMinuteText(value) {
  const date = new Date(String(value || ''));
  if (!Number.isFinite(date.getTime())) return '';
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Kyiv',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23'
  }).formatToParts(date).filter(part => part.type !== 'literal').map(part => [part.type, part.value]));
  return `${parts.day}.${parts.month}.${parts.year} ${parts.hour}:${parts.minute}`;
}

function minuteNumber(localText) {
  const match = String(localText || '').match(/^(\d{2})\.(\d{2})\.(\d{4})\s+(\d{2}):(\d{2})$/);
  if (!match) return NaN;
  return Date.UTC(Number(match[3]), Number(match[2]) - 1, Number(match[1]), Number(match[4]), Number(match[5])) / 60000;
}

function registrationTasks(html = '') {
  const source = String(html || '');
  const re = /<a\b[^>]*href\s*=\s*(["'])\/task\/(\d+)\1[^>]*>([\s\S]*?)<\/a>/gi;
  const seen = new Set();
  const tasks = [];
  let match;
  while ((match = re.exec(source))) {
    const taskId = digits(match[2], 14);
    if (!taskId || seen.has(taskId)) continue;
    const title = textFromHtml(match[3]);
    if (!/(?:реєстрац(?:ія|iя)\s+звернення|регистрац(?:ия|ія)\s+обращения)/iu.test(title)) continue;
    const chunk = source.slice(match.index, Math.min(source.length, match.index + 3200));
    const timeMatch = chunk.match(/(\d{2}\.\d{2}\.\d{4}\s+\d{2}:\d{2})/);
    seen.add(taskId);
    tasks.push({
      taskId,
      title: clean(title, 240),
      createdLocal: timeMatch ? timeMatch[1] : '',
      index: match.index
    });
  }
  return tasks;
}

function chooseRegistrationTask(html, job = {}) {
  const tasks = registrationTasks(html);
  const targetLocal = kyivMinuteText(job.registeredAt || job.createdAt || job.updatedAt);
  const targetMinute = minuteNumber(targetLocal);
  const scored = tasks.map(task => ({
    ...task,
    diffMinutes: Number.isFinite(targetMinute) && Number.isFinite(minuteNumber(task.createdLocal))
      ? Math.abs(minuteNumber(task.createdLocal) - targetMinute)
      : Number.POSITIVE_INFINITY
  })).filter(task => task.diffMinutes <= TASK_MATCH_WINDOW_MINUTES)
    .sort((a, b) => a.diffMinutes - b.diffMinutes || b.index - a.index);

  if (!scored.length) {
    throw new Error(`WAIT_TASK_ID: не найден свежий UserSide task регистрации около ${targetLocal || 'момента LOCK'}`);
  }
  if (scored.length > 1 && scored[0].diffMinutes === scored[1].diffMinutes) {
    throw new Error(`WAIT_TASK_ID: найдено несколько одинаково близких task регистрации (${scored[0].taskId}, ${scored[1].taskId})`);
  }
  return scored[0];
}

function commentForm(html, expectedTaskId) {
  const source = String(html || '');
  const forms = source.match(/<form\b[\s\S]*?<\/form>/gi) || [];
  const form = forms.find(candidate => {
    const open = candidate.match(/^<form\b[^>]*>/i)?.[0] || '';
    const action = attrValue(open, 'action');
    try {
      const url = new URL(action, USERSIDE_ORIGIN);
      return url.origin === USERSIDE_ORIGIN && url.pathname === COMMENT_POST_PATH;
    } catch {
      return false;
    }
  });
  if (!form) throw new Error('USERSIDE_WRITE: форма добавления комментария не найдена');

  const open = form.match(/^<form\b[^>]*>/i)?.[0] || '';
  const action = new URL(attrValue(open, 'action'), USERSIDE_ORIGIN);
  const params = new URLSearchParams();
  for (const tag of form.match(/<input\b[^>]*>/gi) || []) {
    const name = attrValue(tag, 'name');
    if (!name) continue;
    const type = attrValue(tag, 'type').toLowerCase();
    if (type && type !== 'hidden') continue;
    params.append(name, attrValue(tag, 'value'));
  }

  const taskId = digits(params.get('id'), 14);
  if (!taskId || taskId !== digits(expectedTaskId, 14)) {
    throw new Error('USERSIDE_WRITE: форма комментария относится к другому task');
  }
  if (!params.get('_csrf')) {
    throw new Error('USERSIDE_WRITE: в форме комментария отсутствует _csrf');
  }
  if (!params.has('standart_comment')) params.set('standart_comment', '');
  return { action: action.href, params };
}

function languageLabel(value) {
  if (value === 'uk') return 'UK';
  if (value === 'ru') return 'RU';
  return 'RU/UK mixed';
}

function transcriptComment(job = {}, transcript = {}, analysis = {}) {
  const callId = digits(job.usersideCallId || transcript.usersideCallId, 24);
  const text = String(analysis.cleanText || '').trim();
  if (!callId || !text) throw new Error('USERSIDE_WRITE: отсутствует CALL id или AI-транскрипт');

  const lines = [
    `Транскрипция звонка ${VERIFY_MARKER_PREFIX}${callId}`,
    `Язык: ${languageLabel(analysis.language)}`,
    '',
    'Текст:',
    text
  ];

  const summary = clean(analysis.summary, 2000);
  const issue = clean(analysis.issue, 1600);
  const actions = clean(analysis.actions, 2000);
  const result = clean(analysis.result, 1600);
  const nextStep = clean(analysis.nextStep, 1600);
  if (summary || issue || actions || result || nextStep) {
    lines.push('', 'AI-разбор:');
    if (summary) lines.push(`Суть: ${summary}`);
    if (issue) lines.push(`Причина обращения: ${issue}`);
    if (actions) lines.push(`Что сделано: ${actions}`);
    if (result) lines.push(`Результат: ${result}`);
    if (nextStep) lines.push(`Дальше: ${nextStep}`);
  }
  return lines.join('\n');
}

async function taskContainsMarker(taskId, marker) {
  const { text } = await fetchText(`${USERSIDE_ORIGIN}/task/${encodeURIComponent(taskId)}`, {}, 'UserSide task verify');
  const haystack = comparable(text);
  const needle = comparable(marker);
  return Boolean(needle && haystack.includes(needle));
}

export async function writeTranscriptToUserSide(job = {}, transcript = {}) {
  const customerId = digits(job.customerId, 14);
  if (!customerId) throw new Error('WAIT_TASK_ID: отсутствует customerId');

  const supportUrl = new URL(SUPPORT_PATH, USERSIDE_ORIGIN);
  supportUrl.searchParams.set('tab', 'support');
  supportUrl.searchParams.set('id', customerId);
  const support = await fetchText(supportUrl.href, {}, 'UserSide support history');
  const task = chooseRegistrationTask(support.text, job);
  const marker = `${VERIFY_MARKER_PREFIX}${digits(job.usersideCallId || transcript.usersideCallId, 24)}`;

  if (await taskContainsMarker(task.taskId, marker)) {
    return { taskId: task.taskId, alreadyWritten: true, verified: true, ai: null };
  }

  const analysis = await postprocessTranscript(job, transcript);
  const comment = transcriptComment(job, transcript, analysis);

  const dialogUrl = new URL(COMMENT_DIALOG_PATH, USERSIDE_ORIGIN);
  dialogUrl.searchParams.set('id', task.taskId);
  const dialog = await fetchText(dialogUrl.href, {}, 'UserSide comment form');
  const form = commentForm(dialog.text, task.taskId);
  form.params.set('comment', comment);
  form.params.set('id', task.taskId);

  const post = await fetchText(form.action, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
    body: form.params.toString()
  }, 'UserSide comment save');

  const verified = await taskContainsMarker(task.taskId, marker);
  if (!verified) {
    throw new Error(`USERSIDE_REVIEW: POST выполнен (HTTP ${post.response.status}), но комментарий не удалось подтвердить чтением task #${task.taskId}`);
  }
  return {
    taskId: task.taskId,
    alreadyWritten: false,
    verified: true,
    ai: {
      language: analysis.language,
      model: analysis.model,
      cached: Boolean(analysis.cached)
    }
  };
}
