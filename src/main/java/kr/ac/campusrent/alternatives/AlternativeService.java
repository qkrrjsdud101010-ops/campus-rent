package kr.ac.campusrent.alternatives;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import kr.ac.campusrent.auth.AuthSupport;
import kr.ac.campusrent.auth.CurrentUser;
import kr.ac.campusrent.catalog.CatalogService;
import org.springframework.dao.DataIntegrityViolationException;
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
public class AlternativeService {
    private final JdbcTemplate jdbc;

    public AlternativeService(JdbcTemplate jdbc) { this.jdbc = jdbc; }

    public Map<String, Object> list(CurrentUser user) {
        AuthSupport.requireRole(user, "admin");
        return snapshot();
    }

    @Transactional
    public Map<String, Object> update(CurrentUser user, long sourceId, Map<String, Object> input) {
        AuthSupport.requireRole(user, "admin");
        AlternativePolicy.Configuration draft = AlternativePolicy.configuration(sourceId, input);
        if (sourceId < 1 || sourceId > 9_999_999_999L) throw notFound();
        // Equipment editing, rental handling and replacement configuration share this parent lock/version.
        List<Map<String, Object>> sources = jdbc.queryForList("SELECT * FROM EQUIPMENT WHERE EQUIPMENT_ID=? FOR UPDATE", sourceId);
        if (sources.isEmpty()) throw notFound();
        if (num(sources.getFirst().get("ROW_VERSION")) != draft.expectedVersion())
            throw conflict("원래 장비 또는 대체 관계가 변경되었습니다. 최신 목록을 다시 불러와주세요.");

        Set<Long> equipmentIds = new HashSet<>();
        for (Map<String, Object> row : jdbc.queryForList("SELECT EQUIPMENT_ID FROM EQUIPMENT ORDER BY EQUIPMENT_ID"))
            equipmentIds.add(num(row.get("EQUIPMENT_ID")));
        for (AlternativePolicy.Alternative alternative : draft.alternatives())
            if (!equipmentIds.contains(alternative.targetId())) throw bad("존재하는 대체 장비를 선택해주세요.");

        Map<Long, Map<String, Object>> existing = new HashMap<>();
        for (Map<String, Object> row : jdbc.queryForList("SELECT * FROM EQUIPMENT_ALTERNATIVE WHERE SOURCE_EQUIPMENT_ID=? ORDER BY TARGET_EQUIPMENT_ID", sourceId))
            existing.put(num(row.get("TARGET_EQUIPMENT_ID")), row);
        Set<Long> submitted = new HashSet<>();
        List<AlternativePolicy.Alternative> changed = new ArrayList<>();
        for (AlternativePolicy.Alternative alternative : draft.alternatives()) {
            submitted.add(alternative.targetId());
            Map<String, Object> old = existing.get(alternative.targetId());
            if (old == null || !same(alternative, old)) changed.add(alternative);
        }
        List<Long> omitted = existing.entrySet().stream()
                .filter(entry -> !submitted.contains(entry.getKey()) && "Y".equals(entry.getValue().get("ENABLED_YN")))
                .map(Map.Entry::getKey).sorted().toList();

        if (!changed.isEmpty() || !omitted.isEmpty()) {
            if (draft.expectedVersion() == 9_999_999_999L) throw conflict("장비 변경 버전을 확인해야 합니다.");
            if (jdbc.update("UPDATE EQUIPMENT SET ROW_VERSION=ROW_VERSION+1 WHERE EQUIPMENT_ID=? AND ROW_VERSION=?",
                    sourceId, draft.expectedVersion()) != 1) throw conflict("최신 장비 정보를 다시 확인해주세요.");
            long actor = Long.parseLong(user.id());
            try {
                for (AlternativePolicy.Alternative alternative : changed) {
                    if (existing.containsKey(alternative.targetId())) {
                        // CREATED_AT retains first registration time; only real changes replace the latest configurator.
                        requireChanged(jdbc.update("UPDATE EQUIPMENT_ALTERNATIVE SET REASON_TEXT=?,DIFFERENCE_TEXT=?,ENABLED_YN=?,CONFIGURED_BY=? WHERE SOURCE_EQUIPMENT_ID=? AND TARGET_EQUIPMENT_ID=?",
                                alternative.reason(), alternative.difference(), yn(alternative.enabled()), actor, sourceId, alternative.targetId()));
                    } else {
                        requireChanged(jdbc.update("INSERT INTO EQUIPMENT_ALTERNATIVE(SOURCE_EQUIPMENT_ID,TARGET_EQUIPMENT_ID,REASON_TEXT,DIFFERENCE_TEXT,ENABLED_YN,CONFIGURED_BY) VALUES(?,?,?,?,?,?)",
                                sourceId, alternative.targetId(), alternative.reason(), alternative.difference(), yn(alternative.enabled()), actor));
                    }
                }
                // Missing rows are kept for review and can later be enabled again.
                for (long targetId : omitted)
                    requireChanged(jdbc.update("UPDATE EQUIPMENT_ALTERNATIVE SET ENABLED_YN='N',CONFIGURED_BY=? WHERE SOURCE_EQUIPMENT_ID=? AND TARGET_EQUIPMENT_ID=?",
                            actor, sourceId, targetId));
            } catch (DataIntegrityViolationException error) {
                throw conflict("장비 또는 대체 관계가 변경되었습니다. 최신 목록을 다시 불러와주세요.");
            }
        }
        Map<String, Object> result = new LinkedHashMap<>(snapshot());
        result.put("sourceId", String.valueOf(sourceId));
        return result;
    }

