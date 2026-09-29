export type PartySide = "buyer" | "provider" | "neutral";
export type Difficulty = "easy" | "normal" | "serious";

export type SideProfile = {
  name: string;
  patronymic: string;
  side: PartySide;
  role: string;
  goal: string;
  boundaries: string;
  person: string;
  motivation: string;
  character: string;
  hiddenInterest: string;
  speechStyle: string;
  habits: string;
  languageStyle: string;
  emotionality: string;
  services?: string;
  experienceStrengths?: string;
  objectionMethod?: "clarify" | "agree" | "reframe";
  closingMethod?: "next-step" | "alternative" | "summary";
  difficulty?: Difficulty;
  skillIds?: string[];
  situationTags?: string[];
};

export type RouteStep = { id: string; intent: string; evidence: string[] };
export type NegotiationPlan = { opponentPrompt: string; route: RouteStep[]; keywords: string[]; maxMessages: number };
export type NegotiationState = {
  turn: number; trust: number; irritation: number; dealInterest: number;
  ethicalConduct: number; misunderstanding: number;
  reserveFound: boolean; reserveUsed: boolean; status: "active" | "deal" | "compromise" | "walkaway";
  matchedKeywords: string[]; routeProgress: number;
  memory: NegotiationMemory;
};
export type NegotiationMemory = { promises: string[]; concessions: string[]; contradictions: string[]; threats: string[]; agreements: string[]; openQuestions: string[] };
export type PlayerAction = "question" | "offer" | "trade" | "pressure" | "alternative" | "statement";
export type SemanticEvaluation = {
  action: PlayerAction;
  trustDelta: number;
  irritationDelta: number;
  dealInterestDelta: number;
  ethicalConductDelta: number;
  misunderstandingDelta: number;
  matchedKeywords: string[];
  reserveFound: boolean;
  reserveUsed: boolean;
  rationale: string;
  interpretation: string;
  betterReply: string;
  ethicalConcern: "none" | "ambiguity" | "disrespect" | "deception" | "coercion";
  nonverbalCue: string;
  memoryUpdates: Partial<NegotiationMemory>;
};
export type TurnSnapshot = { turn: number; before: NegotiationState; after: NegotiationState; action: PlayerAction; actionLabel: string; rationale?: string; advice?: string; nonverbalCue?: string };
export type SessionReport = { summary: string; agreed: string[]; openQuestions: string[]; interests: string[]; mistakes: string[]; advice: string[]; risks: string[] };

export const sideLabels: Record<PartySide, string> = {
  buyer: "Сторона заказчика",
  provider: "Сторона исполнителя",
  neutral: "Нейтральная сторона",
};

const clamp = (value: number) => Math.max(0, Math.min(100, value));
const clampDelta = (value: number) => Math.max(-15, Math.min(15, Math.round(value)));
const actionLabels: Record<PlayerAction, string> = {
  question: "уточняющий вопрос",
  offer: "предложение условий",
  trade: "условный обмен",
  pressure: "давление",
  alternative: "обозначение альтернативы",
  statement: "позиция без вопроса",
};

