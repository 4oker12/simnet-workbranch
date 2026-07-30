"use strict";

(() => {
  const rules = Object.freeze([
    Object.freeze({
      id: "identify-subscriber",
      order: 10,
      systems: ["userside"],
      pageTypes: ["userside-customer"],
      stage: "1 · Идентификация",
      title: "Сверь абонента",
      instruction: "Проверь договор, ФИО и адрес до технических действий.",
      why: "Так оператор не диагностирует другой договор при похожем имени, телефоне или нескольких подключениях.",
      checklist: [
        "Договор совпадает с обращением",
        "ФИО и адрес подтверждены",
        "Выбрана нужная услуга или точка подключения"
      ],
      anchor: { kind: "left-data", texts: ["Договор:", "ФИО:", "Адрес:"] }
    }),
    Object.freeze({
      id: "confirm-billing-provider",
      order: 20,
      systems: ["userside"],
      pageTypes: ["userside-customer"],
      stage: "1 · Идентификация",
      title: "Проверь базу Billing",
      instruction: "Убедись, что карточка относится к Simnet или Looknet. Режим «Авто» Workbench должен показать ту же базу.",
      why: "UserSide общий, но базы Billing независимы. Ошибка базы даёт неверный статус, тариф и технические данные.",
      checklist: [
        "Строка «Биллинг» прочитана",
        "Выбранная база Workbench совпадает"
      ],
      anchor: { kind: "left-data", texts: ["Биллинг:"] }
    }),
    Object.freeze({
      id: "check-active-tickets",
      order: 30,
      systems: ["userside"],
      pageTypes: ["userside-customer"],
      stage: "2 · Контекст обращения",
      title: "Проверь заявки и массовые события",
      instruction: "Посмотри историю и техническую поддержку: нет ли уже открытой заявки или массовой аварии.",
      why: "Повторная индивидуальная диагностика и дублирующая заявка замедляют обработку массовой проблемы.",
      checklist: [
        "Открытые заявки проверены",
        "Массовая авария исключена или подтверждена"
      ],
      anchor: { kind: "text", texts: ["ИСТОРИЯ", "ТЕХ.ПОДДЕРЖКА", "ТЕХ. ПОДДЕРЖКА"] }
    }),
    Object.freeze({
      id: "identify-connection",
      order: 40,
      systems: ["userside"],
      pageTypes: ["userside-customer"],
      stage: "3 · Схема подключения",
      title: "Определи тип и точку подключения",
      instruction: "Зафиксируй технологию: Ethernet/FTTH, EPON, GPON, GCOM/Huawei; затем OLT или коммутатор, порт и место.",
      why: "Порядок проверки Ethernet и PON различается. Без точки коммутации нельзя корректно оценить линк, MAC и сигналы.",
      checklist: [
        "Технология подключения определена",
        "Оборудование и порт найдены",
        "Точка коммутации соответствует карточке"
      ],
      anchor: { kind: "text", texts: ["IP/MAC-адреса", "Точка коммутации", "JUNIPER NEW"] }
    }),
    Object.freeze({
      id: "check-juniper-session",
      order: 50,
      systems: ["userside"],
      pageTypes: ["userside-customer"],
      stage: "4 · Сессия и трафик",
      title: "Проверь Juniper-сессию и трафик",
      instruction: "Сверь наличие сессии, IP, MAC, длительность и фактический трафик. При жалобе на скорость сначала уточни схему замера.",
      why: "Живая сессия без трафика, гостевая сессия и нормальный трафик требуют разных дальнейших действий.",
      checklist: [
        "Сессия и IP проверены",
        "MAC сессии сопоставлен",
        "Трафик просмотрен",
        "Для скорости уточнены кабель/Wi‑Fi, устройство и тариф"
      ],
      anchor: { kind: "text", texts: ["JUNIPER NEW", "Juniper", "Трафик"] }
    }),
    Object.freeze({
      id: "check-onu-state",
      order: 60,
      systems: ["userside"],
      pageTypes: ["userside-customer"],
      technologies: ["pon"],
      stage: "5 · PON",
      title: "Считай состояние ONU",
      instruction: "Различай online, wire-down, power-off, authenticated и llid-admin-down. Не своди все состояния к «ONU offline».",
      why: "Состояние определяет ветвь: питание, оптика, ожидание конфигурации или возможная блокировка.",
      checklist: [
        "Статус ONU записан дословно",
        "При power-off проверено питание",
        "При wire-down проверена оптическая линия",
        "При authenticated запланирован повторный опрос",
        "При llid-admin-down проверены сигнал и блокировка"
      ],
      anchor: { kind: "text", texts: ["Статус ONU", "ONU", "Запрос ONU", "Опрос ONU"] }
    }),
    Object.freeze({
      id: "check-optical-levels",
      order: 70,
      systems: ["userside"],
      pageTypes: ["userside-customer"],
      technologies: ["pon"],
      stage: "5 · PON",
      title: "Проверь оптические уровни",
      instruction: "Сравни входящий и обратный уровни, учитывая EPON/GPON и направление сигнала. Сигналы в Billing и UserSide должны согласовываться.",
      why: "Один уровень без направления и технологии легко интерпретировать неверно.",
      checklist: [
        "Технология EPON/GPON подтверждена",
        "ONU Rx/Tx и OLT Rx не перепутаны",
        "Разница уровней оценена",
        "Значения сопоставлены с другим источником"
      ],
      anchor: { kind: "text", texts: ["Сигнал", "Rx", "Tx", "dBm"] }
    }),
    Object.freeze({
      id: "check-router-link-mac",
      order: 80,
      systems: ["userside"],
      pageTypes: ["userside-customer"],
      technologies: ["pon"],
      stage: "6 · Последняя миля",
      title: "Проверь линк ONU–роутер и MAC",
      instruction: "Убедись, что Ethernet-link поднят, скорость/duplex разумны, а видимый MAC один и совпадает с ожидаемым.",
      why: "Online ONU не доказывает исправность кабеля до роутера или корректную регистрацию абонентского устройства.",
      checklist: [
        "Ethernet-link проверен",
        "Скорость порта и duplex проверены",
        "Видимый MAC найден",
        "Лишние или несовпадающие MAC исключены"
      ],
      anchor: { kind: "text", texts: ["Ethernet-link", "MAC", "Скорость порта"] }
    }),
    Object.freeze({
      id: "check-ethernet-port",
      order: 65,
      systems: ["userside"],
      pageTypes: ["userside-customer"],
      technologies: ["ethernet"],
      stage: "5 · Ethernet",
      title: "Проверь порт коммутатора",
      instruction: "Проверь физический link, согласованную скорость, duplex, MAC/FDB и ошибки порта. Кабельный тест выполняй при link down или подозрении на линию.",
      why: "Красный link указывает на физическую ветвь; зелёный link не исключает ошибки, неверную скорость или лишние MAC.",
      checklist: [
        "Link и скорость порта проверены",
        "Duplex и ошибки порта проверены",
        "MAC/FDB соответствует абоненту",
        "При необходимости выполнен кабельный тест",
        "Трафик проверен после физического уровня"
      ],
      anchor: { kind: "text", texts: ["Коммутатор", "Скорость порта", "Cable test", "Кабельный тест", "MAC"] }
    }),
    Object.freeze({
      id: "check-history-and-conclude",
      order: 90,
      systems: ["userside"],
      pageTypes: ["userside-customer"],
      stage: "7 · Итог",
      title: "Проверь историю и сформулируй итог",
      instruction: "Сопоставь последнее событие с жалобой, повторяемость отключений и уже выполненные рекомендации. Для заявки перечисли факты и непроверенное.",
      why: "Хорошее описание заявки сокращает повторные звонки и помогает следующему специалисту продолжить с подтверждённого места.",
      checklist: [
        "Последнее событие и повторяемость проверены",
        "Рекомендации абоненту записаны",
        "Основание для повторной проверки или заявки понятно",
        "В описание входят факты, ответы и оставшиеся неизвестные"
      ],
      anchor: { kind: "text", texts: ["ИСТОРИЯ", "Создать задание", "Регистрация звонка"] }
    }),
    Object.freeze({
      id: "billing-pon-port-poll",
      order: 5,
      systems: ["billing"],
      pageTypes: ["billing"],
      technologies: ["pon"],
      stage: "1 · PON · Обязательно",
      title: "Сначала сверь опрос порта",
      instruction: "Для PON не продолжай вывод только по карточке: открой актуальный опрос OLT/порта и сверь ONU, порт, место, статус, MAC и сигналы.",
      why: "Карточка хранит назначенные данные, а опрос порта показывает фактическое состояние на оборудовании. Несовпадение — отдельный диагностический факт.",
      checklist: [
        "Опрос выполнен на правильном OLT и PON-порту",
        "ONU/серийный номер и место совпадают",
        "Фактический статус считан",
        "MAC и сигналы сопоставлены с карточкой",
        "При массовом обращении просмотрены соседние ONU порта"
      ],
      anchor: { kind: "text", texts: ["Опрос порта", "Абоненты порта", "PON", "ONU", "OLT", "Askport"] },
      caution: true
    }),
    Object.freeze({
      id: "billing-juniper-check",
      order: 10,
      systems: ["billing"],
      pageTypes: ["billing"],
      stage: "2 · Juniper",
      title: "Обязательно загляни в Juniper",
      instruction: "Открой общую карточку UserSide → JUNIPER NEW и сверь сессию, IP, MAC, длительность и трафик с данными Billing.",
      why: "Billing показывает назначенную конфигурацию, а Juniper — фактическую сетевую сессию абонента.",
      checklist: [
        "Juniper-сессия найдена или подтверждено её отсутствие",
        "IP и MAC совпадают с ожидаемыми",
        "Длительность и последнее событие учтены",
        "Фактический трафик просмотрен"
      ],
      anchor: { kind: "text", texts: ["Juniper", "JUNIPER NEW", "Session", "UserSide"] },
      caution: true
    }),
    Object.freeze({
      id: "billing-account-state",
      order: 20,
      systems: ["billing"],
      pageTypes: ["billing"],
      stage: "1 · Карточка Billing",
      title: "Сверь состояние услуги",
      instruction: "Проверь статус доступа, баланс, тариф и идентификатор абонента до технических изменений.",
      why: "Финансовая блокировка, неверный тариф и техническая неисправность требуют разных действий.",
      checklist: [
        "Статус доступа проверен",
        "Баланс проверен",
        "Тариф и скорость подтверждены",
        "Карточка совпадает с UserSide"
      ],
      anchor: { kind: "text", texts: ["Статус", "Баланс", "Тариф", "Info"] }
    }),
    Object.freeze({
      id: "billing-technical-data",
      order: 40,
      systems: ["billing"],
      pageTypes: ["billing"],
      stage: "2 · Технические данные",
      title: "Сверь технические данные",
      instruction: "Проверь группу/VLAN, OLT или коммутатор, порт, логин и сохранённый MAC.",
      why: "Эти значения должны согласовываться с UserSide и Juniper; расхождение само по себе является диагностическим фактом.",
      checklist: [
        "Группа/VLAN совпадает",
        "Оборудование и порт совпадают",
        "Логин и договор сопоставлены",
        "Сохранённый MAC проверен"
      ],
      anchor: { kind: "text", texts: ["Технические данные", "Техданные", "MAC", "VLAN", "OLT"] }
    }),
    Object.freeze({
      id: "billing-mac-registration",
      order: 60,
      systems: ["billing"],
      pageTypes: ["billing"],
      stage: "3 · MAC",
      title: "Не меняй MAC без надёжного источника",
      instruction: "Предпочтительный источник — гостевая страница. После сохранения конфигурация может применяться до 5 минут, обычно около минуты.",
      why: "MAC с наклейки или продиктованный с ошибкой может закрепить неверное устройство и усложнить диагностику.",
      checklist: [
        "Причина смены MAC подтверждена",
        "Источник MAC надёжный",
        "Старое и новое значение сверены",
        "После изменения выдержано время применения"
      ],
      anchor: { kind: "text", texts: ["MAC-адрес", "Mac адрес", "Технические данные"] }
    }),
    Object.freeze({
      id: "billing-sync-coa-safety",
      order: 80,
      systems: ["billing"],
      pageTypes: ["billing"],
      stage: "4 · Управляющие действия",
      title: "SYNC и CoA — только по показаниям",
      instruction: "SYNC применяй при рассинхронизации доступа/тарифа. CoA Session или MAC — только после проверки сессии, IP и регистрации MAC.",
      why: "Сброс без диагностического основания прерывает связь и скрывает исходное состояние, но не устраняет физическую проблему.",
      checklist: [
        "Основание для команды сформулировано",
        "Исходные данные сессии записаны",
        "Абонент предупреждён о кратком разрыве",
        "Запланирована повторная проверка"
      ],
      anchor: { kind: "text", texts: ["SYNC", "CoA disconnect", "Session", "Juniper"] },
      caution: true
    })
  ]);

  function normalizeTechnology(value) {
    const text = String(value || "").toLowerCase();
    if (/\b(?:gpon|epon|gcom|xpon|onu|olt)\b/i.test(text)) return "pon";
    if (/\b(?:ethernet|ftth|коммутатор|switch|витая пара)\b/i.test(text)) return "ethernet";
    return "unknown";
  }

  function classifyContext(input = {}) {
    const hostname = String(input.hostname || "").toLowerCase();
    const pathname = String(input.pathname || "");
    const pageText = String(input.pageText || "");
    const system = hostname === "userside.simnet.kiev.ua"
      ? "userside"
      : /^admin\.(?:simnet|looknet)\.kiev\.ua$/i.test(hostname)
        ? "billing"
        : "other";
    const pageType = system === "userside" && /\/customer\/\d+/i.test(pathname)
      ? "userside-customer"
      : system === "billing"
        ? "billing"
        : "unsupported";
    return Object.freeze({
      system,
      pageType,
      technology: normalizeTechnology(pageText),
      provider: String(input.provider || ""),
      hostname,
      pathname
    });
  }

  function rulesForContext(context = {}) {
    return rules
      .filter((rule) => rule.systems.includes(context.system))
      .filter((rule) => rule.pageTypes.includes(context.pageType))
      .filter((rule) => !rule.technologies || rule.technologies.includes(context.technology))
      .sort((left, right) => left.order - right.order);
  }

  function progressFor(ruleList, completedIds) {
    const completed = completedIds && typeof completedIds.has === "function"
      ? completedIds
      : new Set(Array.isArray(completedIds) ? completedIds : []);
    const done = ruleList.filter((rule) => completed.has(rule.id)).length;
    return Object.freeze({
      done,
      total: ruleList.length,
      percent: ruleList.length ? Math.round((done / ruleList.length) * 100) : 0,
      next: ruleList.find((rule) => !completed.has(rule.id)) || null
    });
  }

  globalThis.__SIMNET_TRAINING_KNOWLEDGE__ = Object.freeze({
    rules,
    classifyContext,
    normalizeTechnology,
    progressFor,
    rulesForContext
  });
})();
