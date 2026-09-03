import assert from 'node:assert/strict';
import fs from 'node:fs';

const background = fs.readFileSync(new URL('../src/background.js', import.meta.url), 'utf8');

assert.match(background, /ТВОЙ СОБЕСЕДНИК — ОПЕРАТОР, не абонент/i, 'AI must address the operator, not the subscriber');
assert.match(background, /главный разделитель.*2–4 КОРОТКИХ связанных/i, 'internal reasoning may consider a compact related batch');
assert.match(background, /Не жди, пока оператор каждый раз спросит «а ещё\?»/i, 'AI must show initiative without waiting for repeated prompts');
assert.match(background, /2–5 коротких связанных вопросов\/проверок/i, 'AI may proactively ask a small related batch when the operator is stuck');
assert.match(background, /ОБЩЕЕ: скорость\/Wi‑Fi, нет интернета, обрывы, DNS\/сайты, VPN\/удалёнка, BRAS\/DHCP, PON\/ONU/i, 'initiative must apply across complaint domains, not only speed');
assert.match(background, /PHY\/RSSI\/channel\/width.*IP\/gateway\/DHCP\/Wi‑Fi association\/BRAS.*DNS\/VPN\/другая сеть/i, 'prompt must expose domain-specific technical initiative examples');
assert.match(background, /Вопрос, пример, предположение, сарказм.*НЕ факт/i, 'hypotheticals and sarcasm must not become facts');
assert.match(background, /subscriber_report/i, 'subscriber report provenance must be explicit');
assert.match(background, /Признак ≠ ПРИЧИНА|ПРИЗНАК ≠ ПРИЧИНА/i, 'clues must not be promoted to proven causes');
assert.match(background, /Старый ONU online не перебивает свежую жалобу/i, 'freshness must be explicit');
assert.match(background, /Если лучший тест unavailable, НЕ считай диагностику законченной автоматически/i, 'unavailable preferred test must trigger alternate remote diagnostics before escalation');
assert.match(background, /мастер с тестовым ноутбук/i, 'field test escalation must exist after remote exhaustion');
assert.match(background, /Не отправляй на выезд раньше времени/i, 'field visit must not be premature');
assert.match(background, /Тариф называй только из snapshot\.tariff\.speedMbps/i, 'tariff must remain authoritative from snapshot');
assert.match(background, /Не советуй закрывать обращение только потому/i, 'normal partial evidence must not auto-close the case');
assert.match(background, /СПАРСНЫЙ набор фактов/i, 'dialog memory must stay sparse rather than prefilled with unknowns');
assert.match(background, /affected_devices, problem_pattern, problem_time_pattern, wired_test, other_device_test, cpe_reboot/i, 'general memory keys must exist');
assert.match(background, /dns_resolution\/dns_change\/ping_ip\/ping_hostname\/gateway_reachability\/client_ip_state/i, 'DNS/no-internet memory keys must exist');
assert.match(background, /drop_layer\/drop_recovery\/drop_duration\/drop_frequency/i, 'drops memory keys must exist');
assert.match(background, /Не используй placeholder-ключи fact_key\/key\/value\/example/i, 'memory placeholder regression must be covered');
assert.match(background, /Обычно 1–3 действия.*2–5 связанных шагов/i, 'responses must stay concise but allow an initiative burst on open requests');
assert.match(background, /model\/firmware\/regulatory-specific/i, 'model-specific technical claims must be calibrated');
assert.match(background, /ОБЯЗАТЕЛЬНО разбивай его визуально.*Не выдавай сплошную «стену текста»/is, 'long answers must be visually structured instead of dense walls');
assert.match(background, /2–5 компактных пунктов.*пустой строкой между ними/is, 'long answers should use compact scan-friendly blocks');
assert.match(background, /Что ещё глянуть.*Что сказать абоненту/is, 'natural mini-headings may structure substantive answers');

console.log('ai_operator_prompt_contract_test: PASS');
