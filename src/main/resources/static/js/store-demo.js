import { resources, availability as checkAvailability } from "./data.js";

// 화면 검증용 브라우저 저장소입니다. 실제 인증·권한 검사는 서버 연동 시 구현합니다.
const DATABASE = "campusrent.ui.demo.v1";
const SELECTION_KEY = "campusrent.ui.selection.v1";
const listeners = new Set();
const clone = (value) => typeof structuredClone === "function" ? structuredClone(value) : JSON.parse(JSON.stringify(value));
const uid = () => globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
const snapshot = { user: null, selection: [], records: [], equipmentStates: {}, storageError: "" };
const accounts = new Map();
let database;
let submitting = false;
let seedPromise;

function sessionRead(key, fallback) {
  try { return JSON.parse(sessionStorage.getItem(key) ?? "null") ?? fallback; }
  catch { return fallback; }
}
const storedSelection = sessionRead(SELECTION_KEY, []);
if (Array.isArray(storedSelection)) {
  const seen = new Set();
  snapshot.selection = storedSelection.filter((item) => {
    if (!item || typeof item.id !== "string" || !resources.some((r) => r.id === item.resourceId) || seen.has(item.resourceId)) return false;
    seen.add(item.resourceId);
    return true;
  });
}

export const getState = () => clone(snapshot);
export function subscribe(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
function emit() {
  for (const listener of listeners) {
    try { listener(getState()); } catch (error) { console.error("CampusRent 화면 갱신 오류", error); }
  }
}
function persistSession() {
  try {
    sessionStorage.setItem(SELECTION_KEY, JSON.stringify(snapshot.selection));
  } catch { snapshot.storageError = "임시 입력을 브라우저에 보관하지 못했습니다. 이 화면을 닫으면 선택 내용이 사라질 수 있습니다."; }
  emit();
}

function openDatabase() {
  return new Promise((resolve, reject) => {
    if (!globalThis.indexedDB) return reject(new Error("브라우저 저장소를 사용할 수 없습니다. localhost로 화면을 열어주세요."));
    const request = indexedDB.open(DATABASE, 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore("records", { keyPath: "number" });
      request.result.createObjectStore("equipment", { keyPath: "id" });
    };
    request.onsuccess = () => {
      database = request.result;
      database.onversionchange = () => { database.close(); database = null; };
      resolve(database);
    };
    request.onerror = () => reject(new Error("브라우저 저장소를 열지 못했습니다. 브라우저의 저장 설정을 확인해주세요."));
    request.onblocked = () => reject(new Error("다른 창이 저장소 변경을 막고 있습니다. 기존 시연 창을 닫고 새로고침해주세요."));
  });
}

function loadDatabase() {
  return new Promise((resolve, reject) => {
    if (!database) return reject(new Error("브라우저 저장소가 연결되지 않았습니다. 새로고침 후 다시 시도해주세요."));
    const transaction = database.transaction(["records", "equipment"], "readonly");
    const records = transaction.objectStore("records").getAll();
    const equipment = transaction.objectStore("equipment").getAll();
    transaction.oncomplete = () => {
      snapshot.records = records.result.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      snapshot.equipmentStates = Object.fromEntries(equipment.result.map(({ id, ...state }) => [id, state]));
      snapshot.storageError = "";
      emit();
      resolve(getState());
    };
    transaction.onerror = () => reject(new Error("신청 내역을 읽지 못했습니다. 새로고침 후 다시 시도해주세요."));
    transaction.onabort = transaction.onerror;
  });
}

export const ready = openDatabase().then(loadDatabase).catch((error) => {
  snapshot.storageError = error.message;
  emit();
  return getState();
});

export async function refreshRecords() {
  await ready;
  try { return await loadDatabase(); }
  catch (error) { snapshot.storageError = error.message; emit(); throw error; }
}

const channel = typeof BroadcastChannel === "function" ? new BroadcastChannel("campusrent.ui.demo.changed.v1") : null;
if (channel) channel.onmessage = () => loadDatabase().catch((error) => { snapshot.storageError = error.message; emit(); });
if (typeof document !== "undefined") document.addEventListener("visibilitychange", () => {
  if (!document.hidden && database) loadDatabase().catch((error) => { snapshot.storageError = error.message; emit(); });
});

// 모든 기록 변경은 같은 두 object store의 readwrite 트랜잭션에서 최신 상태를 읽고 검증합니다.
async function transact(mutate) {
  await ready;
  if (!database) throw new Error(snapshot.storageError || "브라우저 저장소를 사용할 수 없습니다.");
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(["records", "equipment"], "readwrite");
    const recordStore = transaction.objectStore("records");
    const equipmentStore = transaction.objectStore("equipment");
    const recordsRequest = recordStore.getAll();
    const equipmentRequest = equipmentStore.getAll();
    let records, states, result, failure;
    const run = () => {
      if (!records || !states) return;
      try { result = mutate(records, states, recordStore, equipmentStore); }
      catch (error) { failure = error; transaction.abort(); }
    };
    recordsRequest.onsuccess = () => { records = recordsRequest.result; run(); };
    equipmentRequest.onsuccess = () => {
      states = Object.fromEntries(equipmentRequest.result.map(({ id, ...state }) => [id, state]));
      run();
    };
    transaction.oncomplete = () => {
      snapshot.records = records.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      snapshot.equipmentStates = states;
      snapshot.storageError = "";
      emit();
      channel?.postMessage({ changedAt: Date.now() });
      resolve(clone(result));
    };
    transaction.onabort = () => reject(failure || new Error("저장에 실패했습니다. 입력을 유지하고 다시 시도해주세요."));
    transaction.onerror = () => { failure ??= new Error("저장에 실패했습니다. 입력을 유지하고 다시 시도해주세요."); };
  });
}