export function createPlan(player: SideProfile, opponent: SideProfile): NegotiationPlan {
  const spin: RouteStep[] = [
    { id: "spin-s", intent: "Понять текущую ситуацию заказчика", evidence: ["как сейчас", "текущая ситуация", "как устроен процесс", "что используете"] },
    { id: "spin-p", intent: "Выяснить проблему или неудобство", evidence: ["что не устраивает", "какая проблема", "что мешает", "сложность"] },
    { id: "spin-i", intent: "Уточнить последствия проблемы", evidence: ["к чему приводит", "какие последствия", "что произойдёт", "как влияет"] },
    { id: "spin-n", intent: "Определить желаемый результат", evidence: ["какой результат важен", "какая выгода", "что изменится", "ценность решения"] },
  ];
  const difficulty = opponent.difficulty ?? player.difficulty ?? "normal";
  const needSteps = difficulty === "easy" ? [spin[0], spin[3]] : difficulty === "normal" ? [spin[0], spin[1], spin[3]] : spin;
  const objectionLabels = { clarify: "Уточнить причину возражения и ответить", agree: "Согласиться с сомнением и дополнить фактами", reframe: "Переформулировать возражение через выгоду" };
  const closingLabels = { "next-step": "Предложить конкретный следующий шаг", alternative: "Предложить выбор из двух вариантов", summary: "Подвести итог и зафиксировать договорённости" };
  const objectionMethod = player.objectionMethod ?? "clarify";
  const closingMethod = player.closingMethod ?? "next-step";
  const route: RouteStep[] = [...needSteps,
    { id: "objection", intent: objectionLabels[objectionMethod], evidence: ["правильно понимаю", "что именно вызывает сомнение", "согласен", "понимаю сомнение", "давайте посмотрим иначе", "снять риск"] },
    { id: "closing", intent: closingLabels[closingMethod], evidence: ["следующий шаг", "выберите вариант", "подведём итог", "фиксируем", "договорились", "подтверждаете"] },
  ];
  const keywords = route.map((step) => step.id);
  const opponentPrompt = `КОНТЕКСТ ПЕРЕГОВОРОВ\nПользователь: ${player.name} ${player.patronymic}; профессия: ${player.role || "не указана"}.\nУСЛУГА ПОЛЬЗОВАТЕЛЯ (исходная формулировка, её нужно понять по смыслу, а не копировать грамматически): «${player.services ?? player.goal}».\nОпыт и сильные стороны пользователя: ${player.experienceStrengths ?? "не указаны"}.\nОппонент: ${opponent.name} ${opponent.patronymic}; роль — заказчик; сфера бизнеса — ${opponent.role}.\nПредполагаемая потребность заказчика: ${opponent.person}. Цель заказчика: ${opponent.goal}. Личная мотивация: ${opponent.motivation}. Внутренние ограничения: ${opponent.boundaries}. Скрытый интерес: ${opponent.hiddenInterest}.\nПоведение: ${opponent.character}; стиль речи: ${opponent.speechStyle}; привычки: ${opponent.habits}; сложность: ${opponent.difficulty ?? "normal"}.\nВеди разговор только об указанной услуге и о том, как она может решить задачу этого бизнеса. Если формулировка услуги короткая или разговорная, сначала молча нормализуй её смысл (например, «создаю сайты» = «разработка сайта»), затем отвечай естественным русским языком. Не придумывай другую услугу. Не отказывайся от релевантной услуги без причины. Защищай интересы заказчика, не раскрывай скрытые параметры, помни факты и никогда не меняйся ролями с пользователем.`;
  return { opponentPrompt, route, keywords, maxMessages: 55 };
}

export function createInitialState(): NegotiationState {
  return { turn: 0, trust: 50, irritation: 10, dealInterest: 55, ethicalConduct: 70, misunderstanding: 5, reserveFound: false, reserveUsed: false, status: "active", matchedKeywords: [], routeProgress: 0, memory: { promises: [], concessions: [], contradictions: [], threats: [], agreements: [], openQuestions: [] } };
}

function mergeMemory(current: NegotiationMemory, updates: Partial<NegotiationMemory>): NegotiationMemory {
  const merge = (key: keyof NegotiationMemory) => [...new Set([...(current[key] ?? []), ...(updates[key] ?? []).map((item) => String(item).slice(0, 180))])].slice(-20);
  return { promises: merge("promises"), concessions: merge("concessions"), contradictions: merge("contradictions"), threats: merge("threats"), agreements: merge("agreements"), openQuestions: merge("openQuestions") };
}

export function applySemanticEvaluation(state: NegotiationState, evaluation: SemanticEvaluation, plan: NegotiationPlan, nextMessageCount: number) {
  const before = { ...state, matchedKeywords: [...state.matchedKeywords] };
  const allowed = new Map(plan.keywords.map((keyword) => [keyword.toLowerCase(), keyword]));
  const needIds = plan.route.filter((step) => step.id.startsWith("spin-")).map((step) => step.id);
  const activeIds = needIds.some((id) => !state.matchedKeywords.includes(id)) ? new Set(needIds)
    : !state.matchedKeywords.includes("objection") ? new Set(["objection"])
      : new Set(["closing"]);
  const newMatches = evaluation.matchedKeywords
    .map((keyword) => allowed.get(String(keyword).toLowerCase()))
    .filter((keyword): keyword is string => keyword !== undefined && activeIds.has(keyword));
  const matchedKeywords = [...new Set([...state.matchedKeywords, ...newMatches])];
  const routeProgress = plan.keywords.length ? Math.round((matchedKeywords.length / plan.keywords.length) * 100) : 0;
  const next: NegotiationState = {
    ...state,
    turn: state.turn + 1,
    trust: clamp(state.trust + clampDelta(evaluation.trustDelta)),
    irritation: clamp(state.irritation + clampDelta(evaluation.irritationDelta)),
    dealInterest: clamp(state.dealInterest + clampDelta(evaluation.dealInterestDelta)),
    ethicalConduct: clamp(state.ethicalConduct + clampDelta(evaluation.ethicalConductDelta)),
    misunderstanding: clamp(state.misunderstanding + clampDelta(evaluation.misunderstandingDelta)),
    reserveFound: state.reserveFound || evaluation.reserveFound,
    reserveUsed: state.reserveUsed || evaluation.reserveUsed,
    matchedKeywords,
    routeProgress,
    memory: mergeMemory(state.memory ?? createInitialState().memory, evaluation.memoryUpdates ?? {}),
  };
  if (routeProgress === 100 && next.trust >= 55 && next.dealInterest >= 65 && next.ethicalConduct >= 45 && next.misunderstanding <= 40) next.status = "deal";
  else if (next.irritation >= 85 || next.trust <= 10 || next.ethicalConduct <= 15 || next.misunderstanding >= 85 || nextMessageCount >= plan.maxMessages) next.status = "walkaway";
  const snapshot: TurnSnapshot = {
    turn: next.turn,
    before,
    after: { ...next, matchedKeywords: [...matchedKeywords] },
    action: evaluation.action,
    actionLabel: actionLabels[evaluation.action],
    rationale: `${evaluation.rationale} Понимание оппонента: ${evaluation.interpretation}`,
    advice: evaluation.betterReply,
    nonverbalCue: evaluation.nonverbalCue,
  };
  return { state: next, snapshot };
}

