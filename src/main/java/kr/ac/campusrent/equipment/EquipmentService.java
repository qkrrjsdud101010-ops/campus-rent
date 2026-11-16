package kr.ac.campusrent.equipment;

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
import org.springframework.dao.DuplicateKeyException;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;
import static kr.ac.campusrent.catalog.CatalogService.num;
import static kr.ac.campusrent.catalog.CatalogService.str;
import static kr.ac.campusrent.rental.RentalPolicy.bad;
import static kr.ac.campusrent.rental.RentalPolicy.conflict;

@Service
public class EquipmentService {
    private final JdbcTemplate jdbc;

    public EquipmentService(JdbcTemplate jdbc) { this.jdbc = jdbc; }

    public Map<String, Object> list(CurrentUser user) {
        AuthSupport.requireRole(user, "admin");
        List<Map<String, Object>> types = jdbc.queryForList(
                "SELECT * FROM EQUIPMENT_TYPE ORDER BY TYPE_ID").stream().map(this::typeView).toList();
        return Map.of("equipment", equipment(null), "types", types, "models", models(null));
    }

    @Transactional
    public Map<String, Object> createType(CurrentUser user, Map<String, Object> input) {
        AuthSupport.requireRole(user, "admin");
        String name = EquipmentPolicy.requiredText(input.get("name"), 50, "품목명");
        String category = EquipmentPolicy.requiredText(input.get("category"), 50, "분류명");
        try {
            long id = next("SQ_EQUIPMENT_TYPE");
            jdbc.update("INSERT INTO EQUIPMENT_TYPE(TYPE_ID,TYPE_NAME,CATEGORY_LABEL,ENABLED_YN) VALUES(?,?,?,'Y')",
                    id, name, category);
            return Map.of("type", typeView(jdbc.queryForMap("SELECT * FROM EQUIPMENT_TYPE WHERE TYPE_ID=?", id)));
        } catch (DuplicateKeyException error) {
            throw conflict("이미 등록된 품목명입니다. 기존 품목을 선택하거나 이름을 확인해주세요.");
        }
    }

    @Transactional
    public Map<String, Object> createModel(CurrentUser user, Map<String, Object> input) {
        AuthSupport.requireRole(user, "admin");
        EquipmentPolicy.Model model = EquipmentPolicy.model(input);
        // Serialize specification-name registration for models of the same type.
        List<Map<String, Object>> types = jdbc.queryForList(
                "SELECT * FROM EQUIPMENT_TYPE WHERE TYPE_ID=? FOR UPDATE", model.typeId());
        if (types.isEmpty()) throw notFound("장비 품목");
        if (!"Y".equals(types.getFirst().get("ENABLED_YN"))) throw conflict("사용 중인 품목을 선택해주세요.");
        try {
            long modelId = next("SQ_EQUIPMENT_MODEL");
            jdbc.update("INSERT INTO EQUIPMENT_MODEL(MODEL_ID,TYPE_ID,MODEL_CODE,MODEL_NAME,MANUFACTURER,IS_DEMO_YN) VALUES(?,?,?,?,?,?)",
                    modelId, model.typeId(), model.code(), model.name(), model.manufacturer(), yn(model.isDemo()));
            int order = 0;
            for (EquipmentPolicy.Spec spec : model.specs()) {
                List<Map<String, Object>> existing = jdbc.queryForList(
                        "SELECT SPEC_ITEM_ID FROM SPEC_ITEM WHERE TYPE_ID=? AND SPEC_NAME=?", model.typeId(), spec.name());
                long specId;
                if (existing.isEmpty()) {
                    specId = next("SQ_SPEC_ITEM");
                    jdbc.update("INSERT INTO SPEC_ITEM(SPEC_ITEM_ID,TYPE_ID,SPEC_NAME,DEFAULT_UNIT,DISPLAY_ORDER) VALUES(?,?,?,?,?)",
                            specId, model.typeId(), spec.name(), spec.unit(), order);
                } else {
                    specId = num(existing.getFirst().get("SPEC_ITEM_ID"));
                }
                jdbc.update("INSERT INTO MODEL_SPEC(MODEL_ID,SPEC_ITEM_ID,SPEC_VALUE,VALUE_UNIT,VERIFY_STATUS) VALUES(?,?,?,?,?)",
                        modelId, specId, spec.value(), spec.unit(), spec.verified() ? "VERIFIED" : "UNVERIFIED");
                order++;
            }
            return Map.of("model", models(modelId).getFirst());
        } catch (DuplicateKeyException error) {
            throw conflict("이미 등록된 모델 코드 또는 사양입니다. 최신 목록을 확인해주세요.");
        }
    }

