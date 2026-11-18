// 화면 공통 규칙입니다. 서버 모드의 자원·일정은 catalog API 응답으로 교체합니다.
export const serverMode = typeof document !== "undefined" && document.documentElement.dataset.backend === "server";
export const catalogState = { ready: !serverMode, error: "" };
export const catalogRestrictions = {};
export const purposeRules = [];
export function participantAnalysis(
  input,
) {
  const range =
    /[+-]?\d+(?:\.\d+)?\s*명?\s*(?:~|–|—|-|에서|부터)\s*[+-]?\d+(?:\.\d+)?\s*명/.test(
      input,
    )
  const values = [
    ...input.matchAll(/(?<![\d.])([+-]?\d+(?:\.\d+)?)\s*명(?![\d.])/g),
  ].map((match) => Number(match[1]))
  const valid = [
    ...new Set(
      values.filter(
        (value) =>
          Number.isSafeInteger(value) && Number.isInteger(value) && value > 0,
      ),
    ),
  ]
  const invalid = values.some(
    (value) =>
      !Number.isSafeInteger(value) || !Number.isInteger(value) || value <= 0,
  )
  if (range || valid.length > 1)
    return {
      peopleCandidates: valid,
      peopleStatus: "ambiguous",
    }
  if (invalid)
    return {
      peopleCandidates: valid,
      peopleStatus: "invalid",
    }
  if (valid.length === 1)
    return {
      people: valid[0],
      peopleCandidates: valid,
      peopleStatus: "valid",
    }
  return { peopleCandidates: [], peopleStatus: "none" }
}
const cameraComponents = [
  {
    componentId: "camera-body",
    name: "카메라 본체",
    requiredQuantity: 1,
    required: true,
    body: true,
  },
  {
    componentId: "camera-lens",
    name: "기본 렌즈",
    requiredQuantity: 1,
    required: true,
    body: false,
  },
  {
    componentId: "camera-battery",
    name: "배터리",
    requiredQuantity: 1,
    required: true,
    body: false,
  },
  {
    componentId: "camera-charger",
    name: "충전기",
    requiredQuantity: 1,
    required: true,
    body: false,
  },
]
const projectorComponents = [
  {
    componentId: "projector-body",
    name: "프로젝터 본체",
    requiredQuantity: 1,
    required: true,
    body: true,
  },
  {
    componentId: "projector-hdmi",
    name: "HDMI 케이블",
    requiredQuantity: 1,
    required: true,
    body: false,
  },
  {
    componentId: "projector-power",
    name: "전원 케이블",
    requiredQuantity: 1,
    required: true,
    body: false,
  },
  {
    componentId: "projector-remote",
    name: "리모컨",
    requiredQuantity: 1,
    required: true,
    body: false,
  },
]
const microphoneComponents = (
  quantity,
  adapter,
) => [
  {
    componentId: "microphone-body",
    name: "마이크",
    requiredQuantity: quantity,
    required: true,
    body: true,
  },
  {
    componentId: "microphone-receiver",
    name: "수신기",
    requiredQuantity: 1,
    required: true,
    body: false,
  },
  ...(adapter
    ? [
        {
          componentId: "microphone-adapter",
          name: "전원 어댑터",
          requiredQuantity: 1,
          required: true,
          body: false,
        },
      ]
    : []),
]
export const componentCatalog = {
  cam01: cameraComponents,
  cam02: cameraComponents,
  proj01: projectorComponents,
  proj02: projectorComponents,
  mic01: microphoneComponents(1, true),
  mic02: microphoneComponents(2, true),
  mic03: microphoneComponents(1, false),
}
export const componentSummary = (components) =>
  components
    .map((component) => `${component.name} ${component.requiredQuantity}개`)
    .join(" · ")