async function verifier(password) {
  if (!globalThis.crypto?.subtle) throw new Error("시연 로그인은 localhost 또는 HTTPS 환경에서 사용해주세요.");
  const bytes = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(password)));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}
function seedAccounts() {
  seedPromise ??= (async () => {
    const studentPassword = await verifier("Campus123!");
    for (const [email, id, name] of [["demo@campusrent.example", "demo-user", "시연 사용자"], ["other@campusrent.example", "other-user", "다른 사용자"]]) {
      accounts.set(email, { user: { id, name, email, role: "student" }, verifier: studentPassword });
    }
    const email = "admin@campusrent.example";
    accounts.set(email, { user: { id: "demo-admin", name: "시연 관리자", email, role: "admin" }, verifier: await verifier("CampusAdmin123!") });
  })();
  return seedPromise;
}
function validateEmail(email) {
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("올바른 이메일 형식으로 입력해주세요.");
}
export async function login(email, password) {
  email = String(email ?? "").trim().toLowerCase();
  validateEmail(email);
  if (!password) throw new Error("비밀번호를 입력해주세요.");
  await seedAccounts();
  if (email === "fail@campusrent.example") throw new Error("시연 인증 처리가 실패했습니다. 잠시 후 다시 시도해주세요.");
  const account = accounts.get(email);
  if (!account || account.verifier !== await verifier(password)) throw new Error("이메일 또는 비밀번호를 확인해주세요.");
  snapshot.user = clone(account.user);
  persistSession();
  return clone(snapshot.user);
}
export async function signup({ name, email, password }) {
  name = String(name ?? "").trim();
  email = String(email ?? "").trim().toLowerCase();
  if (!name) throw new Error("이름을 입력해주세요.");
  validateEmail(email);
  if (typeof password !== "string" || password.length < 8 || !/[a-z]/i.test(password) || !/\d/.test(password)) throw new Error("비밀번호는 8자 이상, 영문과 숫자를 포함해주세요.");
  await seedAccounts();
  if (accounts.has(email)) throw new Error("이미 사용 중인 시연 이메일입니다. 로그인하거나 다른 이메일을 입력해주세요.");
  const user = { id: uid(), name, email, role: "student" };
  accounts.set(email, { user, verifier: await verifier(password) });
  snapshot.user = clone(user);
  persistSession();
  return clone(user);
}
export function logout() { snapshot.user = null; persistSession(); }