    @Transactional
    public Map<String, Object> create(CurrentUser user, Map<String, Object> input) {
        AuthSupport.requireRole(user, "admin");
        EquipmentPolicy.Equipment draft = EquipmentPolicy.equipment(input, false);
        verifyModel(draft.modelId(), draft.lendAllowed());
        if (draft.components().stream().anyMatch(component -> component.id() != null))
            throw bad("새 장비의 구성품에는 기존 식별자를 사용할 수 없습니다.");
        if (!"NORMAL".equals(draft.status())) requireConfirmation(draft);
        try {
            long id = next("SQ_EQUIPMENT");
            jdbc.update("INSERT INTO EQUIPMENT(EQUIPMENT_ID,MODEL_ID,ASSET_CODE,EQUIPMENT_NAME,STORAGE_LOCATION,DEPARTMENT_NAME,LEND_ALLOWED_YN,OPERATING_STATUS,IS_DEMO_YN) VALUES(?,?,?,?,?,?,?,?,?)",
                    id, draft.modelId(), draft.code(), draft.name(), draft.location(), draft.department(),
                    yn(draft.lendAllowed()), draft.status(), yn(draft.isDemo()));
            saveComponents(id, draft.components());
            String action = "CHECKING".equals(draft.status()) ? "CHECK_REQUIRED" : "STATUS_CHANGED";
            log(id, user, action, "NORMAL", draft.status(),
                    draft.reason().isBlank() ? "장비 최초 등록" : draft.reason());
            return Map.of("equipment", equipment(id).getFirst());
        } catch (DuplicateKeyException error) {
            throw conflict("이미 등록된 개별 관리번호입니다. 기존 장비를 확인해주세요.");
        }
    }

    @Transactional
    public Map<String, Object> update(CurrentUser user, long id, Map<String, Object> input) {
        AuthSupport.requireRole(user, "admin");
        if (id < 1) throw bad("장비 식별자를 확인해주세요.");
        EquipmentPolicy.Equipment draft = EquipmentPolicy.equipment(input, true);
        List<Map<String, Object>> locked = jdbc.queryForList("SELECT * FROM EQUIPMENT WHERE EQUIPMENT_ID=? FOR UPDATE", id);
        if (locked.isEmpty()) throw notFound("장비");
        Map<String, Object> current = locked.getFirst();
        if (draft.expectedVersion() != num(current.get("ROW_VERSION")))
            throw conflict("다른 창에서 장비 정보가 변경되었습니다. 최신 목록을 다시 불러와주세요.");
        if (!draft.code().equals(str(current.get("ASSET_CODE"))))
            throw bad("등록된 개별 관리번호는 변경할 수 없습니다.");
        verifyModel(draft.modelId(), draft.lendAllowed());
        List<Map<String, Object>> originalComponents = componentRows(id);
        verifyComponentIds(draft.components(), originalComponents);
        boolean componentsChanged = componentsChanged(draft.components(), originalComponents);
        boolean modelChanged = draft.modelId() != num(current.get("MODEL_ID"));
        if ((componentsChanged || modelChanged) && activeRequests(id) > 0)
            throw conflict("진행 중인 신청이 있어 모델과 기본 구성품을 변경할 수 없습니다. 관련 신청 처리를 먼저 완료해주세요.");

        String oldStatus = str(current.get("OPERATING_STATUS"));
        boolean statusChanged = !oldStatus.equals(draft.status());
        boolean lendingChanged = !yn(draft.lendAllowed()).equals(current.get("LEND_ALLOWED_YN"));
        if (statusChanged || lendingChanged) requireConfirmation(draft);
        if (statusChanged && "NORMAL".equals(draft.status())) verifyNormalRestoration(id);

        try {
            int changed = jdbc.update("UPDATE EQUIPMENT SET MODEL_ID=?,EQUIPMENT_NAME=?,STORAGE_LOCATION=?,DEPARTMENT_NAME=?,LEND_ALLOWED_YN=?,OPERATING_STATUS=?,IS_DEMO_YN=?,ROW_VERSION=ROW_VERSION+1 WHERE EQUIPMENT_ID=? AND ROW_VERSION=?",
                    draft.modelId(), draft.name(), draft.location(), draft.department(), yn(draft.lendAllowed()),
                    draft.status(), yn(draft.isDemo()), id, draft.expectedVersion());
            if (changed != 1) throw conflict("최신 장비 정보를 다시 확인해주세요.");
            if (componentsChanged) {
                // Only the editable master definition changes. Checkout snapshots are separate rows.
                jdbc.update("DELETE FROM EQUIPMENT_COMPONENT WHERE EQUIPMENT_ID=?", id);
                saveComponents(id, draft.components());
            }
            String action = statusChanged && "CHECKING".equals(draft.status()) ? "CHECK_REQUIRED" :
                    statusChanged && "NORMAL".equals(draft.status()) ? "CHECK_COMPLETED" : "STATUS_CHANGED";
            log(id, user, action, oldStatus, draft.status(),
                    draft.reason().isBlank() ? "장비 기본 정보 수정" : draft.reason());
            return Map.of("equipment", equipment(id).getFirst());
        } catch (DuplicateKeyException error) {
            throw conflict("중복된 장비 정보가 있습니다. 최신 목록을 확인해주세요.");
        }
    }