export const purposes = [
  "인터뷰 촬영",
  "발표 연습",
  "팀 회의",
  "과제 영상 촬영",
]
export function localDate(date) {
  const adjusted = new Date(date.getTime() - date.getTimezoneOffset() * 60000)
  return adjusted.toISOString().slice(0, 10)
}
export const demoDay = localDate(new Date(Date.now() + 86400000))
export const initialConditions = {
  start: `${demoDay}T14:00`,
  end: `${demoDay}T16:00`,
  people: 3,
  use: "",
}
const equipment = (
  id,
  name,
  category,
  model,
  specs,
  alternatives,
) => ({
  id,
  name,
  category,
  model,
  specs,
  contents: (componentCatalog[id] ?? []).map(
    (component) => `${component.name} ${component.requiredQuantity}개`,
  ),
  components: componentCatalog[id],
  alternatives,
  kind: "장비",
  code: `DEMO-${id.toUpperCase()}`,
  location: "시연 자산 보관실",
  icon:
    category === "카메라"
      ? "ff97a.svg"
      : category === "마이크"
        ? "054e2.svg"
        : "1eae3.svg",
  rentable: true,
  status: "정상",
})
const facility = (
  id,
  name,
  category,
  capacity,
  allowedUses,
  contents,
  location,
) => ({
  id,
  name,
  category,
  capacity,
  allowedUses,
  contents,
  location,
  kind: "시설",
  code: `DEMO-${id.toUpperCase()}`,
  model: "가상 시설",
  specs: [`수용 ${capacity}명`, "공간 전체 예약"],
  operatingHours: ["09:00", "20:00"],
  alternatives: [],
  icon: "b46a5.svg",
  rentable: true,
  status: "정상",
})
export const resources = [
  equipment(
    "cam01",
    "이동형 디지털카메라 고정 세트 A",
    "카메라",
    "DEMO-CAM100",
    ["영상 4K / 30fps", "기본 렌즈 24–70mm"],
    ["cam02"],
  ),
  equipment(
    "cam02",
    "이동형 디지털카메라 고정 세트 B",
    "카메라",
    "DEMO-CAM200",
    ["영상 1080p / 60fps", "기본 렌즈 18–55mm"],
    [],
  ),
  equipment(
    "proj01",
    "이동형 빔프로젝터 고정 세트 A",
    "프로젝터",
    "DEMO-PJ100",
    ["해상도 1920×1080", "입력 HDMI"],
    ["proj02"],
  ),
  equipment(
    "proj02",
    "이동형 빔프로젝터 고정 세트 B",
    "프로젝터",
    "DEMO-PJ200",
    ["해상도 1280×800", "입력 HDMI"],
    [],
  ),
  equipment(
    "mic01",
    "무선 마이크 고정 세트 A",
    "마이크",
    "DEMO-MIC100",
    ["녹음 1채널", "출력 3.5mm"],
    ["mic02", "mic03"],
  ),
  equipment(
    "mic02",
    "무선 마이크 고정 세트 B",
    "마이크",
    "DEMO-MIC200",
    ["녹음 2채널", "출력 3.5mm"],
    [],
  ),
  {
    ...equipment(
      "mic03",
      "무선 마이크 고정 세트 C",
      "마이크",
      "DEMO-MIC300",
      ["사양 확인 필요"],
      [],
    ),
    status: "점검",
  },
  facility(
    "room01",
    "시연 회의실 A",
    "회의실",
    4,
    ["팀 회의", "발표 연습"],
    ["테이블", "의자 4개", "화이트보드"],
    "가상 캠퍼스 · A동 201호",
  ),
  facility(
    "room02",
    "시연 회의실 B",
    "회의실",
    8,
    ["팀 회의", "발표 연습"],
    ["테이블", "의자 8개", "고정 전자칠판"],
    "가상 캠퍼스 · A동 202호",
  ),
  facility(
    "study01",
    "시연 스터디룸 B",
    "스터디룸",
    6,
    ["팀 회의", "발표 연습"],
    ["테이블", "의자 6개", "고정 PC"],
    "가상 캠퍼스 · B동 101호",
  ),
  facility(
    "studio01",
    "시연 촬영실 A",
    "촬영실",
    4,
    ["인터뷰 촬영", "과제 영상 촬영"],
    ["테이블", "의자 4개", "고정 조명"],
    "가상 캠퍼스 · C동 101호",
  ),
  facility(
    "studio02",
    "시연 촬영실 B",
    "촬영실",
    6,
    ["인터뷰 촬영", "과제 영상 촬영"],
    ["테이블", "의자 6개", "고정 조명", "방음 설비"],
    "가상 캠퍼스 · C동 102호",
  ),
]
export const bookings = [
  {
    resourceId: "mic01",
    start: `${demoDay}T13:00`,
    end: `${demoDay}T17:00`,
    approved: true,
    reason: "승인된 대여와 겹칩니다.",
  },
  {
    resourceId: "studio01",
    start: `${demoDay}T14:00`,
    end: `${demoDay}T16:00`,
    approved: true,
    reason: "승인된 시설 예약과 겹칩니다.",
  },
  {
    resourceId: "cam01",
    start: `${demoDay}T10:00`,
    end: `${demoDay}T12:00`,
    approved: true,
    reason: "승인된 대여와 겹칩니다.",
  },
  {
    resourceId: "room01",
    start: `${demoDay}T10:00`,
    end: `${demoDay}T12:00`,
    approved: true,
    reason: "시설 점검 시간입니다.",
  },
  {
    resourceId: "mic02",
    start: `${demoDay}T14:00`,
    end: `${demoDay}T16:00`,
    approved: false,
    reason: "승인 대기",
  },
]
export function conditionErrors(condition, facilities = false) {
  const errors = []
  const start = new Date(condition.start).getTime()
  const end = new Date(condition.end).getTime()
  if (!Number.isFinite(start) || !Number.isFinite(end))
    errors.push("시작·종료 날짜와 시간을 입력해주세요.")
  else {
    if (start <= Date.now())
      errors.push("시작 시간은 현재보다 이후여야 합니다.")
    if (end <= start) errors.push("종료 시간은 시작 시간보다 늦어야 합니다.")
  }
  if (
    facilities &&
    (!Number.isInteger(condition.people) || condition.people < 1)
  )
    errors.push("이용 인원은 1명 이상의 정수로 입력해주세요.")
  return errors
}
export function availability(
  resource,
  condition,
  reservations = [],
  restrictions = {},
) {
  if (serverMode && !catalogState.ready)
    return [catalogState.error || "최신 자원 정보를 확인하지 못했습니다. 다시 불러온 뒤 이용 가능 여부를 확인해주세요."]
  if (!condition)
    return [
      ...(restrictions[resource.id]
        ? [restrictions[resource.id]]
        : []),
      "이용 기간 선택 후 확인할 수 있습니다.",
    ]
  const errors = conditionErrors(condition, resource.kind === "시설")
  if (restrictions[resource.id])
    errors.push(restrictions[resource.id])
  if (!resource.rentable) errors.push("대여가 허용되지 않은 자산입니다.")
  if (resource.status !== "정상")
    errors.push(
      `${resource.status} 중입니다. 이용 재개 시점은 확인이 필요합니다.`,
    )
  if (resource.kind === "시설") {
    if (condition.people > (resource.capacity ?? 0))
      errors.push(
        `수용 ${resource.capacity}명보다 이용 인원 ${condition.people}명이 많습니다.`,
      )
    if (!condition.use) errors.push("시설의 실제 이용 목적을 선택해주세요.")
    else if (!resource.allowedUses?.includes(condition.use))
      errors.push(
        `허용 용도와 맞지 않습니다. 허용: ${resource.allowedUses?.join(" · ")}`,
      )
    const startTime = condition.start.slice(11, 16)
    const endTime = condition.end.slice(11, 16)
    const weekday = new Date(`${condition.start.slice(0, 10)}T12:00:00Z`).getUTCDay() || 7
    const hours = resource.hoursByWeekday
      ? resource.hoursByWeekday[String(weekday)]
      : serverMode ? null : resource.operatingHours
    if (!validFacilityHours(hours))
      errors.push("선택한 요일의 운영 시간이 설정되지 않아 신청할 수 없습니다.")
    else if (
      condition.start.slice(0, 10) !== condition.end.slice(0, 10) ||
      startTime < hours[0] ||
      endTime > hours[1]
    )
      errors.push(
        `운영 시간 ${hours.join("–")} 안에서 같은 날짜로 선택해주세요.`,
      )
  }
  for (const booking of bookings)
    if (
      booking.approved &&
      booking.resourceId === resource.id &&
      new Date(condition.start) < new Date(booking.end) &&
      new Date(condition.end) > new Date(booking.start)
    )
      errors.push(booking.reason || "승인된 신청 또는 운영 제한 시간과 겹칩니다.")
  if (
    reservations.some(
      (booking) =>
        booking.resourceId === resource.id &&
        new Date(condition.start) < new Date(booking.end) &&
        new Date(condition.end) > new Date(booking.start),
    )
  )
    errors.push("관리자가 승인한 신청과 이용 기간이 겹칩니다.")
  return errors
}
export function analyzeInput(input) {
  input = String(input || "")
  const participants = participantAnalysis(input)
  const normalized = normalizeActivity(input)
  const equipmentQuery = ["카메라", "프로젝터", "마이크"].find((word) =>
    normalized.includes(word),
  )
  const facilityQuery = ["회의실", "스터디룸", "촬영실"].find((word) =>
    normalized.includes(word),
  )
  const excludesRecording =
    /촬영없이|영상없이|카메라없이|촬영은안|촬영안하고|녹화없이|카메라제외|촬영제외/.test(normalized)
  const excludesAudio = /마이크없이|녹음없이|음향없이|마이크제외/.test(normalized)
  const excludesPresentation = /프로젝터없이|빔없이|화면없이|프로젝터제외/.test(normalized)
  const meetingResourceOnly =
    Boolean(facilityQuery === "회의실") &&
    !/학생회회의|동아리회의|조별회의|팀회의|회의하|회의준비|회의만|회의하면서|회의를|회의할/.test(
      normalized,
    )
  const meeting = !meetingResourceOnly && /회의/.test(normalized)
  const presentation = /발표|프레젠테이션|ppt/.test(normalized)
  const interview = /인터뷰/.test(normalized)
  const videoEvidence = /영상|촬영|찍|녹화/.test(normalized)
  const assignmentVideo =
    /과제/.test(normalized) && videoEvidence && !excludesRecording
  const localCandidates = []
  if (interview) localCandidates.push("인터뷰 촬영")
  if (assignmentVideo) localCandidates.push("과제 영상 촬영")
  if (meeting) localCandidates.push("팀 회의")
  else if (presentation) localCandidates.push("발표 연습")
  const jobInterview = /면접/.test(normalized)
  const study = /스터디(?!룸)|공부|학습|독서|시험준비/.test(normalized)
  const seminar = /세미나|워크숍|워크샵|행사|강연|토론회|설명회|특강/.test(normalized)
  if (jobInterview) localCandidates.push("면접 준비")
  if (study) localCandidates.push("스터디")
  if (seminar) localCandidates.push("세미나·행사")
  const matched = [], excludedPurposes = new Set()
  if (serverMode) for (const rule of purposeRules) {
    const matching = rule.keywords.filter(keyword => keywordMatches(normalized, keyword))
    if (matching.some(keyword => keyword.effect === "EXCLUDE")) { excludedPurposes.add(rule.name); continue; }
    const included = matching.filter(keyword => keyword.effect === "INCLUDE")
    if (included.length || normalized === normalizeActivity(rule.name)) matched.push({name: rule.name,
      priority: included.length ? Math.max(...included.map(keyword => keyword.priority)) : 0})
  }
  matched.sort((a, b) => b.priority - a.priority)
  const candidates = [...new Set([...matched.map(rule => rule.name), ...localCandidates])].filter(name => !excludedPurposes.has(name))
  const generalVideo =
    videoEvidence &&
    !excludesRecording &&
    !interview &&
    !assignmentVideo &&
    !presentation && !jobInterview && !study && !seminar &&
    !(facilityQuery && normalized.replace(/\d+명/g, "") === normalizeActivity(facilityQuery))
  const intent =
    candidates.length > 1
      ? "multiple"
      : candidates.length === 1
        ? "recognized"
        : generalVideo
          ? "video"
          : equipmentQuery || facilityQuery
            ? "direct"
            : "unknown"
  const activityLabel = jobInterview ? "면접 준비" : study ? "스터디" : seminar ? "세미나·행사" : candidates.length === 1 ? candidates[0] : "기타 활동"
  const excludedEquipment = [...(excludesRecording ? ["카메라"] : []), ...(excludesAudio ? ["마이크"] : []), ...(excludesPresentation ? ["프로젝터"] : [])]
  const proposedNeeds = {
    space: Boolean(interview || assignmentVideo || meeting || presentation || jobInterview || study || seminar || facilityQuery || /공간|장소|시설|실내|방음|조용한/.test(normalized)),
    video: !excludesRecording && Boolean(interview || videoEvidence || equipmentQuery === "카메라"),
    audio: !excludesAudio && Boolean(interview || seminar || /녹음|음성|음향|마이크/.test(normalized)),
    presentation: !excludesPresentation && Boolean(presentation || seminar || equipmentQuery === "프로젝터" || /화면공유|자료투사/.test(normalized)),
  }
  for (const match of matched) for (const rule of purposeRules.find(rule => rule.name === match.name)?.equipment || []) {
    const need = equipmentNeed(rule.typeName)
    if (need && !excludedEquipment.includes(rule.typeName) && !(need === "video" && excludesRecording) && !(need === "audio" && excludesAudio) && !(need === "presentation" && excludesPresentation)) proposedNeeds[need] = true
  }
  return {
    candidates,
    equipmentQuery,
    facilityQuery,
    ...participants,
    normalized,
    intent,
    activityLabel,
    customActivity: !legacyPurposes.includes(activityLabel),
    proposedNeeds,
    matchedPurposes: matched.map(rule => rule.name),
    ruleSource: matched.length ? "catalog" : "activity",
    excludedEquipment,
    needs: {
      presentation: !excludesPresentation && meeting && presentation,
      audio: proposedNeeds.audio,
      space: proposedNeeds.space,
      video: proposedNeeds.video,
      indoorSpace:
        facilityQuery === "촬영실" || /실내|조용한공간|방음/.test(normalized),
    },
    confirmations: generalVideo
      ? ["인터뷰 촬영", "과제 영상 촬영", "일반 영상 촬영"]
      : [],
  }
}

