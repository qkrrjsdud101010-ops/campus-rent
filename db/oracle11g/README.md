# CampusRent Oracle Database 11g SQL

2026-10-28 작성. 기준은 `docs/erd/[New-Era] CampusRent_ERD_20261020.pdf`의 1쪽 논리 ERD와 2쪽 물리 ERD, `docs/New-Era_PROJECT.md`입니다. ERD는 교수님 검토 전 초안입니다.

**물리 ERD의 26개 테이블·185개 컬럼·33개 NULL 허용 선언과 자료형을 그대로 반영했습니다.** PK 구분선과 관계선도 확인했습니다. ERD에 없는 코드 값·DEFAULT·UQ·CHECK·인덱스·ID 생성 방식은 아래의 보완 설계이며, ERD에 이미 명시돼 있던 정의로 취급하지 않습니다.

이 SQL은 파일 작성·정적 대조를 마친 상태입니다. 작성 과정에서 Oracle에 접속하거나 객체를 생성하지 않았으며, 실제 11g SQL 실행·PL/SQL 컴파일 결과는 아직 검증하지 않았습니다.

## 파일과 실행 순서

| 파일 | 내용 |
| --- | --- |
| `install.sql` | 전체 설치 진입점. 아래 00~04를 순서대로 실행 |
| `00_preflight.sql` | 기존 객체·제약 이름 충돌 확인. 충돌하면 생성 전에 중단 |
| `01_tables.sql` | 26개 테이블, PK 26개, UQ 13개, 행 단위 CHECK 72개, 테이블·컬럼 한글 주석 |
| `02_relationships.sql` | FK 44개와 명시적 인덱스 35개 |
| `03_sequences.sql` | 단일 대리키용 시퀀스·INSERT 트리거 각각 17개 |
| `04_verify.sql` | Oracle 사전 뷰로 테이블·컬럼·제약·인덱스·시퀀스·트리거 상태 확인. 읽기 전용 |
| `tests/constraints.sql` | 설치 후 테스트 전용 연결에서 선택적으로 실행하는 DML 무결성 검사 29개. 테스트 데이터는 롤백 (실제 실행 전) |

대상 스키마에 `CREATE TABLE`, `CREATE SEQUENCE`, `CREATE TRIGGER` 권한과 기본 테이블스페이스의 충분한 할당량이 필요합니다. DBA 계정이나 다른 프로그램의 운영 스키마 대신, CampusRent 전용 스키마를 사용합니다. 사용자·테이블스페이스 생성이나 권한 부여는 환경별 DBA 작업으로 남겼습니다.

1. Oracle 11g의 CampusRent 전용 스키마로 연결합니다.
2. SQL 파일을 **UTF-8**로 엽니다. 한글 주석을 보존하려면 DB 문자셋과 클라이언트의 UTF-8 설정도 확인합니다. SQL*Plus로 UTF-8 파일을 읽을 경우 해당 터미널의 `NLS_LANG` 문자셋을 `AL32UTF8`로 맞춥니다.
3. SQL Developer에서는 `install.sql`을 열고 **스크립트 실행(F5)**을 사용합니다. SQL*Plus에서는 다음처럼 실행합니다.

```sql
@C:\CampusRent\campus-rent\db\oracle11g\install.sql
```

`@@`는 설치 파일 위치를 기준으로 하위 SQL을 읽습니다. 설치 파일에는 `DROP`, `TRUNCATE`, 데이터 삭제, 실제 계정·샘플 데이터 삽입이 없습니다. **Oracle DDL은 암묵적으로 COMMIT되므로 오류 시 앞서 만든 객체까지 ROLLBACK되지 않습니다.** 중간 오류가 나면 원인을 확인하고 부분 생성 상태를 정리한 뒤 다시 실행합니다. 재실행 시 기존 객체를 자동 삭제하지 않습니다.