    private void verifyModel(long modelId, boolean lendAllowed) {
        List<Map<String, Object>> rows = jdbc.queryForList(
                "SELECT T.ENABLED_YN FROM EQUIPMENT_MODEL M JOIN EQUIPMENT_TYPE T ON T.TYPE_ID=M.TYPE_ID WHERE M.MODEL_ID=?", modelId);
        if (rows.isEmpty()) throw notFound("장비 모델");
        if (lendAllowed && !"Y".equals(rows.getFirst().get("ENABLED_YN")))
            throw conflict("사용 중지된 품목의 장비는 대여를 허용할 수 없습니다.");
    }

    private void requireConfirmation(EquipmentPolicy.Equipment draft) {
        if (!draft.confirmed() || draft.reason().isBlank())
            throw bad("운영 상태·대여 허용 변경의 실제 확인과 사유를 입력해주세요.");
    }

    private void verifyNormalRestoration(long id) {
        Long outstanding = jdbc.queryForObject("SELECT COUNT(*) FROM REQUEST_ITEM WHERE EQUIPMENT_ID=? AND STATUS_CODE IN ('CHECKED_OUT','RETURN_REQUESTED','RETURN_HELD')",
                Long.class, id);
        if (outstanding != null && outstanding > 0)
            throw conflict("출고 장비의 반환 확인을 먼저 완료해주세요. 미해결 상태에서 정상으로 변경할 수 없습니다.");
        // Rental-linked checks remain pending across disabling. A pre-checkout manual check
        // has no preserved checkout and can be completed here once there is no outstanding return.
        Map<String, Object> checks = jdbc.queryForMap(
                "SELECT NVL(MAX(CASE WHEN L.ACTION_CODE='CHECK_REQUIRED' AND C.CHECKOUT_ID IS NOT NULL THEN L.CHECK_LOG_ID END),0) AS REQUIRED_ID, " +
                        "NVL(MAX(CASE WHEN L.ACTION_CODE='CHECK_COMPLETED' THEN L.CHECK_LOG_ID END),0) AS COMPLETED_ID " +
                        "FROM EQUIPMENT_CHECK_LOG L LEFT JOIN EQUIPMENT_CHECKOUT C ON C.REQUEST_ITEM_ID=L.RELATED_ITEM_ID WHERE L.EQUIPMENT_ID=?", id);
        if (num(checks.get("REQUIRED_ID")) > num(checks.get("COMPLETED_ID")))
            throw conflict("반납과 연결된 점검이 남아 있습니다. 신청 관리에서 점검 완료를 확인해주세요.");
    }

    private long activeRequests(long id) {
        Long count = jdbc.queryForObject("SELECT COUNT(*) FROM REQUEST_ITEM WHERE EQUIPMENT_ID=? AND STATUS_CODE NOT IN ('RETURNED','REJECTED','CANCELLED')",
                Long.class, id);
        return count == null ? 0 : count;
    }

