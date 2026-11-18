# 활동 문장 분석과 추천

활동 문장을 분석해 활동명·참여 인원·공간/영상/음성/자료 투사 필요를 제안한다. 사용자가 결과를 확인하고 적용한 뒤 기존 Oracle 자원 목록·시설 허용 목적·가용성 검사를 거친다. 분석 결과만으로 자원을 선택하거나 예약을 제출하지 않는다.

## 데이터와 적용 범위

- 입력은 활동 문장 한 필드, 최대 500자다. 계정·연락처·신청 이력·선택 목록·DB 접속 정보는 요청에 넣지 않는다.
- 결과는 활동명, 인원과 인원 해석 상태, 네 가지 준비 항목, 추가 확인 필요 여부만 받는다.
- AI가 시설의 실제 허용 목적·날짜·자원 ID·승인 상태를 지정할 수 없다. 출력의 추가 필드·잘못된 타입·범위·중복 JSON 등을 거부한다.
- 직접 수정한 인원·준비 항목은 비교 화면에서 확인한다. 분석 중 문장·입력·계정·페이지가 바뀌면 오래된 결과를 적용하지 않는다.
- 키 미설정·중지·통신 실패·잘못된 응답·사용량 제한에는 기존 규칙 분석과 직접 설정을 사용한다. 기본 규칙 결과를 AI 결과로 표시하지 않는다.
- 분석 문장과 결과를 새 DB 테이블이나 브라우저 영구 저장소에 기록하지 않는다. 기존 ERD·26개 테이블·17개 시퀀스를 유지한다.

## API

`GET /api/recommendations/analysis-capabilities`는 분석 가능 여부·제공자·외부 전송 여부만 반환한다. 키나 인증 헤더를 반환하지 않는다.

`POST /api/recommendations/analyze`는 비로그인 탐색에서도 사용할 수 있고 기존 CSRF 토큰이 필요하다.

```json
{"activity":"4명이 면접 연습을 하고 녹화하려고 해요"}
```

성공 응답의 예시다. 예시를 실제 AI 호출 검증 결과로 해석하지 않는다.

```json
{
  "source":"ai",
  "reason":"",
  "analysis":{
    "activity":"면접 연습",
    "people":4,
    "peopleStatus":"explicit",
    "needs":{"space":true,"video":true,"audio":false,"presentation":false},
    "needsClarification":false
  }
}
```

대체 응답은 `source:"rules"`, 사유 코드, `analysis:null`이다. 화면은 기존 규칙으로 분석하고 사용자가 직접 수정하도록 안내한다. 인원이 없으면 `null/unspecified`, 범위·충돌이면 `null/ambiguous`이며 임의의 한 숫자로 정하지 않는다.

## GPT(OpenAI) 연결 준비

사용자 선택에 따라 기본 제공자를 OpenAI GPT로 변경했다. 공통 제공자 인터페이스와 사용자 확인 화면을 분리해 추천·예약 로직은 유지한다. 기본 모델은 구조화 출력을 지원하는 `gpt-5.4-mini`이며, 로컬 설정에서 변경할 수 있다. 선택 모델은 Responses API·구조화 출력·`reasoning.effort=none`을 지원해야 한다. 실제 계정의 모델 접근 권한과 할당량은 키 연결 후 확인한다.

Git에서 제외한 `src/main/resources/application-local.properties`의 다음 항목을 사용한다. 키를 공개 소스·README·커밋·채팅에 적지 않는다.

```properties
campus.analysis.enabled=false
campus.analysis.provider=openai
campus.analysis.openai.api-key=${OPENAI_API_KEY:}
campus.analysis.openai.model=gpt-5.4-mini
campus.analysis.timeout-ms=8000
campus.analysis.max-calls-per-minute=20
```

환경변수 `OPENAI_API_KEY` 또는 해당 로컬 설정의 `campus.analysis.openai.api-key`에 키를 넣고 `campus.analysis.enabled=true`로 변경해 서버를 다시 시작한다. 기본은 중지 상태다. `.env` 파일은 Spring이 자동으로 읽도록 구성하지 않았으므로 환경변수나 로컬 properties를 사용한다.

호출은 서버에서만 수행한다. 외부 연결은 3초 연결 제한·최대 8초 응답 제한·64KB 응답 제한·동시 2개·분당 최대 20회로 제한하며 자동 재시도하지 않는다. 기본 키 미설정 상태에서는 실제 외부 분석을 수행하지 않는다.