설치 후에는 필요할 때 `@04_verify.sql`로 메타데이터를 다시 확인할 수 있습니다. DML 검사는 새 테스트 연결에서 `@tests/constraints.sql`을 별도로 실행합니다. 테스트 스크립트는 실제 운영 데이터에 적용하는 예제가 아닙니다. 성공·실패 모두 자체 SAVEPOINT까지 되돌리지만 시퀀스 번호 소모는 되돌리지 않습니다. 이 파일은 오류 시 클라이언트의 전체 롤백을 막기 위해 `WHENEVER SQLERROR CONTINUE NONE`을 사용합니다. 종료 코드만으로 성공을 판단하지 말고 Oracle 오류가 없으며 마지막에 `29 constraint checks passed; fixture DML rolled back.`가 표시되는지 확인합니다. 테스트 파일의 `AUTOCOMMIT OFF` 등 클라이언트 설정은 실행 후에도 유지됩니다.

## ERD 대응

| 테이블 | 논리명 | 컬럼 수 | PK |
| --- | --- | ---: | --- |
| APP_USER | 사용자 | 6 | USER_ID |
| EQUIPMENT_TYPE | 장비품목 | 4 | TYPE_ID |
| EQUIPMENT_MODEL | 장비모델 | 6 | MODEL_ID |
| SPEC_ITEM | 품목별사양항목 | 5 | SPEC_ITEM_ID |
| MODEL_SPEC | 모델사양값 | 5 | MODEL_ID, SPEC_ITEM_ID |
| EQUIPMENT | 개별장비 | 11 | EQUIPMENT_ID |
| EQUIPMENT_COMPONENT | 기본구성품 | 7 | COMPONENT_ID |
| EQUIPMENT_ALTERNATIVE | 대체장비관계 | 7 | SOURCE_EQUIPMENT_ID, TARGET_EQUIPMENT_ID |
| FACILITY | 시설 | 11 | FACILITY_ID |
| FACILITY_HOURS | 시설운영시간 | 4 | FACILITY_ID, WEEKDAY_NO |
| FACILITY_BLOCK | 시설이용제한 | 7 | BLOCK_ID |
| USE_PURPOSE | 이용목적 | 5 | PURPOSE_ID |
| PURPOSE_KEYWORD | 목적키워드 | 7 | KEYWORD_ID |
| PURPOSE_EQUIPMENT_RULE | 목적별장비추천규칙 | 5 | PURPOSE_ID, TYPE_ID |
| FACILITY_PURPOSE | 시설허용목적 | 2 | FACILITY_ID, PURPOSE_ID |
| SELECTION_ITEM | 선택목록항목 | 12 | SELECTION_ITEM_ID |
| RENT_REQUEST | 신청묶음 | 4 | REQUEST_ID |
| REQUEST_ITEM | 개별신청항목 | 15 | REQUEST_ITEM_ID |
| REQUEST_ALTERNATIVE | 대체선택내역 | 7 | REQUEST_ITEM_ID (부모에서 전달) |
| REQUEST_STATUS_LOG | 신청상태이력 | 7 | STATUS_LOG_ID |
| EQUIPMENT_CHECKOUT | 장비출고 | 9 | CHECKOUT_ID |
| CHECKOUT_COMPONENT | 출고구성품 | 9 | CHECKOUT_ID, COMPONENT_SEQ |
| RETURN_INSPECTION | 반납확인회차 | 7 | CHECKOUT_ID, INSPECTION_ROUND |
| RETURN_COMPONENT | 반납구성품확인 | 6 | CHECKOUT_ID, INSPECTION_ROUND, COMPONENT_SEQ |
| EQUIPMENT_CHECK_LOG | 장비점검이력 | 9 | CHECK_LOG_ID |
| FACILITY_USAGE | 시설실제이용 | 8 | USAGE_ID |
| 합계 | | **185** | **26개 테이블** |

새 테이블이나 컬럼을 추가하지 않았습니다. `APP_USER.PASSWORD`도 원문 이름을 유지했지만, 서버에서 만든 비밀번호 **해시**만 저장하도록 주석을 붙였습니다. 로그인용 평문 비밀번호나 토큰을 저장하는 열이 아닙니다.

## 보완한 관계·무결성