    private void verifyComponentIds(List<EquipmentPolicy.Component> submitted, List<Map<String, Object>> existing) {
        Set<Long> allowed = new HashSet<>();
        existing.forEach(component -> allowed.add(num(component.get("COMPONENT_ID"))));
        for (EquipmentPolicy.Component component : submitted)
            if (component.id() != null && !allowed.contains(component.id()))
                throw bad("다른 장비 또는 변경 전 구성품의 식별자가 포함되어 있습니다. 최신 목록을 확인해주세요.");
    }

    private boolean componentsChanged(List<EquipmentPolicy.Component> submitted, List<Map<String, Object>> existing) {
        if (submitted.size() != existing.size()) return true;
        for (int index = 0; index < submitted.size(); index++) {
            EquipmentPolicy.Component component = submitted.get(index);
            Map<String, Object> original = existing.get(index);
            if (!component.name().equals(str(original.get("COMPONENT_NAME"))) ||
                    component.quantity() != num(original.get("REQUIRED_QTY")) ||
                    !yn(component.body()).equals(original.get("BODY_YN")) ||
                    !yn(component.required()).equals(original.get("REQUIRED_YN"))) return true;
        }
        return false;
    }

    private void saveComponents(long equipmentId, List<EquipmentPolicy.Component> components) {
        int order = 1;
        for (EquipmentPolicy.Component component : components) {
            long id = component.id() == null ? next("SQ_EQUIPMENT_COMPONENT") : component.id();
            jdbc.update("INSERT INTO EQUIPMENT_COMPONENT(COMPONENT_ID,EQUIPMENT_ID,COMPONENT_NAME,REQUIRED_QTY,BODY_YN,REQUIRED_YN,DISPLAY_ORDER) VALUES(?,?,?,?,?,?,?)",
                    id, equipmentId, component.name(), component.quantity(), yn(component.body()), yn(component.required()), order++);
        }
    }

    private List<Map<String, Object>> componentRows(long equipmentId) {
        return jdbc.queryForList("SELECT * FROM EQUIPMENT_COMPONENT WHERE EQUIPMENT_ID=? ORDER BY DISPLAY_ORDER,COMPONENT_ID", equipmentId);
    }

    private List<Map<String, Object>> equipment(Long equipmentId) {
        Object[] arguments = equipmentId == null ? new Object[]{} : new Object[]{equipmentId};
        String where = equipmentId == null ? "" : " WHERE EQUIPMENT_ID=?";
        List<Map<String, Object>> components = jdbc.queryForList(
                "SELECT * FROM EQUIPMENT_COMPONENT" + where + " ORDER BY EQUIPMENT_ID,DISPLAY_ORDER,COMPONENT_ID", arguments);
        List<Map<String, Object>> requests = jdbc.queryForList(
                "SELECT EQUIPMENT_ID,COUNT(*) AS HISTORY_COUNT,SUM(CASE WHEN STATUS_CODE NOT IN ('RETURNED','REJECTED','CANCELLED') THEN 1 ELSE 0 END) AS ACTIVE_COUNT FROM REQUEST_ITEM WHERE EQUIPMENT_ID IS NOT NULL" +
                        (equipmentId == null ? "" : " AND EQUIPMENT_ID=?") + " GROUP BY EQUIPMENT_ID", arguments);
        Map<Long, Map<String, Object>> counts = new HashMap<>();
        requests.forEach(row -> counts.put(num(row.get("EQUIPMENT_ID")), row));
        List<Map<String, Object>> result = new ArrayList<>();
        for (Map<String, Object> row : jdbc.queryForList("SELECT * FROM EQUIPMENT" + where + " ORDER BY EQUIPMENT_ID", arguments)) {
            long id = num(row.get("EQUIPMENT_ID"));
            Map<String, Object> item = new LinkedHashMap<>();
            item.put("id", String.valueOf(id));
            item.put("publicId", CatalogService.publicId("E", id, str(row.get("ASSET_CODE"))));
            item.put("modelId", str(row.get("MODEL_ID")));
            item.put("code", str(row.get("ASSET_CODE")));
            item.put("name", str(row.get("EQUIPMENT_NAME")));
            item.put("location", str(row.get("STORAGE_LOCATION")));
            item.put("department", str(row.get("DEPARTMENT_NAME")));
            item.put("lendAllowed", "Y".equals(row.get("LEND_ALLOWED_YN")));
            item.put("status", str(row.get("OPERATING_STATUS")));
            item.put("isDemo", "Y".equals(row.get("IS_DEMO_YN")));
            item.put("version", num(row.get("ROW_VERSION")));
            Map<String, Object> requestCount = counts.getOrDefault(id, Map.of());
            item.put("activeRequests", num(requestCount.get("ACTIVE_COUNT")));
            item.put("hasHistory", num(requestCount.get("HISTORY_COUNT")) > 0);
            List<Map<String, Object>> definitions = new ArrayList<>();
            for (Map<String, Object> component : components) {
                if (num(component.get("EQUIPMENT_ID")) == id) definitions.add(Map.of(
                        "id", str(component.get("COMPONENT_ID")), "name", str(component.get("COMPONENT_NAME")),
                        "quantity", num(component.get("REQUIRED_QTY")), "body", "Y".equals(component.get("BODY_YN")),
                        "required", "Y".equals(component.get("REQUIRED_YN"))));
            }
            item.put("components", definitions);
            result.add(item);
        }
        return result;
    }

