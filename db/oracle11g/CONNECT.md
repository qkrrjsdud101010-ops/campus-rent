# Oracle 11g XE 로컬 연결 안내

2026-11-04 · 9주차 DB 연결 안내 반영. 실제 팀 계정·비밀번호·서버 주소는 로컬 파일 또는 환경변수로만 관리한다. 파일 수정은 로컬 저장소에서 수행하며 사용자의 명시적 요청에 따라 이번 변경은 로컬 Git으로 Commit·Push한다.

## 확인한 환경과 드라이버

| 항목 | 현재 확인 |
| --- | --- |
| 단독 검사 Java / javac | 시스템 Java 1.8.0_503 / JDK 1.8.0_151 유지 |
| Spring Boot 서버 | 전용 Java 21.0.13·Spring Boot 4.1.2·JdbcTemplate, 로컬 실행 검증 |
| 빌드·SQL 도구 | Maven 3.9.16을 .work/runtime에 준비, 단독 SQL 도구는 시스템 Java 8 사용 |
| 화면 | HTML·CSS·JavaScript 및 JDK 기반 로컬 미리보기 |
| DB | Oracle Database 11g XE 11.2.0.2.0 접속 확인, SID 방식 |
| 검사 드라이버 | com.oracle.database.jdbc:ojdbc6:11.2.0.4 |

