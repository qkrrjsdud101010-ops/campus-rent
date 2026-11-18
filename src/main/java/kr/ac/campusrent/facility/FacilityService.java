package kr.ac.campusrent.facility;

import java.sql.Timestamp;
import java.time.LocalDateTime;
import java.time.LocalTime;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import kr.ac.campusrent.auth.AuthSupport;
import kr.ac.campusrent.auth.CurrentUser;
import kr.ac.campusrent.catalog.CatalogService;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;
import static kr.ac.campusrent.catalog.CatalogService.num;
import static kr.ac.campusrent.catalog.CatalogService.str;
import static kr.ac.campusrent.catalog.CatalogService.time;
import static kr.ac.campusrent.rental.RentalPolicy.bad;
import static kr.ac.campusrent.rental.RentalPolicy.conflict;

@Service
public class FacilityService {
    private final JdbcTemplate jdbc;

    public FacilityService(JdbcTemplate jdbc) { this.jdbc = jdbc; }

    public Map<String, Object> list(CurrentUser user) {
        AuthSupport.requireRole(user, "admin");
        return Map.of("facilities", facilities(null), "purposes", purposes());
    }

    @Transactional
    public Map<String, Object> create(CurrentUser user, Map<String, Object> input) {
        AuthSupport.requireRole(user, "admin");
        FacilityPolicy.Facility draft = FacilityPolicy.facility(input, false);
        verifyPurposes(draft.purposeIds(), Set.of());
        if (!"NORMAL".equals(draft.status()) || !draft.useAllowed())
            FacilityPolicy.requireConfirmation(draft.confirmed(), draft.reason());
        try {
            long id = next("SQ_FACILITY");
            jdbc.update("INSERT INTO FACILITY(FACILITY_ID,FACILITY_CODE,FACILITY_NAME,FACILITY_TYPE,LOCATION_TEXT,CAPACITY,FIXED_EQUIPMENT_INFO,USE_ALLOWED_YN,OPERATING_STATUS,IS_DEMO_YN) VALUES(?,?,?,?,?,?,?,?,?,?)",
                    id, draft.code(), draft.name(), draft.type(), draft.location(), draft.capacity(),
                    draft.fixedEquipmentInfo(), yn(draft.useAllowed()), draft.status(), yn(draft.isDemo()));
            saveHours(id, draft.hours());
            savePurposes(id, draft.purposeIds());
            return response(id);
        } catch (DuplicateKeyException error) {
            throw conflict("이미 등록된 시설 관리번호입니다. 기존 시설을 확인해주세요.");
        }
    }

    @Transactional
    public Map<String, Object> update(CurrentUser user, long id, Map<String, Object> input) {
        AuthSupport.requireRole(user, "admin");
        FacilityPolicy.Facility draft = FacilityPolicy.facility(input, true);
        Map<String, Object> current = lock(id, draft.expectedVersion());
        if (!draft.code().equals(str(current.get("FACILITY_CODE"))))
            throw bad("등록된 시설 관리번호는 변경할 수 없습니다.");
        Set<Long> originalPurposes = purposeIds(id);
        Map<Integer, FacilityPolicy.Hours> originalHours = hours(id);
        verifyPurposes(draft.purposeIds(), originalPurposes);
        boolean stateChanged = !draft.status().equals(current.get("OPERATING_STATUS")) ||
                !yn(draft.useAllowed()).equals(current.get("USE_ALLOWED_YN"));
        if (stateChanged) FacilityPolicy.requireConfirmation(draft.confirmed(), draft.reason());
        protectReservations(id, current, originalHours, originalPurposes, draft, stateChanged);

        int changed = jdbc.update("UPDATE FACILITY SET FACILITY_NAME=?,FACILITY_TYPE=?,LOCATION_TEXT=?,CAPACITY=?,FIXED_EQUIPMENT_INFO=?,USE_ALLOWED_YN=?,OPERATING_STATUS=?,IS_DEMO_YN=?,ROW_VERSION=ROW_VERSION+1 WHERE FACILITY_ID=? AND ROW_VERSION=?",
                draft.name(), draft.type(), draft.location(), draft.capacity(), draft.fixedEquipmentInfo(),
                yn(draft.useAllowed()), draft.status(), yn(draft.isDemo()), id, draft.expectedVersion());
        requireChanged(changed);
        if (!originalHours.equals(draft.hours())) {
            jdbc.update("DELETE FROM FACILITY_HOURS WHERE FACILITY_ID=?", id);
            saveHours(id, draft.hours());
        }
        if (!originalPurposes.equals(draft.purposeIds())) {
            jdbc.update("DELETE FROM FACILITY_PURPOSE WHERE FACILITY_ID=?", id);
            savePurposes(id, draft.purposeIds());
        }
        return response(id);
    }