const legacyPurposes = ["인터뷰 촬영", "과제 영상 촬영", "발표 연습", "팀 회의"]
function normalizeActivity(value) {
  return String(value || "").toLowerCase().replace(/[\s.,!?~…·'"“”‘’()[\]{}:;_-]+/g, "")
}
function keywordMatches(input, rule) {
  const keyword = normalizeActivity(rule.keyword)
  return keyword && (rule.matchMode === "EXACT" ? input === keyword : input.includes(keyword))
}
function equipmentNeed(typeName) {
  if (/카메라|캠코더/.test(typeName)) return "video"
  if (/마이크|녹음|음향|스피커/.test(typeName)) return "audio"
  if (/프로젝터|디스플레이|모니터/.test(typeName)) return "presentation"
  return ""
}
export function purposeSubmitTarget(
  analysis,
) {
  if (analysis.intent !== "direct") return "recommendation"
  if (analysis.equipmentQuery) return "equipment"
  if (analysis.facilityQuery) return "facility"
  return "recommendation"
}
export function purposeSubmissionPeople(
  activity,
  analysis,
  draftPeople,
  source,
) {
  const sameSuggestedActivity =
    source.activity === activity && source.suggested === analysis.people
  return analysis.people && (!sameSuggestedActivity || !source.manuallyEdited)
    ? sameSuggestedActivity
      ? draftPeople
      : analysis.people
    : draftPeople
}
export function effectiveRecommendationPeople(
  analysis,
  facilityCondition,
  facilityPeople,
) {
  return facilityCondition &&
    Number.isSafeInteger(facilityCondition.people) &&
    facilityCondition.people > 0
    ? facilityCondition.people
    : Number.isSafeInteger(facilityPeople) && (facilityPeople ?? 0) > 0
      ? facilityPeople
      : analysis.people
}
export const recommendations = {
  "인터뷰 촬영": {
    ids: ["cam01", "mic01", "studio01"],
    reason: "영상·음성 기록과 조용한 공간을 함께 준비하는 구성입니다.",
    roles: {
      cam01: "기본 · 인터뷰 장면 기록",
      mic01: "기본 · 참여자 음성 녹음",
      studio01: "선택 · 조용한 촬영 공간",
    },
    optional: ["studio01"],
  },
  "과제 영상 촬영": {
    ids: ["cam01", "mic01", "studio01"],
    reason:
      "카메라 중심 구성입니다. 음성과 실내 촬영 공간은 과제에 따라 선택하세요.",
    roles: {
      cam01: "기본 · 과제 영상 촬영",
      mic01: "선택 · 대사·음성 녹음",
      studio01: "선택 · 실내 촬영 공간",
    },
    optional: ["mic01", "studio01"],
  },
  "발표 연습": {
    ids: ["room01", "proj01"],
    reason:
      "발표할 공간을 먼저 선택하고, 비치 화면이 없다면 프로젝터를 추가하세요.",
    roles: { room01: "기본 · 발표 연습 공간", proj01: "선택 · 발표 자료 투사" },
    optional: ["proj01"],
  },
  "팀 회의": {
    ids: ["room01", "study01", "room02"],
    reason:
      "참여 인원에 맞는 공간 후보입니다. 공간 한 곳을 선택하고 비치 설비를 확인하세요.",
    roles: {
      room01: "공간 후보 · 4명 회의",
      study01: "공간 후보 · 6명 팀 활동",
      room02: "공간 후보 · 8명 회의",
    },
    optional: [],
  },
  "면접 준비": {ids: [], roles: {}, optional: [], reason: "면접을 연습할 공간을 비교하세요. 녹화·녹음이 필요하면 해당 요구를 선택하고, 시설의 실제 이용 목적은 따로 확인하세요."},
  "스터디": {ids: [], roles: {}, optional: [], reason: "공부할 인원과 공간을 비교하세요. 발표 자료나 기록 장비는 실제 필요한 항목만 추가하세요."},
  "세미나·행사": {ids: [], roles: {}, optional: [], reason: "인원에 맞는 공간과 자료 공유·음성 전달 장비를 비교하세요. 시설의 허용 목적과 비치 설비는 별도로 확인하세요."},
  "기타 활동": {ids: [], roles: {}, optional: [], reason: "선택한 공간·영상·음성·자료 공유 요구를 기준으로 자원을 비교하세요. 시설 예약에는 실제 허용 목적의 선택이 필요합니다."},
}

export function recommendationDefinition(purpose, analysis = {}, options) {
  const rule = serverMode ? purposeRules.find(rule => rule.name === purpose) : null
  const explicitNeeds = options && Object.hasOwn(options, "needs")
  return {title: purpose || analysis.activityLabel || "기타 활동",
    reason: explicitNeeds ? "선택한 공간·영상·음성·자료 공유 요구를 기준으로 비교한 후보입니다. 시설 이용 목적과 신청 가능 여부는 별도로 확인하세요."
      : rule?.equipment.length ? "등록된 목적별 장비 규칙을 기준으로 비교한 후보입니다. 시설의 허용 목적과 이용 조건도 확인하세요."
      : recommendations[purpose]?.reason || recommendations[analysis.activityLabel]?.reason || recommendations["기타 활동"].reason}
}

export function recommendationItems(
  purpose,
  analysis,
  facilityCondition,
  equipmentCondition,
  reservations = [],
  restrictions = {},
  facilityPeople,
  options,
) {
  analysis = analysis || analyzeInput("")
  const recommendation = recommendations[purpose] || { ids: [], roles: {}, optional: [] }
  const explicitNeeds = Boolean(options && Object.hasOwn(options, "needs"))
  const needs = Object.fromEntries(["space", "video", "audio", "presentation"].map(key => [key, explicitNeeds ? options.needs?.[key] === true : analysis.proposedNeeds?.[key] === true]))
  const requestedUse = options && Object.hasOwn(options, "facilityUse") ? options.facilityUse
    : facilityCondition?.use || (legacyPurposes.includes(purpose) ? purpose : "")
  const facilityUse = typeof requestedUse === "string" && purposes.includes(requestedUse) ? requestedUse : ""
  const facilityDraft = facilityUse && facilityCondition ? {...facilityCondition, use: facilityUse, purpose: facilityUse} : null
  const facilityApplied = facilityDraft && !conditionErrors(facilityDraft, true).length ? facilityDraft : null
  const spaceNeeded = explicitNeeds ? needs.space : Boolean(needs.space || facilityUse)
  const people = effectiveRecommendationPeople(
    analysis,
    facilityCondition,
    facilityPeople,
  )
  const facilityCandidates = resources
    .filter(
      (resource) =>
        spaceNeeded && resource.kind === "시설" &&
        (!facilityUse || resource.allowedUses?.includes(facilityUse)) &&
        (!analysis.facilityQuery ||
          resource.category === analysis.facilityQuery) &&
        (!people || (resource.capacity ?? 0) >= people),
    )
    .sort((a, b) => (a.capacity ?? 0) - (b.capacity ?? 0))
    .map((resource) => ({
      resource,
      role: `공간 후보 · 수용 ${resource.capacity}명 · ${
        facilityUse ? `허용 목적: ${facilityUse}` : "실제 이용 목적 선택 필요"
      }`,
      optional: purpose === "인터뷰 촬영" || purpose === "과제 영상 촬영",
      condition: facilityApplied,
      conditionRequired: !facilityApplied,
      source: explicitNeeds ? "user-needs" : "activity",
    }))

  const categories = []
  const registered = serverMode ? purposeRules.find(rule => rule.name === purpose)?.equipment || [] : []
  const addCategory = (category, optional, role, source) => {
    if (!categories.some(item => item.category === category)) categories.push({category, optional, role, source})
  }
  if (explicitNeeds) {
    const names = {video: "카메라", audio: "마이크", presentation: "프로젝터"}
    const roles = {video: "영상 기록", audio: "음성 기록·전달", presentation: "발표 자료 공유"}
    for (const need of ["video", "audio", "presentation"]) if (needs[need]) {
      const rules = registered.filter(rule => equipmentNeed(rule.typeName) === need)
      if (rules.length) for (const rule of rules) addCategory(rule.typeName, rule.needLevel === "OPTIONAL", `요청 · ${rule.reason || roles[need]}`, "user-needs")
      else addCategory(names[need], false, `요청 · ${roles[need]}`, "user-needs")
    }
  } else if (serverMode) {
    for (const rule of registered) addCategory(rule.typeName, rule.needLevel === "OPTIONAL", `${rule.needLevel === "OPTIONAL" ? "선택" : "필요"} · ${rule.reason || "등록된 목적별 장비"}`, "catalog-rule")
  } else if (purpose === "인터뷰 촬영") {
    categories.push(
      { category: "카메라", optional: false, role: "필요 · 인터뷰 장면 기록" },
      { category: "마이크", optional: false, role: "필요 · 참여자 음성 녹음" },
    )
  } else if (purpose === "과제 영상 촬영") {
    categories.push(
      { category: "카메라", optional: false, role: "필요 · 과제 영상 촬영" },
      { category: "마이크", optional: true, role: "선택 · 대사·음성 녹음" },
    )
  } else if (purpose === "발표 연습" || analysis.needs?.presentation) {
    categories.push({
      category: "프로젝터",
      optional: true,
      role: "선택 · 발표 자료 투사",
    })
  }
  if (!explicitNeeds && !serverMode && !legacyPurposes.includes(purpose)) {
    if (needs.video) addCategory("카메라", false, "필요 · 활동 영상 기록", "activity")
    if (needs.audio) addCategory("마이크", true, "선택 · 음성 기록·전달", "activity")
    if (needs.presentation) addCategory("프로젝터", true, "선택 · 자료 공유", "activity")
  }
  if (
    !explicitNeeds &&
    analysis.equipmentQuery &&
    !(analysis.excludedEquipment || []).includes(analysis.equipmentQuery) &&
    !categories.some(({ category }) => category === analysis.equipmentQuery)
  )
    categories.push({
      category: analysis.equipmentQuery,
      optional: true,
      role: "선택 · 입력한 활동 설명에 포함된 장비",
    })

  const equipmentItems = categories.filter(({category}) => explicitNeeds || !(analysis.excludedEquipment || []).some(excluded => category === excluded || equipmentNeed(category) && equipmentNeed(category) === equipmentNeed(excluded))).flatMap(({ category, optional, role, source }) => {
    const candidates = resources.filter(
      (resource) => resource.kind === "장비" && resource.category === category,
    )
    const resource =
      candidates.find(
        (candidate) =>
          availability(
            candidate,
            equipmentCondition,
            reservations,
            restrictions,
          ).length === 0,
      ) ??
      candidates.find(
        (candidate) =>
          candidate.status === "정상" && !restrictions[candidate.id],
      ) ??
      candidates[0]
    return resource ? [{ resource, role, optional, condition: equipmentCondition || null, conditionRequired: !equipmentCondition, source: source || "demo-rule" }] : []
  })
  const preferredIds = new Set(recommendation.ids)
  return [...facilityCandidates, ...equipmentItems].sort((a, b) => {
    if (a.resource.kind !== b.resource.kind)
      return a.resource.kind === "시설" ? -1 : 1
    return (
      Number(preferredIds.has(b.resource.id)) -
      Number(preferredIds.has(a.resource.id))
    )
  })
}
export function alternateResources(
  resource,
  condition,
  reservations = [],
  restrictions = {},
) {
  return resources.filter(
    (candidate) =>
      candidate.id !== resource.id &&
      (resource.kind === "장비"
        ? resource.alternatives.includes(candidate.id)
        : candidate.kind === "시설") &&
      availability(candidate, condition, reservations, restrictions).length ===
        0,
  )
}
export function alternateSlots(
  resource,
  condition,
  from,
  until,
  reservations = [],
  restrictions = {},
) {
  const duration =
    new Date(condition.end).getTime() - new Date(condition.start).getTime()
  if (
    duration <= 0 ||
    !Number.isFinite(duration) ||
    !from ||
    !until ||
    from > until
  )
    return []
  const result = []
  let cursor = new Date(`${from}T00:00`)
  const limit = new Date(`${until}T23:59`).getTime()
  for (
    let steps = 0;
    cursor.getTime() <= limit && steps < 31 * 24 * 2;
    steps++, cursor = new Date(cursor.getTime() + 1800000)
  ) {
    const end = new Date(cursor.getTime() + duration)
    const serialize = (date) =>
      `${localDate(date)}T${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`
    const candidate = {
      ...condition,
      start: serialize(cursor),
      end: serialize(end),
    }
    if (
      end.getTime() <= limit &&
      availability(resource, candidate, reservations, restrictions).length === 0
    )
      result.push(candidate)
    if (result.length === 8) break
  }
  return result
}

export function markCatalogUnavailable(message = "최신 자원 정보를 불러오지 못했습니다.") {
  catalogState.ready = false;
  catalogState.error = message;
}

function validFacilityHours(value, allowEmpty = false) {
  return Array.isArray(value) && ((allowEmpty && value.length === 0) ||
    (value.length === 2 && value.every(time => typeof time === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(time)) && value[0] < value[1]));
}

function validFacilityWeekdays(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value) &&
    Object.entries(value).every(([day, hours]) => /^[1-7]$/.test(day) && validFacilityHours(hours));
}

export function replaceCatalog(payload) {
  if (!payload || !Array.isArray(payload.resources) || !Array.isArray(payload.purposes) || !Array.isArray(payload.reservations))
    throw new Error("서버의 자원 목록 응답을 확인할 수 없습니다.");
  const ids = new Set();
  const nextResources = payload.resources.map(resource => {
    if (!resource || typeof resource.id !== "string" || !resource.id || ids.has(resource.id) || !["장비", "시설"].includes(resource.kind) || typeof resource.name !== "string" || typeof resource.rentable !== "boolean" || !["정상", "점검", "중지"].includes(resource.status))
      throw new Error("서버의 자원 정보가 올바르지 않습니다. 관리자에게 확인해주세요.");
    ids.add(resource.id);
    if (resource.kind === "시설" && (!Number.isSafeInteger(resource.capacity) || resource.capacity < 1 || !validFacilityHours(resource.operatingHours, true) ||
      (Object.hasOwn(resource, "hoursByWeekday") && !validFacilityWeekdays(resource.hoursByWeekday))))
      throw new Error("시설의 인원·운영 시간 정보를 확인할 수 없습니다.");
    const stringList = value => Array.isArray(value) ? value.filter(item => typeof item === "string") : [];
    const fallbackIcon = resource.kind === "시설" ? "8f64d.svg" : resource.category === "마이크" ? "054e2.svg" : resource.category === "프로젝터" ? "1eae3.svg" : "ff97a.svg";
    return {
      ...resource,
      category: String(resource.category || resource.kind), code: String(resource.code || resource.id),
      model: String(resource.model || ""), location: String(resource.location || ""),
      specs: stringList(resource.specs), contents: stringList(resource.contents), alternatives: stringList(resource.alternatives),
      allowedUses: stringList(resource.allowedUses),
      ...(Array.isArray(resource.components) ? { components: resource.components.map(component => ({ ...component })) } : {}),
      icon: typeof resource.icon === "string" && /^[a-z0-9_.-]+\.(svg|png|webp|jpg|jpeg)$/i.test(resource.icon) ? resource.icon : fallbackIcon,
    };
  });
  const nextPurposes = [...new Set(payload.purposes.filter(purpose => typeof purpose === "string" && purpose.trim()).map(purpose => purpose.trim()))];
  const nextPurposeRules = parsePurposeRules(payload.purposeRules, nextPurposes);
  const nextBookings = payload.reservations.map(booking => {
    if (!booking || typeof booking.resourceId !== "string" || typeof booking.start !== "string" || typeof booking.end !== "string" || !Number.isFinite(new Date(booking.start).getTime()) || new Date(booking.end) <= new Date(booking.start))
      throw new Error("이용 제한 일정 응답을 확인할 수 없습니다.");
    return { resourceId: booking.resourceId, start: booking.start, end: booking.end, approved: true, reason: String(booking.reason || "승인된 신청 또는 운영 제한 시간과 겹칩니다.") };
  });
  const nextRestrictions = {};
  if (payload.restrictions && (typeof payload.restrictions !== "object" || Array.isArray(payload.restrictions)))
    throw new Error("자원 운영 상태 응답을 확인할 수 없습니다.");
  for (const [id, reason] of Object.entries(payload.restrictions || {})) if (typeof reason === "string" && reason) nextRestrictions[id] = reason;
  resources.splice(0, resources.length, ...nextResources);
  purposes.splice(0, purposes.length, ...nextPurposes);
  purposeRules.splice(0, purposeRules.length, ...nextPurposeRules);
  bookings.splice(0, bookings.length, ...nextBookings);
  for (const id of Object.keys(catalogRestrictions)) delete catalogRestrictions[id];
  Object.assign(catalogRestrictions, nextRestrictions);
  catalogState.ready = true;
  catalogState.error = "";
}

function parsePurposeRules(value, names) {
  if (value === undefined) return [];
  const invalid = () => { throw new Error("목적별 추천 규칙 응답을 확인할 수 없습니다."); };
  if (!Array.isArray(value)) return invalid();
  const ids = new Set(), usedNames = new Set();
  return value.map(rule => {
    if (!rule || typeof rule.purposeId !== "string" || !rule.purposeId || ids.has(rule.purposeId) ||
      typeof rule.name !== "string" || !names.includes(rule.name) || usedNames.has(rule.name) ||
      !Array.isArray(rule.keywords) || !Array.isArray(rule.equipment)) return invalid();
    ids.add(rule.purposeId); usedNames.add(rule.name);
    const keywords = rule.keywords.map(entry => {
      if (!entry || typeof entry.keyword !== "string" || !entry.keyword.trim() ||
        !["CONTAINS", "EXACT"].includes(entry.matchMode) || !["INCLUDE", "EXCLUDE"].includes(entry.effect) ||
        !Number.isSafeInteger(entry.priority) || entry.priority < 0) return invalid();
      return {keyword: entry.keyword, matchMode: entry.matchMode, effect: entry.effect, priority: entry.priority};
    });
    const equipment = rule.equipment.map(entry => {
      if (!entry || typeof entry.typeName !== "string" || !entry.typeName.trim() ||
        !["REQUIRED", "OPTIONAL"].includes(entry.needLevel) || typeof entry.reason !== "string") return invalid();
      return {typeName: entry.typeName, needLevel: entry.needLevel, reason: entry.reason};
    });
    return {purposeId: rule.purposeId, name: rule.name, keywords, equipment};
  });
}

if (serverMode) {
  resources.splice(0);
  purposes.splice(0);
  bookings.splice(0);
}