Oracle [공식 JDBC FAQ](https://www.oracle.com/database/technologies/faq-jdbc.html)는 11g ojdbc6의 JDK 8 지원을 11.2.0.3/11.2.0.4 드라이버에서 안내한다. 선택한 라이브러리는 [Oracle의 Maven Central 배포](https://blogs.oracle.com/developers/oracle-database-client-libraries-for-java-now-on-maven-central) 버전이다. 이번 읽기 전용 검사에서 DB 11.2.0.2.0·JDBC 11.2.0.4.0의 실제 연결을 확인했다. 이 동작 확인을 모든 XE 패치의 공식 인증으로 일반화하지 않는다.

이 문서의 단독 접속·SQL 검사는 기존 Java 8 환경에서 실행한다. 이어서 구성한 Spring Boot 서버는 전용 Java 21과 ojdbc8 19.33.0.0으로 Oracle 업무 API를 검증했다. 서버 실행은 [개발 안내](../../docs/SERVER.md)를 따른다.

## 로컬 설정

`src/main/resources/application-local.properties`는 Git에서 제외한다. 새 PC에서는 `.example` 파일을 복사하되 기존 로컬 파일을 덮어쓰지 않는다.

```powershell
if (-not (Test-Path -LiteralPath 'src/main/resources/application-local.properties')) {
    Copy-Item -LiteralPath 'src/main/resources/application-local.properties.example' -Destination 'src/main/resources/application-local.properties'
}
```

VS Code에서 해당 파일에 배정된 값을 입력한다. 수업에서 지정한 포트를 기본 Oracle 포트로 임의 변경하지 않는다. SID URL 형식은 다음과 같다.

```properties
spring.datasource.url=jdbc:oracle:thin:@YOUR_DB_HOST:YOUR_DB_PORT:YOUR_DB_SID
spring.datasource.username=YOUR_TEAM_USER
spring.datasource.password=
spring.datasource.driver-class-name=oracle.jdbc.OracleDriver
```

- 비밀번호를 명령 인자로 전달하지 않는다. Java properties에서 백슬래시는 `\\`로 입력하고 값 뒤에 주석을 덧붙이지 않는다. 특수 문자가 있으면 환경변수 방식도 가능하다.
- `SPRING_DATASOURCE_URL`, `SPRING_DATASOURCE_USERNAME`, `SPRING_DATASOURCE_PASSWORD` 환경변수를 지원한다. 명시된 로컬 URL·사용자와 환경변수가 충돌하면 중단한다. 기존 환경변수는 값 노출 없이 확인한다.
- `.env` 파일을 두는 것만으로 이 검사 도구나 Spring이 자동으로 읽지는 않는다.
- 예시와 서버의 `spring.sql.init.mode=never`·`spring.jpa.hibernate.ddl-auto=none`는 자동 초기화를 막는다. 현재 서버 시작 시 설치 SQL이나 DDL을 실행하지 않는다.

비밀 파일 내용 대신 Git 제외·추적 여부만 확인한다.

```powershell
git check-ignore -v -- src/main/resources/application-local.properties .env .env.local
git ls-files -- src/main/resources/application-local.properties .env .env.local
```

두 번째 명령에 실제 설정 파일이 나오면 커밋 전에 추적 상태를 정리한다. 현재 properties·local YAML·.env는 제외하고 비밀 없는 예시 파일은 추적할 수 있다.

## 드라이버 설치·접속 검사

저장소 루트에서 실행한다. 실행 정책은 해당 PowerShell 프로세스에만 적용한다.

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\tools\setup-oracle-jdbc.ps1
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\tools\check-oracle-connection.ps1 -ValidateOnly
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\tools\check-oracle-connection.ps1
```

- setup: 고정 Maven Central HTTPS 주소의 드라이버·배포 SHA-1을 받아 검증하고 Git 제외 경로 `.work/jdbc/`에 저장한다.
- ValidateOnly: 설정 형식·필수값과 JDBC 클래스 로딩만 검사한다. 네트워크 접속은 없다.
- 기본 검사: 한 번 로그인해 DUAL의 값, 세션 사용자/현재 스키마 일치, DB·JDBC 버전, USER_TABLES의 본인 테이블 수만 읽는다. DDL·DML·스키마 전환·다른 계정 재시도는 없다.
- URL·사용자·비밀번호·드라이버 원문 예외는 출력하지 않는다. 제한 시간과 오류 코드·고정 안내를 사용한다.
- 다른 설정 파일은 `-ConfigPath`, 다른 JDBC JAR는 `-DriverPath` 또는 `ORACLE_JDBC_JAR`로 지정할 수 있다. 다른 JDK로 변경하면 드라이버 호환성을 다시 확인한다.

## 객체명 확인과 이후 순서

현재 ERD는 APP_USER·REQUEST_ITEM 등 이름을 유지하고 TBL_를 붙이지 않았다. 기존 SQL의 시퀀스는 SQ_APP_USER 등 SQ_ 이름이다. 수업의 TBL_·SEQ_ 규칙과 차이를 설명한 후, 2026-11-04 사용자가 **기존 ERD·SQL 이름 유지**를 선택했다. 이번 구축은 이 이름으로 진행한다.

후속 변경 시에도 FK·트리거·시퀀스 참조·사전 검사·정적 검증·문서를 함께 갱신한다.

1. 본인 계정으로 접속하고 현재 스키마를 확인한다.
2. 본인 기존 객체·권한·할당량을 확인한다.
3. 객체 이름과 SQL을 검토한 후 [설치 안내](README.md)에 따라 install.sql을 실행한다.
4. 04_verify.sql로 생성 결과를 확인한다.
5. 테스트 전용 연결에서 tests/constraints.sql의 29개 DML 검사를 선택 실행한다. 자체 데이터는 롤백하지만 시퀀스 소모는 복원되지 않는다.
6. 실제 서버 DAO를 연결하고 기능별 CRUD·트랜잭션을 검증한다.

DDL은 암묵적으로 COMMIT되므로 생성 전에 검토한다. 기존 스크립트는 객체 충돌 시 중단하며 기존 객체·데이터를 자동 삭제하지 않는다. JDBC 검사 도구는 SQL 파일을 실행하지 않는다.

SQL*Plus 없이 고정된 SQL을 실행하는 별도 도구도 준비했다. SQL 전체 파싱·문장 종류/개수 검사 후 연결하고, 설치 전에 권한·기존 객체를 확인한다. 익명 PL/SQL·트리거와 SQL*Plus 지시문을 구분하며, 오류 원문과 미등록 DBMS_OUTPUT는 출력하지 않는다.

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\tools\run-oracle-schema.ps1 -ParseOnly
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\tools\run-oracle-schema.ps1 -Mode review
# 최초 설치 때만 사용. 이미 구축된 현재 스키마에서는 다시 설치하지 않는다.
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\tools\run-oracle-schema.ps1 -Mode install
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\tools\run-oracle-schema.ps1 -Mode verify
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\tools\run-oracle-schema.ps1 -Mode constraints
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\tools\run-oracle-schema.ps1 -Mode crud
```

`ParseOnly`는 실제 설정·JDBC 드라이버·DB를 읽지 않는다. `review`는 본인 권한·할당량·객체 수를 조회하고 `install`은 고정 00~04 순서로 생성·검증한다. `verify`는 04만 재검사한다. 두 테스트 모드는 각각 별도 연결에서 합성 행을 검사하고 롤백한다. 과거 테이블·데이터를 지우는 기능은 없으며 오류 시 자동 재시도하지 않는다. 테스트에서 소비한 시퀀스 번호는 복원되지 않는다.

## 현재 검증 상태

- 로컬 비밀 설정의 Git 제외·미추적을 확인했다.
- 합성 설정의 ValidateOnly로 Java 컴파일·JDBC 클래스 로딩을 확인했다. 다른 사용자 환경변수 충돌을 차단하고 출력에 설정값이 포함되지 않는지도 확인했다. 실제 계정 인증 시험은 아니다.
- 지정 서버·포트의 TCP 연결을 확인했다. Oracle 로그인 성공과는 구분한다.
- 배정된 계정의 Oracle 인증·SELECT 1 FROM DUAL·세션 사용자/현재 스키마 일치 검사를 통과했다. DB는 11.2.0.2.0, JDBC는 11.2.0.4.0이다.
- 설치 전 본인 객체 0개·필수 생성 권한·할당량을 확인하고, 사용자가 선택한 기존 ERD·SQL 이름으로 테이블 26개·컬럼 185개·시퀀스 17개·트리거 17개를 생성했다.
- PK 26개·UQ 13개·FK 44개·CHECK 72개·명시 인덱스 35개와 트리거 컴파일을 확인했다. 유효하지 않은 CampusRent 객체는 0개다.
- 실제 무결성 검사 29개와 생성·조회·수정·삭제 4개를 통과했다. 테스트 데이터는 롤백했고 시퀀스 번호만 일부 소모됐다.
- 이어서 Java 21·Spring Boot 4.1.2·JdbcTemplate·서버 JDBC ojdbc8 19.33.0.0을 연결하고 실제 API 20개·Chrome 화면 20개·단위 테스트 7개를 검증했다. 실행 방법은 [서버 안내](../../docs/SERVER.md)를 참조한다. Java 8 단독 도구의 ojdbc6와 구분하며 설치 SQL은 재실행하지 않았다. Git Commit·Push는 진행하지 않았다.