function resourceById(id) {
  const resource = resources.find((entry) => entry.id === id);
  if (!resource) throw new Error("자원 정보를 찾을 수 없습니다.");
  return resource;
}
function reservations(records, exclude) {
  return records.flatMap((record) => record.items.filter((item) =>
    !["승인 대기", "거절", "신청 취소 완료"].includes(item.status) &&
    !(exclude?.number === record.number && exclude?.itemId === item.id)
  ).map((item) => ({ resourceId: item.resourceId, start: item.condition.start, end: item.condition.end })));
}
function restrictions(records, states) {
  const result = {};
  for (const [id, state] of Object.entries(states)) {
    if (state.status === "점검") result[id] = "장비 점검 중입니다. 반환 확인과 점검 완료 전에는 이용할 수 없습니다.";
  }
  for (const record of records) for (const item of record.items) {
    if (item.kind === "장비" && item.status === "반납 보류") result[item.resourceId] = "구성품 반환 확인이 완료되지 않아 장비 이용이 제한됩니다.";
  }
  return result;
}
export function availability(resource, condition) {
  return checkAvailability(resource, condition, reservations(snapshot.records), restrictions(snapshot.records, snapshot.equipmentStates));
}
export function getReservations() { return reservations(snapshot.records); }
export function getRestrictions() { return restrictions(snapshot.records, snapshot.equipmentStates); }

export function toggleSelection(resourceId, condition = null) {
  const index = snapshot.selection.findIndex((item) => item.resourceId === resourceId);
  if (index !== -1) { snapshot.selection.splice(index, 1); persistSession(); return; }
  const resource = resourceById(resourceId);
  if (!resource.rentable || resource.status !== "정상") throw new Error("현재 이용할 수 없는 자원입니다.");
  if (condition) {
    const errors = availability(resource, condition);
    if (errors.length) throw new Error(errors.join(" "));
  }
  snapshot.selection.push({ id: uid(), resourceId, condition: condition ? clone(condition) : null });
  persistSession();
}
export function updateSelection(id, condition) {
  const item = snapshot.selection.find((entry) => entry.id === id);
  if (!item) throw new Error("선택 항목을 찾을 수 없습니다.");
  const errors = availability(resourceById(item.resourceId), condition);
  if (errors.length) throw new Error(errors.join(" "));
  item.condition = clone(condition);
  persistSession();
}
export function removeSelection(id) { snapshot.selection = snapshot.selection.filter((item) => item.id !== id); persistSession(); }
export function clearSelection() { snapshot.selection = []; persistSession(); }

function actor(role) {
  if (!snapshot.user) throw new Error("먼저 로그인해주세요.");
  if (snapshot.user.role !== role || (role === "admin" && snapshot.user.id !== "demo-admin")) throw new Error(role === "admin" ? "관리자만 처리할 수 있습니다." : "학생 계정으로 이용해주세요.");
  return clone(snapshot.user);
}

