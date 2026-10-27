// Figma Make 시연 데이터와 규칙을 원본에서 옮긴 ES module입니다.
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
  if (!condition)
    return [
      ...(resource.kind === "장비" && restrictions[resource.id]
        ? [restrictions[resource.id]]
        : []),
      "이용 기간 선택 후 확인할 수 있습니다.",
    ]
  const errors = conditionErrors(condition, resource.kind === "시설")
  if (resource.kind === "장비" && restrictions[resource.id])
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
    if (
      condition.start.slice(0, 10) !== condition.end.slice(0, 10) ||
      startTime < resource.operatingHours[0] ||
      endTime > resource.operatingHours[1]
    )
      errors.push(
        `운영 시간 ${resource.operatingHours?.join("–")} 안에서 같은 날짜로 선택해주세요.`,
      )
  }
  for (const booking of bookings)
    if (
      booking.approved &&
      booking.resourceId === resource.id &&
      new Date(condition.start) < new Date(booking.end) &&
      new Date(condition.end) > new Date(booking.start)
    )
      errors.push(booking.reason)
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
  const participants = participantAnalysis(input)
  const normalized = input
    .toLowerCase()
    .replace(/[\s.,!?~…·'"“”‘’()[\]{}:;_-]+/g, "")
  const equipmentQuery = ["카메라", "프로젝터", "마이크"].find((word) =>
    normalized.includes(word),
  )
  const facilityQuery = ["회의실", "스터디룸", "촬영실"].find((word) =>
    normalized.includes(word),
  )
  const excludesRecording =
    /촬영없이|영상없이|카메라없이|촬영은안|촬영안하고/.test(normalized)
  const meetingResourceOnly =
    Boolean(facilityQuery === "회의실") &&
    !/학생회회의|동아리회의|조별회의|팀회의|회의하|회의준비|회의만|회의하면서|회의를|회의할/.test(
      normalized,
    )
  const meeting = !meetingResourceOnly && /회의/.test(normalized)
  const presentation = /발표|프레젠테이션|ppt/.test(normalized)
  const interview = /인터뷰/.test(normalized)
  const videoEvidence = /영상|촬영|찍/.test(normalized)
  const assignmentVideo =
    /과제/.test(normalized) && videoEvidence && !excludesRecording
  const candidates = []
  if (interview) candidates.push("인터뷰 촬영")
  if (assignmentVideo) candidates.push("과제 영상 촬영")
  if (meeting) candidates.push("팀 회의")
  else if (presentation) candidates.push("발표 연습")
  const generalVideo =
    videoEvidence &&
    !excludesRecording &&
    !interview &&
    !assignmentVideo &&
    !presentation
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
  return {
    candidates,
    equipmentQuery,
    facilityQuery,
    ...participants,
    normalized,
    intent,
    excludedEquipment: excludesRecording ? ["카메라"] : [],
    needs: {
      presentation: meeting && presentation,
      audio: interview || equipmentQuery === "마이크",
      indoorSpace:
        facilityQuery === "촬영실" || /실내|조용한공간|방음/.test(normalized),
    },
    confirmations: generalVideo
      ? ["인터뷰 촬영", "과제 영상 촬영", "일반 영상 촬영"]
      : [],
  }
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
}
export function recommendationItems(
  purpose,
  analysis,
  facilityCondition,
  equipmentCondition,
  reservations = [],
  restrictions = {},
  facilityPeople,
) {
  const recommendation = recommendations[purpose]
  const people = effectiveRecommendationPeople(
    analysis,
    facilityCondition,
    facilityPeople,
  )
  const facilityCandidates = resources
    .filter(
      (resource) =>
        resource.kind === "시설" &&
        resource.allowedUses?.includes(purpose) &&
        (!analysis.facilityQuery ||
          resource.category === analysis.facilityQuery) &&
        (!people || (resource.capacity ?? 0) >= people),
    )
    .sort((a, b) => (a.capacity ?? 0) - (b.capacity ?? 0))
    .map((resource) => ({
      resource,
      role: `공간 후보 · 수용 ${resource.capacity}명 · ${
        purpose === "팀 회의" ? "회의 용도" : "활동 용도"
      }`,
      optional: purpose === "인터뷰 촬영" || purpose === "과제 영상 촬영",
    }))

  const categories = []
  if (purpose === "인터뷰 촬영") {
    categories.push(
      { category: "카메라", optional: false, role: "필요 · 인터뷰 장면 기록" },
      { category: "마이크", optional: false, role: "필요 · 참여자 음성 녹음" },
    )
  } else if (purpose === "과제 영상 촬영") {
    categories.push(
      { category: "카메라", optional: false, role: "필요 · 과제 영상 촬영" },
      { category: "마이크", optional: true, role: "선택 · 대사·음성 녹음" },
    )
  } else if (purpose === "발표 연습" || analysis.needs.presentation) {
    categories.push({
      category: "프로젝터",
      optional: true,
      role: "선택 · 발표 자료 투사",
    })
  }
  if (
    analysis.equipmentQuery &&
    !analysis.excludedEquipment.includes(analysis.equipmentQuery) &&
    !categories.some(({ category }) => category === analysis.equipmentQuery)
  )
    categories.push({
      category: analysis.equipmentQuery,
      optional: true,
      role: "선택 · 입력한 활동 설명에 포함된 장비",
    })

  const equipmentItems = categories.flatMap(({ category, optional, role }) => {
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
    return resource ? [{ resource, role, optional }] : []
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