    @Transactional
    public Map<String, Object> createBlock(CurrentUser user, long id, Map<String, Object> input) {
        AuthSupport.requireRole(user, "admin");
        FacilityPolicy.Block draft = FacilityPolicy.block(input);
        lock(id, draft.expectedVersion());
        protectBlockReservations(id, draft);
        bumpVersion(id, draft.expectedVersion());
        jdbc.update("INSERT INTO FACILITY_BLOCK(BLOCK_ID,FACILITY_ID,BLOCK_START_AT,BLOCK_END_AT,REASON_TEXT,REGISTERED_BY) VALUES(?,?,?,?,?,?)",
                next("SQ_FACILITY_BLOCK"), id, Timestamp.valueOf(draft.start()), Timestamp.valueOf(draft.end()),
                draft.reason(), Long.parseLong(user.id()));
        return response(id);
    }

    @Transactional
    public Map<String, Object> updateBlock(CurrentUser user, long id, long blockId, Map<String, Object> input) {
        AuthSupport.requireRole(user, "admin");
        FacilityPolicy.Block draft = FacilityPolicy.block(input);
        lock(id, draft.expectedVersion());
        requireBlock(id, blockId);
        protectBlockReservations(id, draft);
        bumpVersion(id, draft.expectedVersion());
        // Preserve the original registrar and registration time when editing a restriction.
        requireChanged(jdbc.update("UPDATE FACILITY_BLOCK SET BLOCK_START_AT=?,BLOCK_END_AT=?,REASON_TEXT=? WHERE FACILITY_ID=? AND BLOCK_ID=?",
                Timestamp.valueOf(draft.start()), Timestamp.valueOf(draft.end()), draft.reason(), id, blockId));
        return response(id);
    }

    @Transactional
    public Map<String, Object> removeBlock(CurrentUser user, long id, long blockId, Map<String, Object> input) {
        AuthSupport.requireRole(user, "admin");
        if (input == null) throw bad("운영 제한 삭제 정보를 입력해주세요.");
        long expectedVersion = FacilityPolicy.version(input.get("expectedVersion"));
        String reason = FacilityPolicy.requiredText(input.get("reason"), 500, "삭제 사유");
        FacilityPolicy.requireConfirmation(FacilityPolicy.confirmation(input.get("confirmed")), reason);
        lock(id, expectedVersion);
        requireBlock(id, blockId);
        bumpVersion(id, expectedVersion);
        requireChanged(jdbc.update("DELETE FROM FACILITY_BLOCK WHERE FACILITY_ID=? AND BLOCK_ID=?", id, blockId));
        return response(id);
    }

    private Map<String, Object> lock(long id, long expectedVersion) {
        if (id < 1 || id > 9_999_999_999L) throw notFound("시설");
        // Rental submission and approval acquire this same parent lock first.
        List<Map<String, Object>> rows = jdbc.queryForList("SELECT * FROM FACILITY WHERE FACILITY_ID=? FOR UPDATE", id);
        if (rows.isEmpty()) throw notFound("시설");
        Map<String, Object> row = rows.getFirst();
        if (num(row.get("ROW_VERSION")) != expectedVersion)
            throw conflict("다른 창에서 시설 정보가 변경되었습니다. 최신 목록을 다시 불러와주세요.");
        if (expectedVersion == 9_999_999_999L) throw conflict("시설 변경 버전을 확인해야 합니다.");
        return row;
    }