export function evaluateTurn(state: NegotiationState, message: string, opponent: SideProfile, plan: NegotiationPlan, nextMessageCount: number) {
  const text = message.toLowerCase();
  const question = message.includes("?") || /что|какие|почему|важно|можете|готовы ли/.test(text);
  const trade = /если.{0,60}то|в обмен|при условии|готов.{0,35}если/.test(text);
  const pressure = /последн|иначе|обязаны|требую|никаких|только сегодня/.test(text);
  const alternative = /альтернатив|друг(ой|ого)|конкурент|вариант|batna|батна/.test(text);
  const offer = /предлага|услов|цен|срок|процент|оплат|постав|договор/.test(text);
  const action: PlayerAction = pressure ? "pressure" : alternative ? "alternative" : trade ? "trade" : offer ? "offer" : question ? "question" : "statement";
  const normalized = text.replace(/ё/g, "е");
  const matchedKeywords = plan.keywords.filter((keyword) => normalized.includes(keyword.toLowerCase().replace(/ё/g, "е")));
  const evaluation: SemanticEvaluation = {
    action,
    trustDelta: pressure ? -12 : trade ? 8 : question ? 4 : 0,
    irritationDelta: pressure ? 17 : alternative ? 2 : 0,
    dealInterestDelta: pressure ? -8 : trade ? 10 : offer ? 5 : question ? 2 : 0,
    ethicalConductDelta: pressure ? -8 : trade ? 3 : question ? 1 : 0,
    misunderstandingDelta: pressure ? 4 : question ? -2 : 0,
    matchedKeywords,
    reserveFound: trade || alternative,
    reserveUsed: trade,
    rationale: "Резервная оценка по формулировке реплики.",
    interpretation: "Оппонент понял буквальный смысл реплики.",
    betterReply: question ? "Сформулируйте один конкретный вопрос и свяжите его с целью переговоров." : "Добавьте конкретное условие, выгоду второй стороны и следующий шаг.",
    ethicalConcern: pressure ? "coercion" : "none",
    nonverbalCue: pressure ? "напрягается и выдерживает паузу" : question ? "внимательно слушает" : "сохраняет нейтральное выражение",
    memoryUpdates: { threats: pressure ? [message.slice(0, 180)] : [], openQuestions: question ? [message.slice(0, 180)] : [], concessions: trade ? [message.slice(0, 180)] : [], promises: /обеща|гарантир|обязуюсь/.test(text) ? [message.slice(0, 180)] : [] },
  };
  const result = applySemanticEvaluation(state, evaluation, plan, nextMessageCount);
  return { ...result, reply: fallbackReply(result.state, action, opponent), evaluation };
}

function fallbackReply(state: NegotiationState, action: PlayerAction, opponent: SideProfile) {
  if (state.status === "deal") return `Мы обсудили ключевые условия. Я готов зафиксировать договорённость: ${opponent.goal}`;
  if (state.status === "walkaway") return "Лимит разговора исчерпан или позиции слишком далеки. Предлагаю завершить обсуждение.";
  if (action === "pressure") return "Ультиматумы не помогают. Назовите взаимовыгодный обмен.";
  if (action === "question") return `Для меня важно следующее: ${opponent.motivation} Что вы готовы предложить?`;
  if (action === "trade") return "Такой обмен можно обсуждать. Уточните выгоду каждой стороны.";
  if (action === "alternative") return "Я понимаю, что у вас есть другие варианты. Чем наше соглашение всё ещё ценно?";
  return `Я услышал вас. Мои границы остаются такими: ${opponent.boundaries}`;
}
