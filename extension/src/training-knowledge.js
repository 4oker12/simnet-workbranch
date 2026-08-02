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
      id: "billing-account-identity",
      order: 10,
      systems: ["billing"],
      pageTypes: ["billing"],
      billingSections: ["account"],
      stage: "1 · Карточка клиента",
      title: "Убедись, что открыта нужная карточка",
      instruction: "Сверь ID, логин, IP, договор и ФИО с обращением до просмотра финансов или изменения услуги.",
      why: "На похожих логинах и адресах легко перейти к соседнему договору и сделать правильное действие не тому абоненту.",
      checklist: [
        "ID и логин относятся к обращению",
        "IP и договор сопоставлены",
        "ФИО и карточка UserSide совпадают"
      ],
      anchor: { kind: "text", texts: ["Логин", "Контракт", "ФИО", "Ip"] }
    }),
    Object.freeze({
      id: "billing-account-finance",
      order: 20,
      systems: ["billing"],
      pageTypes: ["billing"],
      billingSections: ["account"],
      stage: "2 · Финансы",
      title: "Разбери состояние счёта",
      instruction: "Сопоставь остаток на счёте, итоговую абонплату, статус доступа и активные финансовые ограничения.",
      why: "Недостаток средств, кредит, пауза и техническая неисправность выглядят для абонента похоже, но требуют разных действий.",
      checklist: [
        "Остаток на счёте прочитан",
        "Итоговая ежемесячная стоимость проверена",
        "Статус доступа и финансовые ограничения учтены",
        "При необходимости открыты «Платежи и события»"
      ],
      anchor: { kind: "text", texts: ["На счете с учетом стоимости тарифного плана, грн.", "Разом до сплати, грн.", "Платежи и события", "Пополнить счет"] }
    }),
    Object.freeze({
      id: "billing-account-services",
      order: 30,
      systems: ["billing"],
      pageTypes: ["billing"],
      billingSections: ["account"],
      stage: "3 · Тарифы и услуги",
      title: "Проверь основные и дополнительные услуги",
      instruction: "Прочитай текущий и следующий интернет-пакет, тариф ТВ, даты применения и отмеченные дополнительные услуги.",
      why: "Стоимость и доступная скорость складываются из нескольких услуг; запланированный пакет может отличаться от действующего сейчас.",
      checklist: [
        "Текущий интернет-пакет и скорость подтверждены",
        "Следующий пакет и дата изменения проверены",
        "Тариф ТВ учтён",
        "Платные дополнительные услуги просмотрены"
      ],
      anchor: { kind: "text", texts: ["Тарифи на Інтернет", "Тариф ТБ", "След. пакет", "Услуга"] }
    }),
    Object.freeze({
      id: "billing-account-navigation",
      order: 40,
      systems: ["billing"],
      pageTypes: ["billing"],
      billingSections: ["account"],
      stage: "4 · Технические разделы",
      title: "Выбери раздел под задачу",
      instruction: "Для фактической сессии открывай Juniper, для PON — вкладку нужного OLT, для назначенных данных — «Технические данные», для общей карточки — UserSide.",
      why: "Главная карточка хранит сводные и назначенные данные. Фактическое состояние сети читается в специализированном разделе.",
      checklist: [
        "Juniper выбран для проверки сессии и трафика",
        "EPON/GPON/GCOM/Huawei выбран по технологии абонента",
        "Назначенные данные не перепутаны с фактическим опросом",
        "Переход в UserSide используется для контрольной сверки"
      ],
      anchor: { kind: "text", texts: ["Juniper (NEW)", "BDCOM EPON (1G)", "Технические данные", "USERSIDE"] }
    }),
    Object.freeze({
      id: "billing-account-history",
      order: 50,
      systems: ["billing"],
      pageTypes: ["billing"],
      billingSections: ["account"],
      stage: "5 · История",
      title: "Проверь события перед выводом",
      instruction: "Открой последние платежи, сообщения и комментарии, если причина состояния счёта или услуги не очевидна из карточки.",
      why: "История показывает недавнее пополнение, смену тарифа, паузу или уже выполненное действие и не даёт повторить его вслепую.",
      checklist: [
        "Последние платежи просмотрены при финансовом вопросе",
        "Недавние изменения услуги учтены",
        "Сообщения и комментарии не противоречат текущему состоянию"
      ],
      anchor: { kind: "text", texts: ["Последние 6 платежей", "Платежи и события", "Отправить сообщение"] }
    }),
    Object.freeze({
      id: "billing-account-change-safety",
      order: 60,
      systems: ["billing"],
      pageTypes: ["billing"],
      billingSections: ["account"],
      stage: "6 · Изменения",
      title: "Меняй только подтверждённое поле",
      instruction: "Перед сохранением сформулируй основание, проверь будущую дату применения и убедись, что соседние тарифы и услуги не изменились случайно.",
      why: "В карточке одновременно доступно много редактируемых полей; случайное изменение может проявиться не сразу, а со следующего месяца.",
      checklist: [
        "Основание изменения подтверждено",
        "Дата применения понятна",
        "Соседние тарифы и услуги остались без изменений",
        "Результат будет повторно проверен"
      ],
      anchor: { kind: "text", texts: ["Предложить изменения", "Изменить", "След. пакет"] },
      caution: true
    }),
    Object.freeze({
      id: "billing-juniper-session",
      order: 10,
      systems: ["billing"],
      pageTypes: ["billing"],
      billingSections: ["juniper"],
      stage: "1 · Сессия Juniper",
      title: "Сначала прочитай состояние сессии",
      instruction: "Определи BRAS, источник RADIUS, номер сессии, статус online/active и имя авторизации.",
      why: "Это отвечает на главный вопрос: есть ли сейчас фактическая сессия и на каком сетевом узле она обслуживается.",
      checklist: [
        "BRAS определён",
        "Источник RADIUS и ID сессии прочитаны",
        "Статус online/active подтверждён",
        "USERNAME совпадает с карточкой"
      ],
      anchor: { kind: "text", texts: ["BRAS", "RADIUS", "Статус сесії", "Статус сессии", "USERNAME"] }
    }),
    Object.freeze({
      id: "billing-juniper-addressing",
      order: 20,
      systems: ["billing"],
      pageTypes: ["billing"],
      billingSections: ["juniper"],
      stage: "2 · Адресация",
      title: "Сверь IP, MAC, роутер и VLAN",
      instruction: "Сопоставь IP и MAC активной сессии с карточкой, затем проверь ROUTER, VENDOR и VLAN.",
      why: "Несовпадение адресации или VLAN объясняет доступ не того устройства, гостевую сессию и часть проблем после замены роутера.",
      checklist: [
        "IP совпадает с ожидаемым",
        "MAC сессии сопоставлен",
        "ROUTER и VLAN прочитаны",
        "VENDOR учтён как подсказка, а не как единственное доказательство"
      ],
      anchor: { kind: "text", texts: ["IP", "MAC", "ROUTER", "VLAN", "VENDOR"] }
    }),
    Object.freeze({
      id: "billing-juniper-traffic",
      order: 30,
      systems: ["billing"],
      pageTypes: ["billing"],
      billingSections: ["juniper"],
      stage: "3 · Время и трафик",
      title: "Интерпретируй длительность и трафик",
      instruction: "Сравни время авторизации, последнее событие, принятые/переданные байты и текущие скорости в обоих направлениях.",
      why: "Живая сессия без обмена, недавно поднятая сессия и длительная активная сессия ведут к разным следующим проверкам.",
      checklist: [
        "Время авторизации и длительность учтены",
        "Последнее событие прочитано",
        "Накопленный трафик есть или его отсутствие объяснено",
        "Текущая скорость оценена в обоих направлениях"
      ],
      anchor: { kind: "text", texts: ["Час авторизації", "Время авторизации", "Байти прийнято/передано", "Последня подія", "Последнее событие"] }
    }),
    Object.freeze({
      id: "billing-juniper-actions",
      order: 40,
      systems: ["billing"],
      pageTypes: ["billing"],
      billingSections: ["juniper"],
      stage: "4 · Команды",
      title: "Различай запрос, SYNC и Disconnect",
      instruction: "«Запрос Juniper» только обновляет данные. SYNC применяй при подтверждённой рассинхронизации. Disconnect разрывает сессию и может оставить абонента offline до 30 минут или перезагрузки роутера.",
      why: "Управляющая команда до фиксации исходного состояния скрывает причину и создаёт новый перерыв связи.",
      checklist: [
        "Исходные данные сессии записаны",
        "Для SYNC сформулирована рассинхронизация",
        "Для Disconnect есть диагностическое основание",
        "Абонент предупреждён о возможном разрыве"
      ],
      anchor: { kind: "text", texts: ["Запит Juniper", "Запрос Juniper", "Синхронізація (SYNC)", "Синхронизация (SYNC)", "Disconnect"] },
      caution: true
    }),
    Object.freeze({
      id: "billing-juniper-cross-check",
      order: 50,
      systems: ["billing"],
      pageTypes: ["billing"],
      billingSections: ["juniper"],
      stage: "5 · Контрольная сверка",
      title: "Сопоставь с карточкой и UserSide",
      instruction: "Вернись к карточке клиента и сравни назначенный IP/логин с фактической Juniper-сессией; при технической диагностике сверь тот же контекст в UserSide.",
      why: "Juniper показывает фактическую сессию, но не заменяет договорные, финансовые и топологические данные других систем.",
      checklist: [
        "Логин и IP совпадают с карточкой Billing",
        "MAC сопоставлен с техническими данными",
        "При расхождении зафиксированы оба значения",
        "Следующий шаг выбран по факту, а не по предположению"
      ],
      anchor: { kind: "text", texts: ["Головна", "Главная", "Данные клиента", "Клієнт", "Клиент"] }
    }),
    Object.freeze({
      id: "billing-onu-target",
      order: 10,
      systems: ["billing"],
      pageTypes: ["billing"],
      billingSections: ["onu"],
      stage: "1 · Цель опроса",
      title: "Проверь технологию, OLT и PON-порт",
      instruction: "Убедись, что открыта вкладка нужной технологии и опрос относится к OLT, порту и ONU выбранного абонента.",
      why: "Опрос соседнего порта может выглядеть правдоподобно, но описывает другое оборудование и других абонентов.",
      checklist: [
        "Технология EPON/GPON/GCOM/Huawei выбрана верно",
        "OLT и PON-порт совпадают с карточкой",
        "ONU или серийный номер относятся к абоненту"
      ],
      anchor: { kind: "text", texts: ["OLT", "PON", "ONU", "Абоненты порта", "Опрос порта"] },
      caution: true
    }),
    Object.freeze({
      id: "billing-onu-status",
      order: 20,
      systems: ["billing"],
      pageTypes: ["billing"],
      billingSections: ["onu"],
      stage: "2 · Статус ONU",
      title: "Считай фактическое состояние ONU",
      instruction: "Запиши статус дословно и различай online, power-off, wire-down, authenticated и административное отключение.",
      why: "Каждый статус направляет диагностику в отдельную ветвь: питание, оптика, ожидание конфигурации или блокировка.",
      checklist: [
        "Статус записан без упрощения до «offline»",
        "Время последнего события учтено",
        "Следующая проверка соответствует конкретному статусу"
      ],
      anchor: { kind: "text", texts: ["Статус ONU", "Статус", "online", "power-off", "wire-down", "authenticated"] }
    }),
    Object.freeze({
      id: "billing-onu-signals",
      order: 30,
      systems: ["billing"],
      pageTypes: ["billing"],
      billingSections: ["onu"],
      stage: "3 · Оптика",
      title: "Разбери сигналы по направлениям",
      instruction: "Отдельно прочитай ONU Rx/Tx и OLT Rx, не смешивая входящий и обратный сигнал; сравни значения с UserSide.",
      why: "Одно число dBm без направления и технологии легко трактовать наоборот и ошибочно назначить повреждение линии.",
      checklist: [
        "Направление каждого сигнала понятно",
        "Значения относятся к нужной ONU",
        "Сигналы сопоставлены с UserSide",
        "Отклонение оценено с учётом технологии"
      ],
      anchor: { kind: "text", texts: ["Rx", "Tx", "dBm", "Сигнал", "Оптический"] }
    }),
    Object.freeze({
      id: "billing-onu-link-mac",
      order: 40,
      systems: ["billing"],
      pageTypes: ["billing"],
      billingSections: ["onu"],
      stage: "4 · ONU–роутер",
      title: "Проверь Ethernet-link и MAC",
      instruction: "При online ONU отдельно проверь пользовательский Ethernet-порт, скорость/duplex и изученный MAC роутера.",
      why: "Online ONU подтверждает связь с OLT, но не исправность кабеля до роутера и не корректность регистрации конечного устройства.",
      checklist: [
        "Ethernet-link поднят или причина link down понятна",
        "Скорость и duplex разумны",
        "Изученный MAC найден",
        "MAC совпадает с ожидаемым"
      ],
      anchor: { kind: "text", texts: ["Ethernet", "Link", "MAC", "Duplex", "Скорость"] }
    }),
    Object.freeze({
      id: "billing-onu-neighbors",
      order: 50,
      systems: ["billing"],
      pageTypes: ["billing"],
      billingSections: ["onu"],
      stage: "5 · Порт целиком",
      title: "Сравни соседние ONU",
      instruction: "При подозрении на общую проблему посмотри статусы и сигналы соседей того же PON-порта.",
      why: "Одновременное ухудшение нескольких ONU указывает на порт, ветку или питание оборудования, а не на домашний кабель одного абонента.",
      checklist: [
        "Соседи относятся к тому же порту",
        "Массовость по статусам или сигналам проверена",
        "Индивидуальная и общая проблема разделены"
      ],
      anchor: { kind: "text", texts: ["Абоненты порта", "Соседи", "ONU", "OLT по соседям"] }
    }),
    Object.freeze({
      id: "billing-onu-conclusion",
      order: 60,
      systems: ["billing"],
      pageTypes: ["billing"],
      billingSections: ["onu"],
      stage: "6 · Итог опроса",
      title: "Сформулируй подтверждённый вывод",
      instruction: "Сопоставь назначенные данные карточки с фактическим опросом и перечисли статус, сигналы, link, MAC и массовость.",
      why: "Так следующий оператор или монтажник получает проверенные факты и понимает, на каком участке продолжать работу.",
      checklist: [
        "Назначенные и фактические данные разделены",
        "Статус, сигналы, link и MAC перечислены",
        "Массовость подтверждена или исключена",
        "Непроверенное обозначено явно"
      ],
      anchor: { kind: "text", texts: ["ONU", "PON", "UserSide", "Головна", "Главная"] }
    }),
    Object.freeze({
      id: "billing-payments-balance",
      order: 10,
      systems: ["billing"],
      pageTypes: ["billing"],
      billingSections: ["payments"],
      stage: "1 · Финансовый контекст",
      title: "Сверь текущий баланс и период",
      instruction: "Проверь, к какому договору и периоду относится финансовая история, затем сопоставь её с текущим остатком карточки.",
      why: "Платёж мог относиться к другому периоду, услуге или ещё не изменить состояние доступа.",
      checklist: [
        "Договор и период подтверждены",
        "Текущий остаток сопоставлен",
        "Назначение платежа понятно"
      ],
      anchor: { kind: "text", texts: ["Платежи", "Баланс", "Сумма", "Период"] }
    }),
    Object.freeze({
      id: "billing-payments-events",
      order: 20,
      systems: ["billing"],
      pageTypes: ["billing"],
      billingSections: ["payments"],
      stage: "2 · События",
      title: "Прочитай цепочку событий",
      instruction: "Смотри события по времени: пополнение, списание, кредит, пауза, смена тарифа и восстановление доступа.",
      why: "Последовательность событий объясняет состояние услуги точнее, чем одна текущая цифра баланса.",
      checklist: [
        "События прочитаны в правильном порядке",
        "Причина изменения баланса найдена",
        "Связь финансового события со статусом доступа подтверждена"
      ],
      anchor: { kind: "text", texts: ["Платежи и события", "Событие", "Операция", "Дата"] }
    }),
    Object.freeze({
      id: "billing-technical-technology",
      order: 10,
      systems: ["billing"],
      pageTypes: ["billing"],
      billingSections: ["technical"],
      stage: "1 · Тип подключения",
      title: "Сначала определи технологию",
      instruction: "Прочитай поле «Технология подключения абонента»: Ethernet ведёт в UserSide, PON — к OLT и опросу ONU.",
      why: "От технологии зависит весь дальнейший маршрут. Для Ethernet не нужны PON-поля, а для PON необходимо определить OLT и ONU.",
      checklist: [
        "Выбранная технология прочитана",
        "Дальнейший маршрут понятен",
        "Противоречащие технологии поля замечены"
      ],
      anchor: { kind: "text", texts: ["Технология подключения абонента"] }
    }),
    Object.freeze({
      id: "billing-technical-identifiers",
      order: 20,
      systems: ["billing"],
      pageTypes: ["billing"],
      billingSections: ["technical"],
      stage: "2 · Идентификаторы",
      title: "Различай MAC абонента и ONU",
      instruction: "MAC абонента относится к роутеру или конечному устройству. EPON ONU MAC и GPON ONT Serial относятся к оптическому терминалу и не взаимозаменяются.",
      why: "Смешение MAC роутера и идентификатора ONU приводит к неверной сверке Juniper, UserSide и OLT.",
      checklist: [
        "MAC абонента прочитан",
        "Идентификатор ONU нужен только для PON",
        "Для EPON и GPON выбрано правильное поле"
      ],
      anchor: { kind: "text", texts: ["Мак-адрес абонента", "EPON ONU Мак-адрес", "GPON ONT Серийный ID"] }
    }),
    Object.freeze({
      id: "billing-technical-olt-binding",
      order: 30,
      systems: ["billing"],
      pageTypes: ["billing"],
      billingSections: ["technical"],
      stage: "3 · OLT",
      title: "Проверь привязку PON",
      instruction: "Для PON сопоставь выбранную OLT с типом идентификатора ONU. Для Ethernet пустая OLT является нормой.",
      why: "OLT определяет, в каком разделе выполнять опрос ONU. Неверная или пустая привязка ведёт к проверке не того оборудования.",
      checklist: [
        "OLT нужна только для PON",
        "Тип OLT согласуется с EPON MAC или GPON Serial",
        "Пустая OLT у PON замечена"
      ],
      anchor: { kind: "text", texts: ["OLT", "EPON ONU Мак-адрес", "GPON ONT Серийный ID"] }
    }),
    Object.freeze({
      id: "billing-technical-route",
      order: 40,
      systems: ["billing"],
      pageTypes: ["billing"],
      billingSections: ["technical"],
      stage: "4 · Следующий шаг",
      title: "Перейди в правильный источник фактов",
      instruction: "Ethernet проверяй в UserSide по коммутатору и порту. PON опрашивай в разделе назначенной OLT; если OLT не задана — сначала определи её по ТМЦ UserSide.",
      why: "Технические данные хранят назначенную привязку, а фактическое состояние линии подтверждается в UserSide или результатом опроса OLT.",
      checklist: [
        "Для Ethernet выбран UserSide",
        "Для PON выбран правильный раздел OLT",
        "При пустой OLT использована ТМЦ UserSide"
      ],
      anchor: { kind: "text", texts: ["Технология подключения абонента", "OLT"] }
    }),
    Object.freeze({
      id: "billing-technical-mac-safety",
      order: 50,
      systems: ["billing"],
      pageTypes: ["billing"],
      billingSections: ["technical"],
      stage: "5 · Безопасное изменение",
      title: "Не меняй MAC без надёжного источника",
      instruction: "Подтверди причину и источник нового MAC. После сохранения конфигурация может применяться до 5 минут, обычно около минуты.",
      why: "MAC с наклейки или продиктованный с ошибкой может закрепить неверное устройство и усложнить диагностику.",
      checklist: [
        "Причина смены MAC подтверждена",
        "Источник MAC надёжный",
        "Старое и новое значение сверены",
        "После изменения выдержано время применения"
      ],
      anchor: { kind: "text", texts: ["MAC-адрес", "Mac адрес", "Технические данные"] },
      caution: true
    }),
    Object.freeze({
      id: "billing-traffic-period",
      order: 10,
      systems: ["billing"],
      pageTypes: ["billing"],
      billingSections: ["traffic"],
      stage: "1 · Период трафика",
      title: "Сначала проверь период и единицы",
      instruction: "Уточни интервал отчёта, направление и единицы измерения до оценки объёма или скорости.",
      why: "Суточный объём, накопительный счётчик и мгновенная скорость отвечают на разные вопросы.",
      checklist: [
        "Период отчёта понятен",
        "Входящий и исходящий трафик не перепутаны",
        "Единицы измерения определены"
      ],
      anchor: { kind: "text", texts: ["Трафик", "Период", "входящий", "исходящий"] }
    }),
    Object.freeze({
      id: "billing-traffic-interpretation",
      order: 20,
      systems: ["billing"],
      pageTypes: ["billing"],
      billingSections: ["traffic"],
      stage: "2 · Интерпретация",
      title: "Сопоставь трафик с жалобой",
      instruction: "Сравни наличие обмена с активностью Juniper-сессии и временем обращения; не делай вывод о скорости только по общему объёму.",
      why: "Большой объём не доказывает нормальную текущую скорость, а нулевой интервал может быть следствием недавно поднятой сессии.",
      checklist: [
        "Трафик сопоставлен со временем обращения",
        "Сессия Juniper учтена",
        "Для жалобы на скорость уточнена схема замера"
      ],
      anchor: { kind: "text", texts: ["Трафик", "Juniper", "Сессия", "Скорость"] }
    })
  ]);

  function normalizeTechnology(value) {
    const text = String(value || "").toLowerCase();
    if (/\b(?:gpon|epon|gcom|xpon|onu|olt)\b/i.test(text)) return "pon";
    if (/\b(?:ethernet|ftth|коммутатор|switch|витая пара)\b/i.test(text)) return "ethernet";
    return "unknown";
  }

  function queryValue(search, expectedName) {
    const query = String(search || "").replace(/^\?/, "");
    for (const pair of query.split("&")) {
      if (!pair) continue;
      const separator = pair.indexOf("=");
      const rawName = separator >= 0 ? pair.slice(0, separator) : pair;
      const rawValue = separator >= 0 ? pair.slice(separator + 1) : "";
      let name = rawName;
      let value = rawValue;
      try {
        name = decodeURIComponent(rawName.replace(/\+/g, " "));
        value = decodeURIComponent(rawValue.replace(/\+/g, " "));
      } catch (_) {}
      if (name.toLowerCase() === String(expectedName || "").toLowerCase()) return value;
    }
    return "";
  }

  function classifyBillingSection(input = {}) {
    const pathname = String(input.pathname || "").toLowerCase();
    const pageText = String(input.pageText || "").toLowerCase();
    const action = queryValue(input.search, "a").toLowerCase();

    if (/\/stat\.pl$/i.test(pathname)) {
      if (["250", "252"].includes(action)) return "juniper";
      if (["310", "311", "312", "313"].includes(action)) return "onu";
      if (["108", "111"].includes(action)) return "traffic";
    }
    if (/\/adm\.pl$/i.test(pathname)) {
      if (action === "user") return "account";
      if (action === "dopdata") return "technical";
      if (["pays", "payshow"].includes(action)) return "payments";
      if (action === "chanal") return "traffic";
    }

    if (/(?:запит|запрос)\s+juniper|radius2|subscriber_session|disconnect/.test(pageText)) return "juniper";
    if (/опрос\s+порта|абоненты\s+порта|onu\s+(?:rx|tx)|olt\s+rx/.test(pageText)) return "onu";
    if (/тарифи на інтернет|тарифы на интернет|на счете с учетом стоимости/.test(pageText)) return "account";
    return "general";
  }

  function normalizedFieldEntries(fields = {}) {
    return Object.entries(fields || {}).map(([name, value]) => [
      String(name || "").replace(/\s+/g, " ").trim().toLowerCase(),
      String(value ?? "").replace(/\s+/g, " ").trim()
    ]);
  }

  function classifyBillingOlt(profile = {}) {
    const technology = String(profile.technology || "").trim();
    const olt = String(profile.olt || "").trim();
    const evidence = [
      olt,
      profile.eponMac ? "EPON" : "",
      profile.gponSerial ? "GPON" : ""
    ].join(" ").toLowerCase();
    const isPon = /\bpon\b/i.test(technology) || /\b(?:epon|gpon)\b/i.test(evidence);
    let oltKind = "";
    if (/huawei/.test(evidence)) oltKind = "huawei";
    else if (/gcom/.test(evidence)) oltKind = "gcom";
    else if (/bdcom/.test(evidence) && /gpon/.test(evidence)) oltKind = "bdcom-gpon";
    else if (/bdcom/.test(evidence) && /epon/.test(evidence)) oltKind = "bdcom-epon";
    const menuByKind = {
      "bdcom-epon": ["BDCOM EPON (1G)"],
      "bdcom-gpon": ["BDCOM GPON (2.5G)"],
      gcom: ["GCOM (2.5G)"],
      huawei: ["HUAWEI OLT"]
    };
    return Object.freeze({
      isPon,
      oltKind,
      menuTexts: Object.freeze(menuByKind[oltKind] || [])
    });
  }

  function evaluateBillingFields(context = {}, fields = {}) {
    if (context.system !== "billing" || context.billingSection !== "account") return [];
    const entries = normalizedFieldEntries(fields);
    const valueFor = (...names) => {
      const expected = names.map((name) => String(name || "").toLowerCase());
      return entries.find(([name]) => expected.includes(name))?.[1] || "";
    };
    const results = [];
    const group = valueFor("группа", "група");
    if (group) {
      const removed = /удален|видален|архив|inactive|deleted/i.test(group);
      results.push(Object.freeze({
        id: "billing-field-subscriber-group",
        label: "Группа абонента",
        value: group,
        status: removed ? "warning" : "ok",
        serviceAvailability: removed ? "blocked" : "",
        message: removed
          ? "Группа указывает на удалённого или неактивного абонента. Отсутствие доступа и Juniper-сессии может быть ожидаемым, но причину отключения нужно подтвердить."
          : "Абонент находится в рабочей группе; название группы также может подсказывать технологию подключения.",
        fieldNames: ["Группа", "Група"]
      }));
    }

    const internetPackage = valueFor("пакет");
    if (internetPackage) {
      const blocked = /заблок|заборон|blocked|відключ|отключ|inactive/i.test(internetPackage);
      results.push(Object.freeze({
        id: "billing-field-internet-package",
        label: "Интернет-пакет",
        value: internetPackage,
        status: blocked ? "warning" : "ok",
        serviceAvailability: blocked ? "blocked" : "",
        message: blocked
          ? "Интернет-пакет заблокирован или отключён. Активной Juniper-сессии в таком состоянии может не быть."
          : "Интернет-пакет назначен и не содержит явного признака блокировки.",
        fieldNames: ["Пакет"]
      }));
    }

    const access = valueFor("доступ", "статус доступа", "статус");
    if (access) {
      const forbidden = /запрещ|заборон|deny|forbid|blocked/i.test(access);
      const allowed = /разреш|дозвол|allow|active|enabled/i.test(access) && !forbidden;
      results.push(Object.freeze({
        id: "billing-field-access",
        label: "Доступ",
        value: access,
        status: allowed ? "ok" : "warning",
        serviceAvailability: forbidden ? "blocked" : "",
        message: allowed
          ? "Доступ разрешён — финансового запрета в этом поле нет."
          : "Доступ не разрешён. Сначала выясни причину запрета или блокировки.",
        fieldNames: ["Доступ", "Статус доступа", "Статус"]
      }));
    }

    const state = valueFor("состояние");
    if (state) {
      const ok = /все\s*ок|усе\s*гаразд|normal|active/i.test(state);
      const blocked = /пауза|заблок|заборон|отключ|відключ|inactive|disabled/i.test(state);
      results.push(Object.freeze({
        id: "billing-field-state",
        label: "Состояние",
        value: state,
        status: ok ? "ok" : "warning",
        serviceAvailability: blocked ? "blocked" : "",
        message: ok
          ? "Состояние карточки штатное."
          : "Состояние отличается от «Все ОК». Прочитай причину и комментарии перед дальнейшими действиями.",
        fieldNames: ["Состояние"]
      }));
    }

    const startDay = valueFor("день начала потребления услуг");
    if (startDay) {
      const parsed = Number(String(startDay).replace(",", "."));
      const validNumber = Number.isFinite(parsed);
      const ok = validNumber && parsed >= 0;
      results.push(Object.freeze({
        id: "billing-field-service-start-day",
        label: "Начало потребления услуг",
        value: startDay,
        status: ok ? "ok" : "warning",
        message: ok
          ? "День начала потребления услуг не отрицательный."
          : validNumber
            ? "Отрицательное значение может создавать запрет или неправильный расчёт услуги. Ожидается 0 или положительное число."
            : "Значение дня не удалось распознать как число — проверь поле вручную.",
        fieldNames: ["День начала потребления услуг"]
      }));
    }

    const balance = valueFor(
      "на счете с учетом стоимости тарифного плана, грн.",
      "на счете с учетом стоимости тарифного плана",
      "на рахунку з урахуванням вартості тарифного плану, грн."
    );
    if (balance) {
      const normalizedBalance = String(balance).replace(/[\s\u00a0]+/g, "").replace(",", ".");
      const parsed = Number(normalizedBalance.match(/[+-]?\d+(?:\.\d+)?/)?.[0]);
      const validNumber = Number.isFinite(parsed);
      const ok = validNumber && parsed >= 0;
      results.push(Object.freeze({
        id: "billing-field-balance-after-tariff",
        label: "Остаток после тарифа",
        value: balance,
        status: ok ? "ok" : "warning",
        serviceAvailability: validNumber && parsed < 0 ? "blocked" : "",
        message: ok
          ? parsed === 0
            ? "Текущий месяц оплачен: после учёта стоимости тарифа остаток равен нулю."
            : "После учёта стоимости тарифа остаётся положительный баланс."
          : validNumber
            ? "После учёта тарифа баланс отрицательный — Billing автоматически блокирует услугу до пополнения счёта."
            : "Остаток не удалось распознать как число — проверь значение вручную.",
        fieldNames: [
          "На счете с учетом стоимости тарифного плана, грн.",
          "На счете с учетом стоимости тарифного плана",
          "На рахунку з урахуванням вартості тарифного плану, грн."
        ]
      }));
    }
    return results;
  }

  function evaluateBillingTechnicalFields(context = {}, fields = {}) {
    if (context.system !== "billing" || context.billingSection !== "technical") return [];
    const entries = normalizedFieldEntries(fields);
    const valueFor = (...names) => {
      const expected = names.map((name) => String(name || "").toLowerCase());
      return entries.find(([name]) => expected.includes(name))?.[1] || "";
    };
    const technology = valueFor("технология подключения абонента");
    const subscriberMac = valueFor("мак-адрес абонента", "mac-адрес абонента");
    const eponMac = valueFor("epon onu мак-адрес", "epon onu mac-адрес");
    const gponSerial = valueFor("gpon ont серийный id", "gpon ont serial id");
    const rawOlt = valueFor("olt");
    const olt = /^(?:\.{2,}\s*)?(?:выбор|select|не выбрано)$/i.test(rawOlt) ? "" : rawOlt;
    const onuTv = valueFor("установлена onu c tv (кабельное тв)", "установлена onu с tv (кабельное тв)");
    const declaredEthernet = /ethernet|etth|fttb/i.test(technology);
    const declaredPon = /(?:^|[^a-z])pon(?:[^a-z]|$)|gpon|epon|xg-?pon|xgs-?pon/i.test(technology);
    const declaredWireless = /wireless|wifi|радио|беспровод/i.test(technology);
    const ponEvidence = Boolean(olt || eponMac || gponSerial);
    const classified = classifyBillingOlt({ technology, olt, eponMac, gponSerial });
    const validMac = (value) => /^(?:[0-9a-f]{2}[:-]){5}[0-9a-f]{2}$/i.test(String(value || "").trim())
      || /^[0-9a-f]{4}(?:\.[0-9a-f]{4}){2}$/i.test(String(value || "").trim());
    const results = [];

    const technologyConflict = declaredEthernet && ponEvidence;
    results.push(Object.freeze({
      id: "billing-technical-technology-result",
      group: "technology",
      label: "Тип подключения",
      value: technology || "Не указан",
      status: !technology || technologyConflict ? "warning" : "ok",
      message: !technology
        ? "Технология не указана: нельзя выбирать маршрут диагностики наугад. Сверь подключение в UserSide."
        : technologyConflict
          ? "Выбран Ethernet, но одновременно заполнены PON-поля. Это противоречие нужно сверить с фактическим подключением в UserSide."
          : declaredEthernet
            ? "Абонент подключён по Ethernet. Опрос ONU и выбор OLT не нужны; фактическую линию проверяй в UserSide."
            : declaredPon
              ? "Абонент подключён по PON. Дальше нужно проверить идентификатор ONU, назначенную OLT и выполнить опрос в правильном разделе."
              : declaredWireless
                ? "Указано беспроводное подключение. PON-поля не используются; дальнейший источник проверки определяется по UserSide."
                : "Технология указана нестандартным значением. Сверь её с UserSide перед выбором следующего раздела.",
      fieldNames: ["Технология подключения абонента"]
    }));

    results.push(Object.freeze({
      id: "billing-technical-subscriber-mac-result",
      group: "identifiers",
      label: "MAC абонента",
      value: subscriberMac || "Не указан",
      status: subscriberMac && validMac(subscriberMac) ? "ok" : "warning",
      message: subscriberMac
        ? validMac(subscriberMac)
          ? "Это MAC роутера или конечного устройства абонента. Сопоставляй его с Juniper и UserSide, но не путай с идентификатором ONU."
          : "MAC абонента заполнен в неожиданном формате. Сверь значение с надёжным источником до использования или изменения."
        : "MAC абонента не указан. Для Ethernet и DHCP-авторизации это важный идентификатор; проверь его в UserSide или Juniper.",
      fieldNames: ["Мак-адрес абонента", "MAC-адрес абонента"]
    }));

    let onuStatus = "inactive";
    let onuValue = "Не требуется для этой технологии";
    let onuMessage = "Для Ethernet или Wireless пустые EPON/GPON-поля являются нормой: опрос ONU не нужен.";
    if (declaredEthernet && (eponMac || gponSerial)) {
      onuStatus = "warning";
      onuValue = [eponMac && `EPON ${eponMac}`, gponSerial && `GPON ${gponSerial}`].filter(Boolean).join(" · ");
      onuMessage = "При выбранном Ethernet заполнен PON-идентификатор. Сверь фактическую технологию в UserSide и исправляй данные только после подтверждения.";
    } else if (declaredPon) {
      const both = Boolean(eponMac && gponSerial);
      const expectedEpon = classified.oltKind === "bdcom-epon";
      const expectedGpon = ["bdcom-gpon", "gcom", "huawei"].includes(classified.oltKind);
      const mismatch = (expectedEpon && !eponMac) || (expectedGpon && !gponSerial);
      onuStatus = !eponMac && !gponSerial || both || mismatch ? "warning" : "ok";
      onuValue = both
        ? `EPON ${eponMac} · GPON ${gponSerial}`
        : eponMac ? `EPON MAC ${eponMac}` : gponSerial ? `GPON Serial ${gponSerial}` : "Идентификатор ONU не указан";
      onuMessage = !eponMac && !gponSerial
        ? "Для PON не заполнен ни EPON ONU MAC, ни GPON ONT Serial. Без идентификатора нельзя надёжно сопоставить абонента с ONU на OLT."
        : both
          ? "Одновременно заполнены EPON MAC и GPON Serial. Обычно используется только один идентификатор согласно типу назначенной OLT."
          : mismatch
            ? "Тип заполненного идентификатора ONU не соответствует назначенной OLT: для EPON нужен ONU MAC, для GPON — ONT Serial."
            : "Идентификатор ONU заполнен в поле, соответствующем типу PON/OLT. Его нужно сопоставить с фактическим выводом опроса.";
    }
    results.push(Object.freeze({
      id: "billing-technical-onu-identity-result",
      group: "identifiers",
      label: "Идентификатор ONU",
      value: onuValue,
      status: onuStatus,
      message: onuMessage,
      fieldNames: declaredPon && gponSerial && !eponMac
        ? ["GPON ONT Серийный ID"]
        : ["EPON ONU Мак-адрес", "GPON ONT Серийный ID"]
    }));

    let oltStatus = "inactive";
    let oltValue = "Не требуется для этой технологии";
    let oltMessage = "Для Ethernet или Wireless пустая OLT является нормой.";
    if (declaredEthernet && olt) {
      oltStatus = "warning";
      oltValue = olt;
      oltMessage = "При выбранном Ethernet указана OLT. Сверь фактическую технологию и привязку в UserSide.";
    } else if (declaredPon) {
      oltStatus = olt ? (classified.menuTexts.length ? "ok" : "info") : "warning";
      oltValue = olt || "OLT не назначена";
      oltMessage = !olt
        ? "Для PON поле OLT пустое. Сначала открой ТМЦ абонента в UserSide, определи оборудование и только затем выбирай раздел опроса ONU."
        : classified.menuTexts.length
          ? `Назначенная OLT ведёт в раздел «${classified.menuTexts[0]}». Сопоставь её с идентификатором ONU.`
          : "OLT назначена, но её тип не удалось уверенно сопоставить с известным разделом опроса. Проверь оборудование в UserSide.";
    }
    results.push(Object.freeze({
      id: "billing-technical-olt-result",
      group: "binding",
      label: "Привязка OLT",
      value: oltValue,
      status: oltStatus,
      message: oltMessage,
      fieldNames: ["OLT"]
    }));

    results.push(Object.freeze({
      id: "billing-technical-onu-tv-result",
      group: "binding",
      label: "ONU с кабельным TV",
      value: onuTv || "Не указано",
      status: "info",
      message: "Это дополнительная характеристика установленной ONU. Она не доказывает наличие PON-технологии и не подтверждает работоспособность интернета.",
      fieldNames: ["Установлена ONU c TV (кабельное ТВ)", "Установлена ONU с TV (кабельное ТВ)"]
    }));

    let routeValue = "Сверить подключение в UserSide";
    let routeStatus = "warning";
    let routeMessage = "Технология не определена однозначно. Начни с карточки и ТМЦ абонента в UserSide.";
    let routeFieldNames = ["Технология подключения абонента"];
    if (declaredEthernet && !technologyConflict) {
      routeValue = "UserSide · коммутатор и порт";
      routeStatus = "info";
      routeMessage = "Для Ethernet открой UserSide и проверь узел, коммутатор, порт, link и изученный MAC. Опрос ONU не предлагай.";
    } else if (declaredPon && olt && classified.menuTexts.length) {
      routeValue = `Опрос ONU · ${classified.menuTexts[0]}`;
      routeStatus = onuStatus === "warning" ? "warning" : "info";
      routeMessage = `Открой раздел «${classified.menuTexts[0]}», опроси ONU и сопоставь идентификатор, состояние порта, оптику и историю событий.`;
      routeFieldNames = ["OLT"];
    } else if (declaredPon && !olt) {
      routeValue = "UserSide ТМЦ → определить OLT";
      routeStatus = "warning";
      routeMessage = "PON подтверждён, но OLT не назначена. Определи оборудование по ТМЦ UserSide; наставник не должен выбирать раздел наугад.";
      routeFieldNames = ["OLT"];
    } else if (declaredPon) {
      routeValue = "Сверить OLT в UserSide";
      routeStatus = "info";
      routeMessage = "PON подтверждён, но тип OLT не распознан. Сверь ТМЦ UserSide и выбери фактический раздел оборудования.";
      routeFieldNames = ["OLT"];
    } else if (declaredWireless) {
      routeValue = "UserSide · беспроводное подключение";
      routeStatus = "info";
      routeMessage = "Для Wireless проверь назначенное оборудование и фактическое состояние подключения в UserSide; PON-опрос не нужен.";
    }
    results.push(Object.freeze({
      id: "billing-technical-next-step-result",
      group: "next-step",
      label: "Следующий шаг",
      value: routeValue,
      status: routeStatus,
      message: routeMessage,
      fieldNames: routeFieldNames
    }));

    return results;
  }

  function classifyOnuOutputLine(context = {}, line = "") {
    if (context.system !== "billing" || context.billingSection !== "onu") return null;
    const text = String(line || "").trim();
    if (!text) return null;
    const lower = text.toLowerCase();

    if (/неверно\s+указан\s+mac\s+onu|incorrect(?:ly)?\s+(?:specified\s+)?onu\s+mac|onu\s+mac\s+mismatch/.test(lower)) {
      return Object.freeze({
        kind: "identity-conflict",
        label: "Конфликт MAC ONU",
        status: "warning",
        message: "OLT сообщает, что MAC ONU в карточке указан неверно. До дальнейшего вывода сопоставь MAC самой ONU и MAC устройства абонента."
      });
    }
    if (/show\s+epon\s+active-onu|lastregtime.*lastderegtime.*lastderegreason.*alivetime|\bepon\d*\/\d+(?::\d+)?\b.*(?:auto-configured|ctc-oam-oper).*(?:20\d{2}-\d{1,2}-\d{1,2}).*\b\d+\s*[.]\s*\d{1,2}:\d{2}:\d{2}\s*$/.test(lower)) {
      return Object.freeze({
        kind: "registration",
        label: "Регистрация и последний обрыв",
        status: /inactive|offline|llid-admin-down/.test(lower) ? "warning" : "ok",
        message: "Читай строку целиком: рабочий статус, расстояние, LastRegTime, LastDeregTime, причина прошлого обрыва и Alivetime описывают одну историю текущей регистрации."
      });
    }
    if (/service[-\s]?port|vlan[-\s]?id.*port[-\s]?id|^\d+\s+\d+\s+.*\bgpon\b\s+\d+\/\d+\/\d+\s+\d+/.test(lower)) {
      return Object.freeze({
        kind: "service-path",
        label: "Сервисная привязка и VLAN",
        status: /\bdown\b|disable|inactive/.test(lower) ? "warning" : "info",
        message: "Проверь service-port: VLAN и привязка к фактическим frame/slot/port и ONT должны относиться к этому абоненту."
      });
    }
    if (/active\s+time.*active\s+duration|\bgpon\d*\/\d+(?::\d+)?\b.*\b20\d{2}-\d{1,2}-\d{1,2}\s+\d{1,2}:\d{2}:\d{2}\b.*\b\d+d\s*[:.]\s*\d{1,2}:\d{2}:\d{2}\b/.test(lower)) {
      return Object.freeze({
        kind: "registration",
        label: "Текущая регистрация ONU",
        status: "ok",
        message: "Active Time показывает момент текущего подключения ONU, Active Duration — сколько непрерывно длится именно эта регистрация."
      });
    }
    if (/\bvlan\b/.test(lower)) {
      return Object.freeze({
        kind: "vlan",
        label: "VLAN",
        status: "info",
        message: "Сверь VLAN с назначенными техническими данными и UserSide."
      });
    }
    if (/^\s*epon\d*\/\d+(?::\d+)?\s+-\d+(?:[.,]\d+)?\s*$/.test(lower)) {
      return Object.freeze({
        kind: "optics",
        label: "Оптический уровень на OLT",
        status: "info",
        message: "RxPower — уровень, с которым OLT принимает сигнал от ONU. Оцени его по порогам вместе со стабильностью и соседними ONU."
      });
    }
    if (/(?:operational|admin|run|config(?:uration)?|match|working)\s+state|\bonu\b.*\bstate\b|\bstate\b.*\bonu\b|\bonu\s+\S+\s+is\s*-\s*(?:online|offline)\b|^(?:status|w\/s)\s*[:=]|auto-configured|authenticated|llid-admin-down|ctc-oam-oper|\b(?:epon|gpon)\d*\/\d+(?::\d+)?\b.*\b(?:active|inactive|online|offline)\b/.test(lower)) {
      const warning = /offline|down|disable|inactive|forbid|deny|запрещ|заборон/.test(lower);
      const ok = /online|active|enable|working|registered|operational|auto-configured|authenticated|ctc-oam-oper|\bup\b/.test(lower) && !warning;
      return Object.freeze({
        kind: "state",
        label: "Состояние ONU",
        status: warning ? "warning" : ok ? "ok" : "info",
        message: warning
          ? "ONU не в штатном активном состоянии — определи конкретную причину."
          : ok
            ? "ONU сообщает активное рабочее состояние."
            : "Статус важен для выбора следующей ветви диагностики."
      });
    }
    if (/(?:[0-9a-f]{2}[:-]){5}[0-9a-f]{2}|\b[0-9a-f]{4}(?:[.:-][0-9a-f]{4}){2}\b/i.test(text)) {
      return Object.freeze({
        kind: "mac",
        label: "MAC абонента",
        status: "info",
        message: "Сверь найденный MAC, VLAN и интерфейс с карточкой абонента и фактическим портом ONU."
      });
    }
    if (/(?:active|alive|online|on)\s*time|online\/offline\s+time|(?:active|alive|online|on)\s+duration|\buptime\b|duration\s*\(|lastregtime.*lastderegtime.*alivetime/.test(lower)) {
      return Object.freeze({
        kind: "duration",
        label: "Длительность работы",
        status: "info",
        message: "Длительность показывает стабильность текущего состояния и время последнего переподключения."
      });
    }
    if (/hardware\s+state|\bspeed\s+is\b|\bduplex\s+is\b|ethernet.*(?:link|state)|(?:onu|ont)\s*port.*state|\buni[-\s]?port\s+\d+\s+(?:is\s+)?(?:up|down)\b|\b(?:eth|ethernet)[-\s]?port\s+\d+\s+(?:is\s+)?(?:up|down)\b|\b(?:10000|2500|1000|100|10)\b.{0,80}\b(?:full|half)(?:[-\s]?duplex)?\b.{0,80}\b(?:up|down)\b|base[-\s]?t.*(?:full|half)[-\s]?duplex/.test(lower)) {
      const warning = /link[-\s]?down|hardware\s+state.*\bdown\b|half[-\s]?duplex|disable/.test(lower);
      const ok = /link[-\s]?up|\b(?:uni|eth|ethernet)[-\s]?port\b.*\bup\b|full[-\s]?duplex/.test(lower) && !warning;
      return Object.freeze({
        kind: "ethernet-port",
        label: "Порт ONU → роутер",
        status: warning ? "warning" : ok ? "ok" : "info",
        message: warning
          ? "Пользовательский Ethernet-порт не в штатном состоянии — проверь кабель, питание и WAN-порт роутера."
          : ok
            ? "Ethernet-link поднят; отдельно сверь скорость и Full-Duplex."
            : "Сверь скорость и duplex с тарифом и возможностями роутера."
      });
    }
    if (/(?:rx|tx).*(?:power|dbm)|(?:power|dbm).*(?:rx|tx)|rxfpower|txfpower|received\s+power|rxpower|txpower/.test(lower)) {
      return Object.freeze({
        kind: "optics",
        label: "Оптические уровни",
        status: "info",
        message: "Прочитай Rx/Tx по направлениям. Оценка порога будет добавлена отдельно для конкретной модели OLT."
      });
    }
    if (/deactive\s+reason|down\s*cause|last.*(?:down|up|event)|(?:down|up)\s+time|dying[-\s]+gasp|power-off|wire-down|\blosi?\b|\blobi\b|lastregtime|lastderegtime|lastderegreason|active\s+time.*deactive/.test(lower)) {
      return Object.freeze({
        kind: "events",
        label: "История событий ONU",
        status: "info",
        message: "Сопоставь причины и время отключений с обращением и состоянием соседних ONU."
      });
    }
    return null;
  }

  function analyzeOnuOutputLine(context = {}, line = "") {
    const text = String(line || "").trim();
    if (!text) return Object.freeze([]);
    const lower = text.toLowerCase();
    const facts = [];
    const add = (fact) => {
      if (fact && !facts.some((item) => item.kind === fact.kind)) facts.push(fact);
    };
    add(classifyOnuOutputLine(context, text));
    if (/^(?:show|display)\b.*\b(?:onu|ont)\b.*\bport\b.*\bstate\b/i.test(text)) {
      add(classifyOnuOutputLine(context, "uni-port 1 up"));
    }
    if (/service[-\s]?port|vlan[-\s]?id.*port[-\s]?id|^\d+\s+\d+\s+.*\bgpon\b\s+\d+\/\d+\/\d+\s+\d+/i.test(text)) {
      add(classifyOnuOutputLine(context, "service-port VLAN-ID PORT-ID"));
    }
    if (/active\s+time.*active\s+duration|\bgpon\d*\/\d+(?::\d+)?\b.*\b20\d{2}-\d{1,2}-\d{1,2}\s+\d{1,2}:\d{2}:\d{2}\b.*\b\d+d\s*[:.]\s*\d{1,2}:\d{2}:\d{2}\b/i.test(text)) {
      add(classifyOnuOutputLine(context, "Active Time Active Duration"));
    }
    if (/(?:[0-9a-f]{2}[:-]){5}[0-9a-f]{2}|\b[0-9a-f]{4}(?:[.:-][0-9a-f]{4}){2}\b/i.test(text)) {
      add(classifyOnuOutputLine(context, "00:11:22:33:44:55"));
    }
    if (/(?:active|alive|online|on)\s*time|online\/offline\s+time|(?:active|alive|online|on)\s+duration|\buptime\b|duration\s*\(|lastregtime.*lastderegtime.*alivetime|\bEPON\d*\/\d+(?::\d+)?\b.*\b\d+\s*\.\s*\d{1,2}:\d{2}:\d{2}\s*$/i.test(text)) {
      add(classifyOnuOutputLine(context, "Alivetime"));
    }
    if (/deactive\s+reason|down\s*cause|last.*(?:down|up|event)|(?:down|up)\s+time|dying[-\s]+gasp|power-off|wire-down|\blosi?\b|\blobi\b|lastregtime|lastderegtime|lastderegreason|active\s+time.*deactive/.test(lower)) {
      add(classifyOnuOutputLine(context, "01 2026-07-01 dying gasp"));
    }
    return Object.freeze(facts);
  }

  function classifyContext(input = {}) {
    const hostname = String(input.hostname || "").toLowerCase();
    const pathname = String(input.pathname || "");
    const search = String(input.search || "");
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
    const billingSection = system === "billing"
      ? classifyBillingSection({ pathname, search, pageText })
      : "";
    const technology = system === "billing"
      ? billingSection === "onu"
        ? "pon"
        : normalizeTechnology(input.technologyText || "")
      : normalizeTechnology(pageText);
    return Object.freeze({
      system,
      pageType,
      billingSection,
      technology,
      provider: String(input.provider || ""),
      hostname,
      pathname,
      search
    });
  }

  function rulesForContext(context = {}) {
    return rules
      .filter((rule) => rule.systems.includes(context.system))
      .filter((rule) => rule.pageTypes.includes(context.pageType))
      .filter((rule) => !rule.billingSections || rule.billingSections.includes(context.billingSection))
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
    classifyBillingSection,
    classifyBillingOlt,
    classifyContext,
    classifyOnuOutputLine,
    analyzeOnuOutputLine,
    evaluateBillingFields,
    evaluateBillingTechnicalFields,
    normalizeTechnology,
    progressFor,
    rulesForContext
  });
})();