고정된 `https://api.openai.com/v1/responses`로 요청하고 키는 서버 Authorization 헤더에만 넣는다. JSON Schema와 `strict=true`를 사용하며 완료되지 않은 응답·거절·도구 호출·추가 필드·중복 JSON을 적용하지 않는다. `store=false`를 명시해 API 응답의 후속 조회용 저장을 요청하지 않는다. 이 설정을 제공자의 모든 로그·보관이 없다는 의미로 해석하지 않는다.

[OpenAI Responses API](https://developers.openai.com/api/reference/resources/responses/methods/create), [구조화 출력](https://developers.openai.com/api/docs/guides/structured-outputs), [기본 모델 안내](https://developers.openai.com/api/docs/models/gpt-5.4-mini)를 기준으로 구성한다.

기존 Gemini 어댑터는 `campus.analysis.provider=gemini`로 명시할 때만 활성화한다. 그때만 기존 `campus.analysis.api-key`와 `campus.analysis.model` 설정을 사용한다. OpenAI 어댑터는 Gemini 키를 읽지 않으며 자동 제공자 전환이나 두 제공자에 대한 중복 호출을 하지 않는다.

## 키 발급과 현재 검증 상태

### 2026-11-18 키 입력 후 실제 OpenAI 호출

사용자의 입력 완료 안내 후 실제 로컬 파일에 키가 등록된 것을 값 노출 없이 확인했다. 기존 키·DB 설정은 변경하지 않았다. 확인된 8081 CampusRent 프로세스만 중지하고 `run-server.cmd`로 재시작했다. 모델은 `gpt-5.4-mini`, 분석 활성 상태와 기존 제한값을 유지했으며 DB 초기화·시드 입력은 비활성 상태로 실행했다.

- 기능 조회의 실제 결과는 `provider=openai`, `available=true`, `externalProcessing=true`다. 이는 로컬 설정이 유효하다는 뜻이며 모델 호출 성공을 뜻하지 않는다.
- 같은 쿠키 세션·CSRF로 지정 문장 `4명이 면접 연습을 하고 녹화하려고 해요`를 **실제 외부 분석 1회**로 요청했다. OpenAI 어댑터가 HTTP 429를 받아 실제 응답은 `{"source":"rules","reason":"rate-limited","analysis":null}`이었다. 이번 새 서버에서 첫 유효 분석 요청으로 로컬 분당 20회 제한에 도달하지 않았으므로 외부 제공자 제한으로 판별한다. 자동·수동 재호출은 하지 않았다.
- 외부 요청·응답은 발생했으나 **GPT 분석 성공은 미검증**이다. 활동·인원·필요 항목의 실제 AI 결과는 생성되지 않았다. 429의 구체적 `error.code`는 기존 어댑터가 보관하지 않아 요청 속도·잔액·프로젝트/조직 한도 중 어느 원인인지 확정하지 않았다. [OpenAI 공식 오류 안내](https://developers.openai.com/api/docs/guides/error-codes)에 따라 계정의 API 크레딧·사용량·제한을 확인해야 한다. 결제 상태·모델 권한은 미검증이며, 단순 반복 요청으로 해결된다고 가정하지 않는다.
- 이번 실제 HTTP 검사는 **7개 통과**다. 서버 모드, 제공자 정보, CSRF 필수, 지정 요청 수신, 정직한 규칙 대체, 잘못된 입력 거부, Oracle 카탈로그 조회를 확인했다. 키가 등록된 실제 로컬 설정의 Git 제외·미추적 상태와 공개 변경 파일·기존 JAR에 비밀 값이 없음을 재확인했다.
- 애플리케이션 코드 수정·새 빌드·테스트 재실행은 없었다. 바로 앞선 Java 97개·JS 28개 통과 기록과 이번 실제 외부 호출 결과를 구분한다. 예약 제출·DB 생성·초기화·삭제·Git 커밋·푸시는 수행하지 않았다. 서버는 8081에서 유지한다.
- 이번 후속 작업에서는 브라우저를 추가 조작하지 않았다. 앞선 브라우저 자동 제어 복구 실패와 별개로, 실제 AI 결과의 확인 적용·추천 연결·품질·지연은 성공 응답 후 확인할 항목으로 남아 있다.

### 2026-11-18 8081 개발 서버 재점검

이번 실행은 아래 이전 구현 기록과 구분한다. 현재 소스에서 Controller·Service·OpenAI 어댑터·공통 전송·정책·Security·화면 확인 적용 흐름과 관련 테스트를 확인했다. 고정 Responses API, 모델 `gpt-5.4-mini`, JSON Schema의 `strict=true`, `store=false`, 8초/64KB 제한 및 키·데이터 미로깅을 유지했다. 이번에는 애플리케이션 소스와 실행 스크립트를 수정할 필요가 없었다.

- 실제 Git 제외 `application-local.properties`만 필요한 항목을 조정했다. `enabled=true`, `provider=openai`, OpenAI 키 환경변수 참조, `gpt-5.4-mini`, 8000ms, 분당 20회로 설정했다. DB 접속·기존 비밀 값과 초기화 방지 설정은 보존했다. 공개 예시 파일의 기본 `enabled=false`와 실제 로컬 활성 설정은 구분한다.
- 로컬 파일과 프로세스·사용자·시스템의 `OPENAI_API_KEY`를 값 출력 없이 확인했으며 키가 없었다. `available`는 키·모델 설정의 유효성 검사이며, 실제 외부 호출 성공 여부를 뜻하지 않는다.
- `run-server.cmd` → `tools/server.ps1 -Task run`으로 **http://127.0.0.1:8081**의 실제 Spring Boot·Thymeleaf 개발 서버를 실행했다. `preview.cmd`의 8080 독립 시연이나 이전 8082 점검과 구분한다. 서버 모드 HTML과 Oracle 카탈로그 GET 조회가 성공했다.
- 실제 `GET /api/recommendations/analysis-capabilities`: `provider=openai`, `available=false`, `externalProcessing=false`.
- 같은 쿠키 세션에서 CSRF를 준비해 지정 문장 `4명이 면접 연습을 하고 녹화하려고 해요`를 유효한 POST로 1회 전송했다. 실제 응답은 `{"source":"rules","reason":"unconfigured","analysis":null}`이었다. 키가 없어 외부 OpenAI 호출은 **0회**이며, AI 성공으로 표시하지 않았다.
- 로컬 HTTP 검사 8개가 통과했다. CSRF 미포함 403, 입력·추가 권한 필드 거부 400, 대체 응답, Oracle 카탈로그 조회를 포함한다. 예약 제출·운영 DB 생성·초기화·삭제는 수행하지 않았다.
- 이번에 재실행한 Java 테스트는 **97개, 실패·오류 0개**다. JavaScript 대역·순수 검사는 분석 화면 8개 + 요청 옵션 4개 + 추천 엔진 16개로 **28개**가 통과했다. 기존 JAR의 로컬 설정·비밀 값 미포함, 실제 로컬 파일의 Git 제외·미추적 상태도 재확인했다. 이번에는 애플리케이션 코드 수정이 없어 새 패키징을 실행하지 않았다. JAR 빌드 성공 97개 기록은 앞선 GPT 전환 시점의 결과다.
- Chrome에서 8081 `/purpose`의 서버 페이지와 준비 상태까지만 관찰했다. 이후 최소화된 창을 자동 제어 도구가 복구하지 못해 분석 비교·확인 적용·추천 결과의 **이번 실브라우저 검증은 미완료**다. 그 흐름의 소스 검토와 대역 테스트 통과를 실브라우저 성공으로 간주하지 않는다.
- 키 등록, 실제 GPT 응답의 `source=ai`·필드 정확도·지연, 결제·할당량·모델 권한은 **미검증**이다. 키를 Git 제외 실제 로컬 파일의 `campus.analysis.openai.api-key`에 직접 저장한 뒤 서버 재시작 및 실제 1회 호출이 필요하다. `.example` 파일에는 키를 입력하지 않는다.

사용자는 GPT 연결을 선택했다. [OpenAI API 키 페이지](https://platform.openai.com/api-keys)에 로그인하고 **Create new secret key**로 프로젝트 키를 발급한다. 키를 위 Git 제외 파일의 `campus.analysis.openai.api-key`에 직접 입력하고 `campus.analysis.enabled=true`로 저장한다. 키를 채팅에 보내지 않는다. 저장 완료 후 서버를 재시작해 실제 호출을 확인한다. [ChatGPT와 API는 요금 체계가 별도](https://help.openai.com/en/articles/9039756-managing-billing-for-chatgpt-and-the-api-platform)이며 계정의 API 결제·크레딧·모델 권한을 확인한다.

이전 GPT 전환 시점에는 전체 Java 테스트 97개(기존 90개 + OpenAI 요청·응답·제공자 선택·전송 제한 7개)와 JAR 패키징이 통과했다. 분석 화면 로직 대역 8개와 서버 요청 옵션 대역 4개도 재검증했다. 당시 실제 로컬 HTTP 9개 검사와 기본 제공자 `openai`·중지 상태를 확인했다. 공개 기능 조회·CSRF·기본 규칙 대체 응답·잘못된 입력 차단과 JS/CSS 제공을 검증했다. 이 기록은 키 입력 후의 실제 GPT 성공 결과가 아니다. 현재 키 등록·외부 호출 결과는 위의 최신 기록을 따른다.