    private void bumpVersion(long id, long expectedVersion) {
        requireChanged(jdbc.update("UPDATE FACILITY SET ROW_VERSION=ROW_VERSION+1 WHERE FACILITY_ID=? AND ROW_VERSION=?", id, expectedVersion));
    }

    private void requireChanged(int changed) {
        if (changed != 1) throw conflict("최신 시설 정보를 다시 확인해주세요.");
    }

    private void requireBlock(long id, long blockId) {
        if (jdbc.queryForList("SELECT BLOCK_ID FROM FACILITY_BLOCK WHERE FACILITY_ID=? AND BLOCK_ID=?", id, blockId).isEmpty())
            throw notFound("시설 운영 제한");
    }

    private void verifyPurposes(Set<Long> submitted, Set<Long> original) {
        Map<Long, Boolean> known = new HashMap<>();
        for (Map<String, Object> row : jdbc.queryForList("SELECT PURPOSE_ID,ENABLED_YN FROM USE_PURPOSE ORDER BY PURPOSE_ID"))
            known.put(num(row.get("PURPOSE_ID")), "Y".equals(row.get("ENABLED_YN")));
        for (long id : submitted) {
            if (!known.containsKey(id)) throw bad("존재하는 이용 목적을 선택해주세요.");
            if (!known.get(id) && !original.contains(id)) throw conflict("비활성 목적은 새 허용 목적으로 추가할 수 없습니다.");
        }
    }

    private List<Map<String, Object>> protectedReservations(long id) {
        // An actual use remains active until an administrator finishes it, even after its planned end.
        return jdbc.queryForList("SELECT REQUEST_ITEM_ID,STATUS_CODE,USE_START_AT,USE_END_AT,PEOPLE_COUNT,PURPOSE_ID FROM REQUEST_ITEM WHERE FACILITY_ID=? AND (STATUS_CODE='IN_USE' OR (STATUS_CODE='APPROVED' AND USE_END_AT>LOCALTIMESTAMP)) ORDER BY USE_START_AT,REQUEST_ITEM_ID", id);
    }

    private void protectReservations(long id, Map<String, Object> current,
                                     Map<Integer, FacilityPolicy.Hours> originalHours, Set<Long> originalPurposes,
                                     FacilityPolicy.Facility draft, boolean stateChanged) {
        boolean reducingCapacity = draft.capacity() < num(current.get("CAPACITY"));
        Set<Long> removedPurposes = new HashSet<>(originalPurposes);
        removedPurposes.removeAll(draft.purposeIds());
        boolean hoursChanged = !originalHours.equals(draft.hours());
        boolean becomingUnavailable = stateChanged && (!draft.useAllowed() || !"NORMAL".equals(draft.status()));
        if (!reducingCapacity && removedPurposes.isEmpty() && !hoursChanged && !becomingUnavailable) return;
        for (Map<String, Object> reservation : protectedReservations(id)) {
            if (becomingUnavailable) throw reservationConflict("이용 허용·운영 상태");
            if (reducingCapacity && num(reservation.get("PEOPLE_COUNT")) > draft.capacity())
                throw reservationConflict("수용 인원");
            if (removedPurposes.contains(num(reservation.get("PURPOSE_ID"))))
                throw reservationConflict("허용 목적");
            if (hoursChanged) {
                LocalDateTime start = dateTime(reservation.get("USE_START_AT"));
                LocalDateTime end = dateTime(reservation.get("USE_END_AT"));
                int day = start.getDayOfWeek().getValue();
                FacilityPolicy.Hours revised = draft.hours().get(day);
                if (!Objects.equals(originalHours.get(day), revised) && (revised == null || !revised.contains(start, end)))
                    throw reservationConflict("요일별 운영 시간");
            }
        }
    }