    private List<Map<String, Object>> models(Long modelId) {
        Object[] arguments = modelId == null ? new Object[]{} : new Object[]{modelId};
        List<Map<String, Object>> specs = jdbc.queryForList(
                "SELECT M.*,S.SPEC_NAME FROM MODEL_SPEC M JOIN SPEC_ITEM S ON S.SPEC_ITEM_ID=M.SPEC_ITEM_ID" +
                        (modelId == null ? "" : " WHERE M.MODEL_ID=?") + " ORDER BY S.DISPLAY_ORDER,S.SPEC_ITEM_ID", arguments);
        List<Map<String, Object>> result = new ArrayList<>();
        for (Map<String, Object> row : jdbc.queryForList("SELECT * FROM EQUIPMENT_MODEL" +
                (modelId == null ? "" : " WHERE MODEL_ID=?") + " ORDER BY MODEL_ID", arguments)) {
            long id = num(row.get("MODEL_ID"));
            List<Map<String, Object>> values = new ArrayList<>();
            for (Map<String, Object> spec : specs) {
                if (num(spec.get("MODEL_ID")) == id) values.add(Map.of(
                        "name", str(spec.get("SPEC_NAME")), "value", str(spec.get("SPEC_VALUE")),
                        "unit", str(spec.get("VALUE_UNIT")), "verified", "VERIFIED".equals(spec.get("VERIFY_STATUS"))));
            }
            result.add(Map.of("id", String.valueOf(id), "typeId", str(row.get("TYPE_ID")),
                    "code", str(row.get("MODEL_CODE")), "name", str(row.get("MODEL_NAME")),
                    "manufacturer", str(row.get("MANUFACTURER")), "isDemo", "Y".equals(row.get("IS_DEMO_YN")),
                    "specs", values));
        }
        return result;
    }

    private Map<String, Object> typeView(Map<String, Object> row) {
        return Map.of("id", str(row.get("TYPE_ID")), "name", str(row.get("TYPE_NAME")),
                "category", str(row.get("CATEGORY_LABEL")), "enabled", "Y".equals(row.get("ENABLED_YN")));
    }

    private void log(long id, CurrentUser actor, String action, String from, String to, String reason) {
        jdbc.update("INSERT INTO EQUIPMENT_CHECK_LOG(CHECK_LOG_ID,EQUIPMENT_ID,ACTION_CODE,FROM_STATUS,TO_STATUS,REASON_TEXT,CHECKED_BY) VALUES(?,?,?,?,?,?,?)",
                next("SQ_EQUIPMENT_CHECK_LOG"), id, action, from, to, reason, Long.parseLong(actor.id()));
    }

    private long next(String sequence) {
        return jdbc.queryForObject("SELECT " + sequence + ".NEXTVAL FROM DUAL", Long.class);
    }

    private String yn(boolean value) { return value ? "Y" : "N"; }

    private ResponseStatusException notFound(String subject) {
        return new ResponseStatusException(HttpStatus.NOT_FOUND, subject + " 정보를 찾을 수 없습니다.");
    }
}
