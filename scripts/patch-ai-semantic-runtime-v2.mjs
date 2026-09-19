import { readFile, writeFile } from 'node:fs/promises';

const target = new URL('../src/features/ai-operator/semantic-probe.js', import.meta.url);
let source = await readFile(target, 'utf8');

function occurrences(text, needle) {
  if (!needle) return 0;
  return text.split(needle).length - 1;
}

function replaceOnce(label, before, after) {
  const count = occurrences(source, before);
  if (count !== 1) throw new Error(`${label}: expected exactly 1 match, got ${count}`);
  source = source.replace(before, after);
}

function replaceCount(label, before, after, expected) {
  const count = occurrences(source, before);
  if (count !== expected) throw new Error(`${label}: expected ${expected} matches, got ${count}`);
  source = source.split(before).join(after);
}

replaceOnce(
  'behavior contract import',
  "import { autonomousOperatorSystemMessages } from './instructions/autonomous-operator-instruction.generated.js';\n",
  "import { autonomousOperatorSystemMessages } from './instructions/autonomous-operator-instruction.generated.js';\nimport { behaviorPromptGuidance, behaviorRuntimeHints } from './behavior-profile.js';\n"
);

replaceOnce(
  'provider-specific model pool',
  `function modelsForRuntime(runtime = {}) {
  const preferred = String(runtime.chatModel || AI_CONFIG.model || '').trim();
  const all = [preferred, ...GENERATION_FALLBACK_MODELS]
    .filter((model, index, list) => model && !RETIRED_MODELS.has(model) && model !== PROMPT_GUARD_MODEL && list.indexOf(model) === index);
  const ready = all.filter(model => !isCoolingDown(model));
  return ready.length ? ready : all;
}`,
  `function modelsForRuntime(runtime = {}) {
  const preferred = String(runtime.chatModel || AI_CONFIG.model || '').trim();
  const provider = String(runtime.provider || AI_CONFIG.provider || 'groq').trim().toLowerCase();
  if (provider !== 'groq') return preferred ? [preferred] : [];
  const all = [preferred, ...GENERATION_FALLBACK_MODELS]
    .filter((model, index, list) => model && !RETIRED_MODELS.has(model) && model !== PROMPT_GUARD_MODEL && list.indexOf(model) === index);
  const ready = all.filter(model => !isCoolingDown(model));
  return ready.length ? ready : all;
}`
);

replaceOnce(
  'provider metadata parse',
  `    let data = null;
    try { data = raw ? JSON.parse(raw) : null; } catch {}
    reportedUsage = data?.usage || null;`,
  `    let data = null;
    try { data = raw ? JSON.parse(raw) : null; } catch {}
    const promptGuardSkipped = response.headers?.get?.('x-simnet-prompt-guard-skipped') === '1'
      || data?.simnet?.prompt_guard_skipped === true;
    const promptGuardSkipReason = oneLine(data?.simnet?.reason || '', 120);
    reportedUsage = data?.usage || null;`
);

replaceOnce(
  'request response metadata',
  `      rateLimit,
      finishReason: oneLine(choice?.finish_reason || '', 80)
    };`,
  `      rateLimit,
      finishReason: oneLine(choice?.finish_reason || '', 80),
      promptGuardSkipped,
      promptGuardSkipReason
    };`
);

replaceCount('provider neutral http error', 'Groq HTTP', 'AI provider HTTP', 1);
replaceCount('provider neutral empty response', 'Semantic probe: Groq returned an empty response', 'Semantic probe: AI provider returned an empty response', 1);
replaceCount('provider neutral timeout', 'Semantic probe: Groq request timeout', 'Semantic probe: AI provider request timeout', 1);
replaceCount('provider neutral missing key', 'Groq API key is not configured', 'AI provider API key is not configured', 3);

replaceOnce(
  'Prompt Guard propagation',
  `async function runPromptGuard(latestCustomer = {}, runtime = {}, meterContext = {}) {
  const text = block(latestCustomer?.text || '', 1600);
  if (!text) return { model: PROMPT_GUARD_MODEL, skipped: true, output: '', usage: {}, rateLimit: {} };
  try {
    const response = await requestModel(
      [{ role: 'user', content: text }],
      runtime.groqApiKey,
      PROMPT_GUARD_MODEL,
      { ...meterContext, stage: 'prompt_guard' },
      { jsonMode: false, maxTokens: 64, temperature: 0 }
    );
    return { model: response.model || PROMPT_GUARD_MODEL, skipped: false, output: oneLine(response.answer, 500), usage: response.usage || {}, rateLimit: response.rateLimit || {} };
  } catch (error) {
    return { model: PROMPT_GUARD_MODEL, skipped: false, output: '', error: oneLine(error?.message || error, 500), usage: {}, rateLimit: error?.rateLimit || {} };
  }
}`,
  `async function runPromptGuard(latestCustomer = {}, runtime = {}, meterContext = {}) {
  const text = block(latestCustomer?.text || '', 1600);
  if (!text) return { model: PROMPT_GUARD_MODEL, skipped: true, skipReason: 'empty_input', output: '', usage: {}, rateLimit: {} };
  try {
    const response = await requestModel(
      [{ role: 'user', content: text }],
      runtime.groqApiKey,
      PROMPT_GUARD_MODEL,
      { ...meterContext, stage: 'prompt_guard' },
      { jsonMode: false, maxTokens: 64, temperature: 0 }
    );
    if (response.promptGuardSkipped) {
      return {
        model: PROMPT_GUARD_MODEL,
        skipped: true,
        skipReason: response.promptGuardSkipReason || 'provider_capability_unavailable',
        output: '',
        usage: response.usage || {},
        rateLimit: response.rateLimit || {}
      };
    }
    return { model: response.model || PROMPT_GUARD_MODEL, skipped: false, skipReason: '', output: oneLine(response.answer, 500), usage: response.usage || {}, rateLimit: response.rateLimit || {} };
  } catch (error) {
    return { model: PROMPT_GUARD_MODEL, skipped: false, skipReason: '', output: '', error: oneLine(error?.message || error, 500), usage: {}, rateLimit: error?.rateLimit || {} };
  }
}`
);