export async function submitSelection() {
  if (submitting) throw new Error("신청을 저장하고 있습니다. 잠시 기다려주세요.");
  const user = actor("student");
  const selection = clone(snapshot.selection);
  if (!selection.length) throw new Error("신청할 장비나 시설을 먼저 선택해주세요.");
  submitting = true;
  try {
    const result = await transact((records, states, recordStore) => {
      if (snapshot.user?.id !== user.id) throw new Error("로그인 상태가 변경되었습니다. 다시 확인해주세요.");
      const blocks = reservations(records);
      const limits = restrictions(records, states);
      const items = selection.map((selected, index) => {
        const resource = resourceById(selected.resourceId);
        if (!selected.condition) throw new Error(`${resource.name}: 이용 조건을 먼저 입력해주세요.`);
        const errors = checkAvailability(resource, selected.condition, blocks, limits);
        if (errors.length) throw new Error(`${resource.name}: ${errors.join(" ")}`);
        return { ...clone(resource), id: uid(), resourceId: resource.id, originalIndex: index + 1, condition: clone(selected.condition), status: "승인 대기", reason: "", version: 0, history: [], returnedComponents: {}, inspections: [] };
      });
      const now = new Date().toISOString();
      const record = { number: `CR-${now.slice(0, 10).replaceAll("-", "")}-${uid().replaceAll("-", "").slice(0, 8).toUpperCase()}`, userId: user.id, userName: user.name, createdAt: now, items };
      recordStore.add(record);
      records.push(record);
      return record;
    });
    const submitted = new Set(selection.map((item) => item.id));
    snapshot.selection = snapshot.selection.filter((item) => !submitted.has(item.id));
    persistSession();
    return result;
  } finally { submitting = false; }
}

function mutateItem(number, itemId, expectedVersion, mutation) {
  return transact((records, states, recordStore, equipmentStore) => {
    const record = records.find((entry) => entry.number === number);
    const item = record?.items.find((entry) => entry.id === itemId);
    if (!record || !item) throw new Error("최신 신청 항목을 찾을 수 없습니다. 내역을 새로 확인해주세요.");
    if (!Number.isInteger(expectedVersion) || item.version !== expectedVersion) throw new Error("다른 창에서 처리 상태가 변경되었습니다. 최신 내역을 확인한 뒤 다시 처리해주세요.");
    const from = item.status;
    const who = snapshot.user ? clone(snapshot.user) : null;
    const detail = mutation({ record, item, records, states, who, equipmentStore });
    const now = new Date().toISOString();
    item.version += 1;
    item.updatedAt = now;
    item.history.push({ action: detail.action, at: now, actor: who, from, to: item.status, reason: detail.reason ?? "" });
    recordStore.put(record);
    return item;
  });
}
export function cancelItem(number, itemId, expectedVersion) {
  return mutateItem(number, itemId, expectedVersion, ({ record, item }) => {
    const user = actor("student");
    if (record.userId !== user.id || item.status !== "승인 대기") throw new Error("본인의 승인 대기 신청만 취소할 수 있습니다.");
    item.status = "신청 취소 완료";
    return { action: "cancel" };
  });
}
export function requestReturn(number, itemId, expectedVersion) {
  return mutateItem(number, itemId, expectedVersion, ({ record, item }) => {
    const user = actor("student");
    if (record.userId !== user.id || item.kind !== "장비" || item.status !== "대여 중") throw new Error("본인의 대여 중 장비만 반납을 신청할 수 있습니다.");
    item.status = "반납 신청";
    return { action: "request-return" };
  });
}

function setEquipment(states, equipmentStore, resourceId, status, reason, who, number) {
  const prior = states[resourceId];
  const state = { status, reason, version: (prior?.version ?? 0) + 1, relatedRecord: number, events: [...(prior?.events ?? []), { status, reason, actor: who, at: new Date().toISOString(), recordNumber: number }] };
  states[resourceId] = state;
  equipmentStore.put({ id: resourceId, ...state });
}
function hasOutstandingEquipment(records, resourceId, excludedItemId) {
  return records.some((record) => record.items.some((item) => item.id !== excludedItemId && item.resourceId === resourceId && ["대여 중", "반납 신청", "반납 보류"].includes(item.status)));
}
function inspectionRows(rows, definitions) {
  if (!Array.isArray(rows) || rows.length !== definitions.length || new Set(rows.map((r) => r.componentId)).size !== definitions.length) throw new Error("본체를 포함한 모든 구성품의 수량과 상태를 확인해주세요.");
  for (const definition of definitions) {
    const row = rows.find((entry) => entry.componentId === definition.componentId);
    if (!row || !Number.isSafeInteger(row.quantity) || row.quantity < 0 || !["정상", "손상"].includes(row.condition) || row.confirmed !== true) throw new Error("모든 구성품의 실제 수량·상태와 확인 체크를 입력해주세요.");
  }
}