- 출고와 실제 시설 이용은 `(REQUEST_ITEM_ID, ITEM_KIND)`로 개별 신청을 참조합니다. 부모에 해당 쌍의 UQ를 두고 자식에는 각각 `ITEM_KIND='E'`, `'F'`를 강제해 다른 종류의 신청을 연결하지 못하게 했습니다.
- `RETURN_COMPONENT`는 반납 회차 `(CHECKOUT_ID, INSPECTION_ROUND)`와 출고 구성품 `(CHECKOUT_ID, COMPONENT_SEQ)`를 **각각** 참조합니다. 다른 출고 건의 회차·구성품을 섞지 못합니다.
- `SELECTION_ITEM`·`REQUEST_ITEM`은 장비·시설 중 정확히 하나만 선택합니다. 신청의 시설 항목은 인원·목적이 필수입니다. 선택 목록은 미완성 초안이므로 일정·인원·목적의 원문 NULL 허용을 유지합니다. 시작·종료 중 한쪽만 입력된 선택 초안도 허용합니다.
- 필수 수량·인원·회차·순번은 양수, 반환 수량과 변경 버전·표시순서·우선순위는 음수가 될 수 없습니다. 신청·제한·대체 원래 기간은 종료가 시작보다 늦어야 합니다.
- 기본 구성품에서 본체는 필수 반환 대상이며 장비당 본체 행은 최대 한 개입니다. 출고의 필수 구성품은 정해진 수량 전체를 전달해야 하고 초과 전달은 허용하지 않습니다.
- 이메일은 앞뒤 공백·공백만인 값을 거부하며 대소문자를 구분하지 않고 유일합니다. 모델 코드·개별 관리번호·시설 코드·목적 코드·접수번호도 유일합니다. 품목명, 품목별 사양명, 장비별 구성품명, 같은 목적의 동일 키워드 규칙과 신청 묶음 내 원래 항목 번호의 중복을 막았습니다.
- 선택 목록의 사용자별 같은 자원 중복은 종류별 CASE 기반 UNIQUE 인덱스로 막았습니다. 해당 종류가 아니면 **두 인덱스 키를 모두 NULL**로 만들어 같은 사용자가 서로 다른 시설 여러 개를 담을 수 있습니다.
- 대체 장비 관계의 PK는 방향 있는 순서쌍입니다. 자기 자신을 대체 대상으로 지정할 수 없고 A→B로 B→A를 자동 생성하지 않습니다.
- 이력 보존을 위해 `ON DELETE CASCADE`를 사용하지 않았습니다.

## 제안한 코드 값

ERD에는 코드 값 목록이 없습니다. 아래 값은 이번 SQL의 CHECK·DEFAULT를 위해 정한 **보완 설계**이며, 팀의 기존 코드 규약이 있다면 DB 설치 전에 함께 조정합니다. 현재 화면의 한글 상태와 실제 API를 아직 연결하지 않았습니다.

| 열·영역 | 값 |
| --- | --- |
| `ROLE_CODE` | `STUDENT`, `ADMIN` |
| `ITEM_KIND` | `E` = 장비, `F` = 시설 |
| `*_YN` | `Y`, `N` |
| 장비·시설 `OPERATING_STATUS` 및 점검 이력 상태 | `NORMAL`, `CHECKING`, `DISABLED` |
| 사양 `VERIFY_STATUS` | `UNVERIFIED`, `VERIFIED` (가상 여부는 `IS_DEMO_YN`으로 별도 표시) |
| `ORIGIN_CODE` | `DIRECT`, `RECOMMEND`, `ALTERNATE` |
| 키워드 `MATCH_MODE` / `EFFECT_CODE` | `CONTAINS`, `EXACT` / `INCLUDE`, `EXCLUDE` |
| 추천 `NEED_LEVEL` | `REQUIRED`, `OPTIONAL` |
| `ALTERNATIVE_KIND` | `EQUIPMENT_TIME`, `EQUIPMENT_RESOURCE`, `FACILITY_TIME`, `FACILITY_RESOURCE` |
| 출고 `SOURCE_CODE` | `ACTUAL`, `LATE_REGISTERED` |
| 출고 `OUT_CONDITION` | `NORMAL`, `DAMAGED`, `UNKNOWN` |
| 반납 `OUTCOME_CODE` | `COMPLETE`, `HOLD` (보류 사유 필수) |
| `RETURN_CONDITION` | `NORMAL`, `DAMAGED`, `MISSING`, `UNKNOWN` (손상이면 메모 필수) |
| 점검 `ACTION_CODE` | `CHECK_REQUIRED`, `CHECK_COMPLETED`, `STATUS_CHANGED` |
| `WEEKDAY_NO` | ISO 기준 `1`=월요일 ~ `7`=일요일 |