    private boolean same(AlternativePolicy.Alternative submitted, Map<String, Object> existing) {
        return submitted.reason().equals(str(existing.get("REASON_TEXT"))) &&
                submitted.difference().equals(str(existing.get("DIFFERENCE_TEXT"))) &&
                yn(submitted.enabled()).equals(existing.get("ENABLED_YN"));
    }

    private void requireChanged(int changed) {
        if (changed != 1) throw conflict("대체 관계가 변경되었습니다. 최신 목록을 다시 불러와주세요.");
    }

    private Map<String, Object> snapshot() {
        // Parent versions must be captured first, before a concurrent editor could replace the child relations.
        List<Map<String, Object>> equipment = jdbc.queryForList("SELECT E.*,M.MODEL_NAME,M.TYPE_ID,T.TYPE_NAME FROM EQUIPMENT E JOIN EQUIPMENT_MODEL M ON M.MODEL_ID=E.MODEL_ID JOIN EQUIPMENT_TYPE T ON T.TYPE_ID=M.TYPE_ID ORDER BY E.EQUIPMENT_ID")
                .stream().map(row -> {
                    Map<String, Object> item = new LinkedHashMap<>();
                    long id = num(row.get("EQUIPMENT_ID"));
                    item.put("id", String.valueOf(id));
                    item.put("publicId", CatalogService.publicId("E", id, str(row.get("ASSET_CODE"))));
                    item.put("code", str(row.get("ASSET_CODE")));
                    item.put("name", str(row.get("EQUIPMENT_NAME")));
                    item.put("modelId", str(row.get("MODEL_ID")));
                    item.put("modelName", str(row.get("MODEL_NAME")));
                    item.put("typeId", str(row.get("TYPE_ID")));
                    item.put("typeName", str(row.get("TYPE_NAME")));
                    item.put("status", str(row.get("OPERATING_STATUS")));
                    item.put("lendAllowed", "Y".equals(row.get("LEND_ALLOWED_YN")));
                    item.put("isDemo", "Y".equals(row.get("IS_DEMO_YN")));
                    item.put("version", num(row.get("ROW_VERSION")));
                    return item;
                }).toList();
        List<Map<String, Object>> alternatives = jdbc.queryForList("SELECT * FROM EQUIPMENT_ALTERNATIVE ORDER BY SOURCE_EQUIPMENT_ID,TARGET_EQUIPMENT_ID")
                .stream().map(row -> {
                    Map<String, Object> item = new LinkedHashMap<>();
                    item.put("sourceId", str(row.get("SOURCE_EQUIPMENT_ID")));
                    item.put("targetId", str(row.get("TARGET_EQUIPMENT_ID")));
                    item.put("reason", str(row.get("REASON_TEXT")));
                    item.put("difference", str(row.get("DIFFERENCE_TEXT")));
                    item.put("enabled", "Y".equals(row.get("ENABLED_YN")));
                    item.put("configuredBy", str(row.get("CONFIGURED_BY")));
                    item.put("createdAt", time(row.get("CREATED_AT")));
                    return item;
                }).toList();
        return Map.of("equipment", equipment, "alternatives", alternatives);
    }

    private String yn(boolean value) { return value ? "Y" : "N"; }
    private ResponseStatusException notFound() { return new ResponseStatusException(HttpStatus.NOT_FOUND, "원래 장비를 찾을 수 없습니다."); }
}