replaceOnce(
  'Prompt Guard diagnostic reason',
  `        promptGuard: { model: guard.model, output: guard.output, error: guard.error || '', skipped: Boolean(guard.skipped) },`,
  `        promptGuard: { model: guard.model, output: guard.output, error: guard.error || '', skipped: Boolean(guard.skipped), skipReason: guard.skipReason || '' },`
);

replaceOnce(
  'Prompt Guard model chain',
  `      model: [guard.model, semanticResponse.model, knowledgeResponse?.model].filter(Boolean).join(' → '),`,
  `      model: [guard.skipped ? '' : guard.model, semanticResponse.model, knowledgeResponse?.model].filter(Boolean).join(' → '),`
);

replaceOnce(
  'native behavior profile',
  `function clampBehavior(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.min(100, Math.round(parsed))) : fallback;
}

function behaviorProfile(value = {}) {
  return {
    confidenceStyle: clampBehavior(value.confidenceStyle, 45),
    curiosity: clampBehavior(value.curiosity, 55),
    initiative: clampBehavior(value.initiative, 50),
    skepticism: clampBehavior(value.skepticism, 75),
    brevity: clampBehavior(value.brevity, 65),
    maxFollowUpQuestions: Math.max(1, Math.min(3, Math.round(Number(value.maxFollowUpQuestions || 2))))
  };
}`,
  `function behaviorProfile(value = {}) {
  return behaviorRuntimeHints(value);
}`
);

replaceOnce(
  'native behavior effects',
  `function normalizeBehaviorEffects(value = {}) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  return {
    directness: oneLine(source.directness || '', 260),
    clarification: oneLine(source.clarification || '', 260),
    verification: oneLine(source.verification || '', 260),
    initiative: oneLine(source.initiative || '', 260),
    brevity: oneLine(source.brevity || '', 260)
  };
}`,
  `function normalizeBehaviorEffects(value = {}) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  return {
    naturalness: oneLine(source.naturalness || source.human_likeness || source.directness || '', 260),
    depth: oneLine(source.depth || source.brevity || source.clarification || '', 260),
    initiative: oneLine(source.initiative || '', 260)
  };
}`
);

replaceOnce(
  'native answer behavior prompt',
  `Поведенческий профиль влияет на манеру, но не отменяет central instruction и правила правдивости:
- Решительность \${profile.confidenceStyle};
- Любопытство \${profile.curiosity};
- Инициативность \${profile.initiative};
- Скепсис \${profile.skepticism};
- Краткость \${profile.brevity};
- не более \${profile.maxFollowUpQuestions} уточняющих вопросов за ход.`,
  `\${behaviorPromptGuidance(profile)}`
);

replaceOnce(
  'native behavior effects schema',
  `  "behavior_effects":{
    "directness":"как профиль повлиял на прямоту",
    "clarification":"почему задано/не задано уточнение",
    "verification":"как применён скепсис",
    "initiative":"почему предложен/не предложен следующий шаг",
    "brevity":"как выбран объём"
  }`,
  `  "behavior_effects":{
    "naturalness":"как человекоподобность повлияла на манеру ответа",
    "depth":"как полезная развернутость повлияла на объём и объяснение",
    "initiative":"почему предложен/не предложен следующий шаг"
  }`
);

replaceOnce(
  'native clean-model behavior prompt',
  `Не показывай внутренние рассуждения. Ответ обычно 1–3 коротких предложения. Краткость=\${profile.brevity}, инициативность=\${profile.initiative}, любопытство=\${profile.curiosity}.`,
  `Не показывай внутренние рассуждения. Выбирай объём и манеру по поведенческому профилю, не растягивая ответ нерелевантными деталями.\n\n\${behaviorPromptGuidance(profile)}`
);

await writeFile(target, source, 'utf8');
console.log('semantic-probe runtime v2 patch applied');