| 신청 상태 코드 | 화면 의미 | 허용 자원 |
| --- | --- | --- |
| `PENDING` | 승인 대기, 기간 미확보 | 장비·시설 |
| `APPROVED` | 승인·수령 대기 / 시설 예약 승인 | 장비·시설 |
| `CHECKED_OUT` | 대여 중 | 장비 |
| `RETURN_REQUESTED` | 반납 신청 | 장비 |
| `RETURN_HELD` | 반납 보류 | 장비 |
| `RETURNED` | 반납 완료 | 장비 |
| `IN_USE` | 시설 이용 중 | 시설 |
| `COMPLETED` | 시설 이용 완료 | 시설 |
| `REJECTED` | 거절 (상태 이력에 사유 필수) | 장비·시설 |
| `CANCELLED` | 승인 전 신청 취소 완료 | 장비·시설 |

상태 CHECK는 가능한 값·자원 종류만 검사합니다. 허용된 **상태 전이**와 처리 권한까지 검사하는 트리거를 만든 것은 아닙니다. 시설 유형·목적명·실제 재고는 별도 데이터로 입력합니다.

## 기본값·자동 번호·시간

- 역할 기본값은 `STUDENT`, 신청 상태는 `PENDING`, 운영 상태는 `NORMAL`, 사양 확인은 `UNVERIFIED`, 출처는 `DIRECT`입니다.
- 사용·대여 허용·필수 반환 플래그는 `Y`, 본체 플래그는 `N`, 변경 버전·표시순서·우선순위는 `0`이 기본입니다. **`IS_DEMO_YN`은 기본값 없이 명시 입력**해야 합니다.
- 등록·추가·신청·변경·검수 등의 기록 시각은 `LOCALTIMESTAMP`를 기본으로 합니다. 실제 출고·시설 시작·종료 시각은 자동으로 채우지 않습니다. `ACTUAL` 출고는 실제 출고 시각이 필수이고 사후 등록은 `LATE_REGISTERED`로 구분합니다.
- `ROW_VERSION`의 자동 증가 트리거는 없습니다. 서비스의 UPDATE에서 기대 버전을 조건으로 검사하고 `ROW_VERSION = ROW_VERSION + 1`을 적용합니다.
- Oracle 11g에는 IDENTITY나 `DEFAULT sequence.NEXTVAL`을 사용하지 않습니다. 17개의 `SQ_테이블명`과 `BI_테이블명` 트리거가 ID가 NULL인 INSERT에만 `NEXTVAL`을 채웁니다. 복합키·부모에게 받는 키는 호출 측에서 전달합니다.
- ID를 직접 입력해도 시퀀스가 자동으로 그 값에 맞춰지지는 않습니다. 수동 데이터 이관 시 별도 시퀀스 정렬이 필요합니다. 시퀀스 번호는 실패·롤백·캐시로 건너뛸 수 있으며 연속 번호를 보장하지 않습니다. NUMBER(10)에 맞춰 최대값은 `9999999999`입니다.
- 원문의 `VARCHAR2(n CHAR)`, `CHAR(n)`, `NUMBER(p)`, `TIMESTAMP`를 유지했습니다. `TIMESTAMP`는 시간대 정보를 저장하지 않으므로 서비스·DB 연결의 시간대를 맞춰야 합니다. `LOCALTIMESTAMP`는 접속 세션 시간대에 따릅니다. 한국 시간 기준 연결에서는 필요에 따라 `ALTER SESSION SET TIME_ZONE = '+09:00';`를 설정합니다.
- 시설 운영 시간은 `HH24:MI` 형식만 CHECK로 검사합니다. 익일 운영·휴무·준비/정리 시간 정책은 확정 후 서비스에서 적용합니다.

## 서비스 트랜잭션에서 반드시 구현할 내용

현재 185개 컬럼의 PK·FK·CHECK만으로 아래 조건을 완결할 수 없습니다. 이번 DDL이 이를 자동 보장한다고 판단하면 안 됩니다.