    private void protectBlockReservations(long id, FacilityPolicy.Block draft) {
        for (Map<String, Object> reservation : protectedReservations(id))
            if (FacilityPolicy.overlaps(draft.start(), draft.end(), dateTime(reservation.get("USE_START_AT")),
                    dateTime(reservation.get("USE_END_AT")))) throw reservationConflict("운영 제한 구간");
    }

    private ResponseStatusException reservationConflict(String field) {
        return conflict(field + " 변경이 승인된 예약 또는 진행 중인 이용과 충돌합니다. 관련 신청을 먼저 확인해주세요.");
    }

    private Map<Integer, FacilityPolicy.Hours> hours(long id) {
        Map<Integer, FacilityPolicy.Hours> result = new LinkedHashMap<>();
        for (Map<String, Object> row : jdbc.queryForList("SELECT WEEKDAY_NO,OPEN_TIME,CLOSE_TIME FROM FACILITY_HOURS WHERE FACILITY_ID=? ORDER BY WEEKDAY_NO", id))
            result.put(Math.toIntExact(num(row.get("WEEKDAY_NO"))), new FacilityPolicy.Hours(
                    LocalTime.parse(str(row.get("OPEN_TIME"))), LocalTime.parse(str(row.get("CLOSE_TIME")))));
        return result;
    }

    private Set<Long> purposeIds(long id) {
        Set<Long> result = new HashSet<>();
        for (Map<String, Object> row : jdbc.queryForList("SELECT PURPOSE_ID FROM FACILITY_PURPOSE WHERE FACILITY_ID=? ORDER BY PURPOSE_ID", id))
            result.add(num(row.get("PURPOSE_ID")));
        return result;
    }

    private void saveHours(long id, Map<Integer, FacilityPolicy.Hours> hours) {
        hours.entrySet().stream().sorted(Map.Entry.comparingByKey()).forEach(entry ->
                jdbc.update("INSERT INTO FACILITY_HOURS(FACILITY_ID,WEEKDAY_NO,OPEN_TIME,CLOSE_TIME) VALUES(?,?,?,?)",
                        id, entry.getKey(), entry.getValue().open().toString(), entry.getValue().close().toString()));
    }

    private void savePurposes(long id, Set<Long> purposeIds) {
        purposeIds.stream().sorted().forEach(purposeId -> jdbc.update(
                "INSERT INTO FACILITY_PURPOSE(FACILITY_ID,PURPOSE_ID) VALUES(?,?)", id, purposeId));
    }

    private List<Map<String, Object>> purposes() {
        return jdbc.queryForList("SELECT * FROM USE_PURPOSE ORDER BY PURPOSE_ID").stream().map(row -> {
            Map<String, Object> result = new LinkedHashMap<>();
            result.put("id", str(row.get("PURPOSE_ID")));
            result.put("code", str(row.get("PURPOSE_CODE")));
            result.put("name", str(row.get("PURPOSE_NAME")));
            result.put("enabled", "Y".equals(row.get("ENABLED_YN")));
            return result;
        }).toList();
    }