export function processItem(number, itemId, action, details = {}) {
  return mutateItem(number, itemId, details.expectedVersion, ({ record, item, records, states, who, equipmentStore }) => {
    actor("admin");
    const resource = resourceById(item.resourceId);
    const reason = String(details.reason ?? "").trim();
    if (item.kind === "장비" && Number.isInteger(details.expectedEquipmentVersion) && (states[resource.id]?.version ?? 0) !== details.expectedEquipmentVersion) throw new Error("다른 창에서 장비 점검 상태가 변경되었습니다. 최신 기준을 다시 확인해주세요.");
    if (action === "approve") {
      if (item.status !== "승인 대기") throw new Error("승인 대기 상태만 승인할 수 있습니다.");
      const errors = checkAvailability(resource, item.condition, reservations(records, { number, itemId }), restrictions(records, states));
      if (errors.length) throw new Error(errors.join(" "));
      item.status = item.kind === "장비" ? "승인·수령 대기" : "예약 승인";
    } else if (action === "reject") {
      if (item.status !== "승인 대기") throw new Error("승인 대기 상태만 거절할 수 있습니다.");
      if (!reason) throw new Error("거절 사유를 입력해주세요.");
      item.status = "거절";
      item.reason = reason;
    } else if (action === "start" || action === "finish") {
      if (item.kind !== "시설" || item.status !== (action === "start" ? "예약 승인" : "이용 중")) throw new Error("현재 시설 상태에서는 해당 처리를 할 수 없습니다.");
      item.status = action === "start" ? "이용 중" : "이용 완료";
      item[action === "start" ? "startedAt" : "endedAt"] = new Date().toISOString();
    } else if (action === "checkout") {
      if (item.kind !== "장비" || item.status !== "승인·수령 대기" || item.checkoutComponents) throw new Error("승인·수령 대기 장비만 실제 출고할 수 있습니다.");
      if (!resource.rentable || resource.status !== "정상" || restrictions(records, states)[resource.id]) throw new Error("장비 점검 또는 반환 보류 상태를 먼저 확인해주세요.");
      if (hasOutstandingEquipment(records, resource.id, item.id)) throw new Error("이전 대여의 실제 반환 확인이 완료되지 않아 출고할 수 없습니다.");
      const definitions = resource.components ?? [];
      if (!definitions.length) throw new Error("출고 구성품 기준을 찾을 수 없습니다.");
      inspectionRows(details.components, definitions);
      item.checkoutComponents = definitions.map((definition) => {
        const row = details.components.find((entry) => entry.componentId === definition.componentId);
        if ((definition.required && row.quantity !== definition.requiredQuantity) || row.condition !== "정상") throw new Error("필수 구성품의 정해진 수량과 정상 상태를 모두 확인해야 출고할 수 있습니다.");
        return { ...clone(definition), quantity: row.quantity, condition: row.condition, confirmed: true, note: String(row.note ?? "").trim() };
      });
      item.checkoutAt = new Date().toISOString();
      item.checkoutBy = who;
      item.status = "대여 중";
    } else if (["return", "hold", "return-extra"].includes(action)) {
      if (item.kind !== "장비" || !["반납 신청", "반납 보류"].includes(item.status)) throw new Error("반납 신청 또는 반납 보류 장비만 반환을 확인할 수 있습니다.");
      if (action === "return-extra" && item.status !== "반납 보류") throw new Error("추가 반환은 같은 반납 보류 건에서만 확인할 수 있습니다.");
      const definitions = item.checkoutComponents;
      if (!definitions?.length) throw new Error("보존된 출고 기준이 없습니다. 기준 없이 반환 완료로 처리할 수 없습니다.");
      const returned = { ...item.returnedComponents };
      const damaged = { ...item.damagedComponents };
      let components = details.components;
      if (action === "return-extra") {
        if (!Array.isArray(components) || new Set(components.map((row) => row.componentId)).size !== components.length || components.some((row) => !definitions.some((definition) => definition.componentId === row.componentId))) throw new Error("추가 반환 구성품을 다시 확인해주세요.");
        components = definitions.map((definition) => {
          const row = details.components.find((entry) => entry.componentId === definition.componentId);
          if (row) return row;
          if ((returned[definition.componentId] ?? 0) < definition.quantity) throw new Error(`${definition.name}: 이번 반환 수량을 확인해주세요.`);
          return { componentId: definition.componentId, quantity: 0, condition: damaged[definition.componentId] ? "손상" : "정상", confirmed: true, note: "" };
        });
      }
      inspectionRows(components, definitions);
      let added = 0;
      const rows = definitions.map((definition) => {
        const row = components.find((entry) => entry.componentId === definition.componentId);
        const cumulativeQuantity = (returned[row.componentId] ?? 0) + row.quantity;
        if (cumulativeQuantity > definition.quantity) throw new Error(`${definition.name}: 누적 반환 수량은 출고 수량을 초과할 수 없습니다.`);
        if (row.condition === "손상" && row.quantity > 0 && !String(row.note ?? "").trim()) throw new Error("손상 구성품의 확인 내용을 입력해주세요.");
        returned[row.componentId] = cumulativeQuantity;
        if (row.condition === "손상" && row.quantity > 0) damaged[row.componentId] = true;
        added += row.quantity;
        return { componentId: row.componentId, name: definition.name, quantity: row.quantity, cumulativeQuantity, missingQuantity: definition.quantity - cumulativeQuantity, condition: damaged[row.componentId] ? "손상" : "정상", confirmed: true, note: String(row.note ?? "").trim() };
      });
      if (!added) throw new Error("이번에 실제 반환한 구성품 수량을 입력해주세요.");
      const missing = rows.some((row) => row.missingQuantity > 0);
      const damage = Object.values(damaged).some(Boolean);
      if (missing && !reason) throw new Error("누락 구성품과 반납 보류 사유를 입력해주세요.");
      if (action === "hold" && !missing) throw new Error("필수 구성품이 모두 반환되었습니다. 반납 완료로 확인해주세요.");
      item.returnedComponents = returned;
      item.damagedComponents = damaged;
      item.status = missing ? "반납 보류" : "반납 완료";
      item.reason = missing ? reason : "";
      item.inspections.push({ round: item.inspections.length + 1, at: new Date().toISOString(), actor: who, reason, status: item.status, components: rows });
      if (missing || damage) setEquipment(states, equipmentStore, resource.id, "점검", reason || rows.filter((row) => row.note).map((row) => `${row.name}: ${row.note}`).join(" · ") || "손상 상태를 확인하고 점검 완료를 기록해주세요.", who, number);
    } else if (action === "maintenance-required") {
      if (item.kind !== "장비") throw new Error("장비에만 점검 필요 상태를 등록할 수 있습니다.");
      if (!reason || details.confirmed !== true) throw new Error("실제 점검 필요 확인과 사유를 입력해주세요.");
      setEquipment(states, equipmentStore, resource.id, "점검", reason, who, number);
    } else if (action === "maintenance-done") {
      if (item.kind !== "장비" || item.status !== "반납 완료" || states[resource.id]?.status !== "점검") throw new Error("반납 완료 후 점검 중인 장비만 점검 완료를 확인할 수 있습니다.");
      if (!reason || details.confirmed !== true) throw new Error("실제 점검 완료 확인과 메모를 입력해주세요.");
      if (!resource.rentable || resource.status !== "정상" || hasOutstandingEquipment(records, resource.id)) throw new Error("미반환·보류 또는 기본 운영 제한이 남아 있어 점검을 해제할 수 없습니다.");
      setEquipment(states, equipmentStore, resource.id, "정상", reason, who, number);
    } else throw new Error("지원하지 않는 처리입니다.");
    return { action, reason };
  });
}