1. 인증된 학생·관리자 역할, 본인 신청 소유권, 실제 처리 관리자 검증
2. 모델과 사양 항목의 장비 품목 일치, 대체 선택과 원래/현재 신청의 종류·유지 조건 일치, 점검 이력의 관련 신청과 장비 일치
3. 동일 자원에 대한 승인 경쟁의 직렬화, 최신 상태·가용성 검사, 승인·기간 확보·상태 이력의 원자적 저장
4. 출고 전 실제 상태·정해진 구성품 전체 정상 확인, 출고 기준의 복사 보존과 이후 변경 방지
5. 출고 기준별 회차의 이번/누적/부족 반환 수량 계산, 누적 초과·중복 합산 차단, 검사 결과와 대여·장비 상태의 동시 저장
6. 미반환·보류가 해결되고 실제 점검을 확인한 후에만 장비 제한 해제
7. 시설 수용 인원·허용 목적·요일 운영 시간·제한 시간대와 실제 시작·종료 처리

승인할 때는 관련 `EQUIPMENT` 또는 `FACILITY` 행을 `SELECT ... FOR UPDATE`로 먼저 잠그는 등 같은 자원 승인을 직렬화하고, 최신 신청·버전·조건을 다시 읽어 검사한 뒤 상태와 이력을 같은 트랜잭션에 저장해야 합니다. 관련 작업 전체가 같은 잠금 순서를 지켜야 합니다. 선택한 자원이 중간에 바뀌었다면 이전 잠금으로 처리하지 않고 다시 확인합니다.

기간은 **시작 포함·종료 제외**입니다. 중복 조건은 `기존 시작 < 새 종료 AND 기존 종료 > 새 시작`입니다. `PENDING`, `REJECTED`, `CANCELLED`는 확보 대상에서 제외합니다. **`RETURNED`·`COMPLETED`는 원래 확보 기간까지 유지**하므로 완료됐다는 이유만으로 중복 검사에서 제외하지 않습니다. 미반환·보류·점검 제한은 기간 겹침 검사와 별도로 확인합니다.

승인 후 취소·미수령·미이용의 확보 해제, 대여 상한, 준비·정리 시간은 미정입니다. 로그인 후 선택 목록의 서버 저장 여부도 미정이어서 ERD의 `SELECTION_ITEM`을 유지한 상태입니다. 이 정책들을 SQL만으로 임의 확정하거나 가상 게스트 계정을 만들지 않았습니다.

## 검증 범위

정적 대조는 다음 명령으로 다시 실행할 수 있습니다. Python 3.9 이상과 `pypdf`가 필요합니다.

```text
python tools/check-oracle11g-schema.py
```

이 검사는 실제 PDF와 테이블·컬럼·자료형·NULL 선언, 복합 PK/FK, 참조 대상 PK/UQ, 식별자 길이·중복 이름, 시퀀스·트리거 패턴, FK 인덱스와 일부 11g 비호환 문법을 검사합니다. Oracle 파서나 PL/SQL 컴파일러를 대체하지 않습니다.

`04_verify.sql`과 `tests/constraints.sql`은 사용자 Oracle 환경에서 실행할 검증 파일입니다. 이번 작업에서는 DB에 접속하지 않고 SQL 작성·정적 대조까지 진행했으므로 **실제 DB 실행은 미검증**입니다. 테스트용 스크립트의 기대 결과도 실제로 실행해 보기 전에는 통과했다고 보고하지 않습니다.

## Oracle 11g 공식 참고

- [식별자 30바이트 규칙](https://docs.oracle.com/cd/E11882_01/server.112/e41084/sql_elements008.htm)
- [자료형·문자 길이·TIMESTAMP](https://docs.oracle.com/cd/E11882_01/server.112/e41084/sql_elements001.htm)
- [제약조건과 NULL·복합 UNIQUE 의미](https://docs.oracle.com/cd/E11882_01/server.112/e41084/clauses002.htm)
- [시퀀스 NEXTVAL 사용 제한](https://docs.oracle.com/cd/E11882_01/server.112/e41084/pseudocolumns002.htm)
- [CREATE SEQUENCE](https://docs.oracle.com/cd/E11882_01/server.112/e41084/statements_6015.htm)
- [함수 기반 UNIQUE 인덱스 예제](https://docs.oracle.com/cd/E11882_01/server.112/e41084/statements_5012.htm)
- [DDL의 암묵적 COMMIT](https://docs.oracle.com/cd/E11882_01/server.112/e41084/statements_4010.htm)