    private List<Map<String, Object>> facilities(Long selectedId) {
        String where = selectedId == null ? "" : " WHERE FACILITY_ID=?";
        Object[] args = selectedId == null ? new Object[]{} : new Object[]{selectedId};
        // Capture aggregate versions before reading children. If a concurrent edit commits
        // between these reads, its changed version prevents a mixed response overwriting it.
        List<Map<String, Object>> facilityRows = jdbc.queryForList("SELECT * FROM FACILITY" + where + " ORDER BY FACILITY_ID", args);
        List<Map<String, Object>> hours = jdbc.queryForList("SELECT * FROM FACILITY_HOURS" + where + " ORDER BY FACILITY_ID,WEEKDAY_NO", args);
        List<Map<String, Object>> purposes = jdbc.queryForList("SELECT * FROM FACILITY_PURPOSE" + where + " ORDER BY FACILITY_ID,PURPOSE_ID", args);
        List<Map<String, Object>> blocks = jdbc.queryForList("SELECT * FROM FACILITY_BLOCK" + where + " ORDER BY FACILITY_ID,BLOCK_START_AT,BLOCK_ID", args);
        List<Map<String, Object>> requests = jdbc.queryForList("SELECT FACILITY_ID,COUNT(*) AS HISTORY_COUNT,SUM(CASE WHEN STATUS_CODE IN ('PENDING','APPROVED','IN_USE') THEN 1 ELSE 0 END) AS ACTIVE_COUNT FROM REQUEST_ITEM WHERE FACILITY_ID IS NOT NULL" +
                (selectedId == null ? "" : " AND FACILITY_ID=?") + " GROUP BY FACILITY_ID", args);
        Map<Long, Map<String, Object>> counts = new HashMap<>();
        requests.forEach(row -> counts.put(num(row.get("FACILITY_ID")), row));
        List<Map<String, Object>> result = new ArrayList<>();
        for (Map<String, Object> row : facilityRows) {
            long id = num(row.get("FACILITY_ID"));
            Map<String, Object> item = new LinkedHashMap<>();
            item.put("id", String.valueOf(id));
            item.put("publicId", CatalogService.publicId("F", id, str(row.get("FACILITY_CODE"))));
            item.put("code", str(row.get("FACILITY_CODE")));
            item.put("name", str(row.get("FACILITY_NAME")));
            item.put("type", str(row.get("FACILITY_TYPE")));
            item.put("location", str(row.get("LOCATION_TEXT")));
            item.put("capacity", num(row.get("CAPACITY")));
            item.put("fixedEquipmentInfo", str(row.get("FIXED_EQUIPMENT_INFO")));
            item.put("useAllowed", "Y".equals(row.get("USE_ALLOWED_YN")));
            item.put("status", str(row.get("OPERATING_STATUS")));
            item.put("isDemo", "Y".equals(row.get("IS_DEMO_YN")));
            item.put("version", num(row.get("ROW_VERSION")));
            item.put("activeRequests", num(counts.getOrDefault(id, Map.of()).get("ACTIVE_COUNT")));
            item.put("hasHistory", num(counts.getOrDefault(id, Map.of()).get("HISTORY_COUNT")) > 0);
            Map<String, Object> days = new LinkedHashMap<>();
            hours.stream().filter(h -> num(h.get("FACILITY_ID")) == id).forEach(h -> days.put(
                    str(h.get("WEEKDAY_NO")), List.of(str(h.get("OPEN_TIME")), str(h.get("CLOSE_TIME")))));
            item.put("hoursByWeekday", days);
            item.put("purposeIds", purposes.stream().filter(p -> num(p.get("FACILITY_ID")) == id).map(p -> str(p.get("PURPOSE_ID"))).toList());
            item.put("blocks", blocks.stream().filter(b -> num(b.get("FACILITY_ID")) == id).map(b -> Map.<String, Object>of(
                    "id", str(b.get("BLOCK_ID")), "start", time(b.get("BLOCK_START_AT")), "end", time(b.get("BLOCK_END_AT")),
                    "reason", str(b.get("REASON_TEXT")), "registeredBy", str(b.get("REGISTERED_BY")), "createdAt", time(b.get("CREATED_AT")))).toList());
            result.add(item);
        }
        return result;
    }

    private Map<String, Object> response(long id) { return Map.of("facility", facilities(id).getFirst()); }
    private LocalDateTime dateTime(Object value) {
        return value instanceof Timestamp timestamp ? timestamp.toLocalDateTime() : LocalDateTime.parse(str(value));
    }
    private long next(String sequence) { return jdbc.queryForObject("SELECT " + sequence + ".NEXTVAL FROM DUAL", Long.class); }
    private String yn(boolean value) { return value ? "Y" : "N"; }
    private ResponseStatusException notFound(String label) {
        return new ResponseStatusException(HttpStatus.NOT_FOUND, label + "을(를) 찾을 수 없습니다.");
    }
}
