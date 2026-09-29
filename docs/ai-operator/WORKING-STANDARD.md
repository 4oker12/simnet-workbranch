# AI Operator — утверждённый рабочий стандарт

**База:** `main`  
**Статус:** single source of truth (параллельные zip/ветки v4-pack не применять)

## Два слоя одной политики

| Слой | Файл | Назначение |
|------|------|------------|
| **Full v4** | `src/features/ai-operator/instructions/AUTONOMOUS_OPERATOR.md` (+ `.generated.js`) | Канон: ревью, тесты, `autonomousOperatorSystemMessages` |
| **Compact v4** | `src/features/ai-operator/instructions/autonomous-operator-compact.js` | Runtime на fetch: `groq-token-governor.js` подменяет full system на compact |

Поток:

```
stage prompts → FULL v4 в messages
                    ↓
         groq-token-governor (fetch)
                    ↓
         COMPACT v4 в API + max_tokens cap + 429 cooldown
```

**COMPACT не режется и не дублируется** вторым profile в probe.  
Меняешь смысл → сначала MD full, затем те же якоря в compact module.

## Модели (Groq free)

`qwen/qwen3.8-27b` → `openai/gpt-oss-120b` → `openai/gpt-oss-20b`  
(+ DeepSeek при выбранном provider)

## Инварианты

- СМЫСЛ → ЛОГИКА → EVIDENCE → ОТВЕТ
- Не начинать с tool/статьи
- UNKNOWN ≠ NO; tools = evidence
- building.snapshot из локального `simnet_crm_building_snapshot_v1`
- main = единственная рабочая линия

## Тесты

- `tests/ai_autonomous_operator_instruction_v4_test.mjs`
- `tests/ai_operator_compact_runtime_standard_test.mjs`
