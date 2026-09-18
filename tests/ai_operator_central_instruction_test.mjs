import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import {
  AUTONOMOUS_OPERATOR_INSTRUCTION,
  AUTONOMOUS_OPERATOR_INSTRUCTION_META,
  AUTONOMOUS_OPERATOR_INSTRUCTION_SHA256,
  autonomousOperatorSystemMessages
} from '../src/features/ai-operator/instructions/autonomous-operator-instruction.generated.js';

const mdUrl = new URL('../src/features/ai-operator/instructions/AUTONOMOUS_OPERATOR.md', import.meta.url);
const md = fs.readFileSync(mdUrl, 'utf8');
const expectedHash = crypto.createHash('sha256').update(md).digest('hex');

test('canonical autonomous instruction generated artifact exactly matches MD source', () => {
  assert.equal(AUTONOMOUS_OPERATOR_INSTRUCTION, md, 'generated instruction must not drift from canonical MD');
  assert.equal(AUTONOMOUS_OPERATOR_INSTRUCTION_SHA256, expectedHash, 'instruction hash must identify exact canonical content');
  assert.deepEqual(AUTONOMOUS_OPERATOR_INSTRUCTION_META, {
    name: 'AUTONOMOUS_OPERATOR',
    version: 3,
    hash: expectedHash
  });
});

test('canonical instruction protects common knowledge and reasoning without allowing invented live facts', () => {
  assert.match(md, /не заменяют её собственные общеизвестные знания, семантическое понимание и логическое рассуждение/i);
  assert.match(md, /технические, математические, логические, бытовые, языковые, физические, географические/i);
  assert.match(md, /ABSENCE FROM SIMNET KB != ABSENCE OF KNOWLEDGE/i);
  assert.match(md, /Отсутствие утверждения в SIMNET knowledge.*не означает, что модель этого не знает/is);
  assert.match(md, /Если вопрос можно нормально и достоверно закрыть общеизвестными знаниями модели, ответь из своих знаний/i);
  assert.match(md, /не запрещай общеизвестный ответ только потому, что SIMNET KB его не дублирует/i);
  assert.match(md, /RULES CONSTRAIN REASONING; RULES DO NOT REPLACE REASONING/i);
  assert.match(md, /TOOLS PROVIDE EVIDENCE, NOT CONCLUSIONS/i);
  assert.match(md, /LLM свободна использовать общеизвестные знания.*LLM не свободна в изобретении текущих или внутренних фактов SIMNET/is);
  assert.match(md, /Отсутствие ожидаемого поля.*не является отрицательным доказательством/is);
  assert.match(md, /UNKNOWN != NO/i);
  assert.match(md, /ok=false.*NOT_FOUND.*DATA_NOT_AVAILABLE.*не превращаются автоматически в `NO`/is);
  assert.match(md, /Предыдущий ответ AI не является новым источником истины/i);
});

test('common knowledge and SIMNET live facts have an explicit evidence boundary', () => {
  assert.match(md, /«что такое ONU\?».+«какие преимущества у оптоволокна\?».+модель может ответить сама/is);
  assert.match(md, /«SIMNET выдаёт ONU бесплатно\?».+«есть ли GPON по этому адресу\?».+требуется подтверждённое внутреннее\/live evidence/is);
  assert.match(md, /COMMON KNOWLEDGE.*общеизвестные знания модели/is);
  assert.match(md, /локальная стадия не может объявить отсутствие статьи\/READ-result запретом на общеизвестные знания модели/i);
});

test('reason-first is a global invariant rather than a finance-specific exception', () => {
  assert.match(md, /KNOWN FACTS → REASON FIRST/i);
  assert.match(md, /READ MORE ONLY WHEN NECESSARY/i);
  assert.match(md, /подтверждённых фактов и\/или общеизвестных знаний достаточно/i);
  assert.match(md, /Не запрашивай новые данные только потому, что теоретически может существовать неизвестное исключение/i);
  assert.match(md, /Гипотетическая скидка, особое условие, редкий сценарий, возможная неисправность.*не являются причиной блокировать прямой вывод/is);
  assert.match(md, /Новый READ или уточняющий вопрос нужен только тогда, когда отсутствует конкретный факт/i);
  assert.match(md, /Эти примеры иллюстрируют общий принцип и не являются отдельными сценариями/i);
});

test('central instruction stays a protected system message separate from local stage work', () => {
  const messages = autonomousOperatorSystemMessages('ЭТАП: пойми смысл и верни JSON.');
  assert.equal(messages.length, 2);
  assert.deepEqual(messages.map(item => item.role), ['system', 'system']);
  assert.equal(messages[0].content, md);
  assert.equal(messages[1].content, 'ЭТАП: пойми смысл и верни JSON.');
});

test('autonomous instruction explicitly excludes operator-facing companion persona', () => {
  assert.match(md, /не определяет роль AI Operator Companion/i);
  assert.match(md, /непосредственно с абонентом/i);
  const companion = fs.readFileSync(new URL('../src/features/operator-companion/background.js', import.meta.url), 'utf8');
  assert.doesNotMatch(companion, /AUTONOMOUS_OPERATOR\.md|autonomous-operator-instruction\.generated/i);
});
