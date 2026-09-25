import { readFile } from "node:fs/promises";

const cases = JSON.parse(await readFile(new URL("../tests/negotiation-quality-cases.json", import.meta.url), "utf8"));
if (cases.length < 20) throw new Error("Нужно не меньше 20 проверочных сценариев.");
if (new Set(cases.map((item) => item.id)).size !== cases.length) throw new Error("ID сценариев должны быть уникальными.");

const baseUrl = process.env.QUALITY_BASE_URL;
if (!baseUrl) {
  console.log(`Проверено ${cases.length} сценариев. Для проверки живой модели задайте QUALITY_BASE_URL=http://localhost:3000.`);
  process.exit(0);
}

const route = [
  ["need", "Выяснить задачу и результат", ["задача", "результат", "потребность"]],
  ["motive", "Раскрыть мотивацию", ["почему важно", "последствия", "мотивация"]],
  ["limits", "Уточнить ограничения", ["бюджет", "срок", "решение"]],
  ["criteria", "Согласовать критерии", ["критерии", "приёмка", "показатели"]],
  ["exchange", "Предложить обмен", ["если", "в обмен", "при условии"]],
  ["risk", "Снизить риск", ["гарантия", "этап", "проверка"]],
  ["agreement", "Зафиксировать соглашение", ["договорились", "фиксируем", "следующий шаг"]],
].map(([id, intent, evidence]) => ({ id, intent, evidence }));
const player = { name:"Александр",patronymic:"Сергеевич",side:"provider",role:"Дизайнер",goal:"Согласовать разработку сайта",boundaries:"Не работать бесплатно",person:"Опытный дизайнер",motivation:"Заключить честную сделку",character:"Уверенный",hiddenInterest:"Долгая работа",speechStyle:"Коротко",habits:"Уточняет",languageStyle:"Нейтральная",emotionality:"Сдержанная" };
const opponent = { name:"Андрей",patronymic:"Михайлович",side:"buyer",role:"Владелец компании",goal:"Получить сайт в бюджете",boundaries:"Бюджет фиксирован",person:"Ранее сталкивался со срывом сроков",motivation:"Снизить риски",character:"Осторожный",hiddenInterest:"Быстрый прототип",speechStyle:"Деловой",habits:"Переспрашивает сроки",languageStyle:"Нейтральная",emotionality:"Сдержанная" };
const state = { turn:0,trust:50,irritation:10,dealInterest:55,ethicalConduct:70,misunderstanding:5,reserveFound:false,reserveUsed:false,status:"active",matchedKeywords:[],routeProgress:0,memory:{promises:[],concessions:[],contradictions:[],threats:[],agreements:[],openQuestions:[]} };
const plan = { opponentPrompt:`Оппонент — заказчик ${opponent.name}, цель: ${opponent.goal}. Не продаёт услуги.`,route,keywords:route.map(x=>x.id),maxMessages:55 };
let failures = 0;
for (const item of cases) {
  const messages = [{role:"opponent",text:"Расскажите, что вы предлагаете."},{role:"player",text:item.message}];
  const response = await fetch(`${baseUrl}/api/chat`, {method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({player,opponent,plan,state,messages,messageCount:3})});
  const data = await response.json();
  const errors = [];
  if (!response.ok) errors.push(data.error ?? `HTTP ${response.status}`);
  if (item.expect && !data.evaluation?.matchedKeywords?.includes(item.expect)) errors.push(`не найден этап ${item.expect}`);
  if (item.expectAction && data.evaluation?.action !== item.expectAction) errors.push(`действие ${data.evaluation?.action}`);
  if (item.expectConcern && data.evaluation?.ethicalConcern !== item.expectConcern) errors.push(`этика ${data.evaluation?.ethicalConcern}`);
  if (item.expectNoRoute && data.evaluation?.matchedKeywords?.length) errors.push("засчитан посторонний смысл");
  if (item.forbid && String(data.reply).toLowerCase().includes(item.forbid)) errors.push("перепутана роль");
  if (item.expectMemory && !data.evaluation?.memoryUpdates?.[item.expectMemory]?.length) errors.push(`не заполнена память ${item.expectMemory}`);
  if (errors.length) { failures++; console.error(`${item.id}: ${errors.join(", ")}`); }
}
if (failures) throw new Error(`Не прошли ${failures} из ${cases.length} сценариев.`);
console.log(`Живая модель прошла ${cases.length} сценариев.`);
