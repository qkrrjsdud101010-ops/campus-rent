package kr.ac.campusrent.equipment;

import java.util.HashMap;
import java.util.List;
import java.util.Map;
import kr.ac.campusrent.auth.CurrentUser;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.web.server.ResponseStatusException;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

class EquipmentServiceTest {
    private final JdbcTemplate jdbc = mock(JdbcTemplate.class);
    private final EquipmentService equipment = new EquipmentService(jdbc);
    private final CurrentUser admin = new CurrentUser("7", "관리자", "admin@example.invalid", "admin");

    private Map<String, Object> draft() {
        Map<String, Object> input = new HashMap<>();
        input.put("modelId", "2"); input.put("code", "EQ-1"); input.put("name", "카메라");
        input.put("location", "보관실"); input.put("department", "미디어실");
        input.put("lendAllowed", true); input.put("status", "NORMAL"); input.put("isDemo", true);
        input.put("reason", "실물 확인"); input.put("confirmed", true); input.put("expectedVersion", 5);
        input.put("components", List.of(Map.of("id", "11", "name", "본체", "quantity", 1, "body", true, "required", true)));
        return input;
    }

    private void stored(String status) {
        when(jdbc.queryForList("SELECT * FROM EQUIPMENT WHERE EQUIPMENT_ID=? FOR UPDATE", 1L))
                .thenReturn(List.of(Map.of("ROW_VERSION", 5, "ASSET_CODE", "EQ-1", "MODEL_ID", 2,
                        "OPERATING_STATUS", status, "LEND_ALLOWED_YN", "Y")));
        when(jdbc.queryForList("SELECT T.ENABLED_YN FROM EQUIPMENT_MODEL M JOIN EQUIPMENT_TYPE T ON T.TYPE_ID=M.TYPE_ID WHERE M.MODEL_ID=?", 2L))
                .thenReturn(List.of(Map.of("ENABLED_YN", "Y")));
        when(jdbc.queryForList("SELECT * FROM EQUIPMENT_COMPONENT WHERE EQUIPMENT_ID=? ORDER BY DISPLAY_ORDER,COMPONENT_ID", 1L))
                .thenReturn(List.of(Map.of("COMPONENT_ID", 11, "COMPONENT_NAME", "본체", "REQUIRED_QTY", 1, "BODY_YN", "Y", "REQUIRED_YN", "Y")));
    }

    @Test void studentsCannotReadManagementData() {
        var student = new CurrentUser("8", "학생", "student@example.invalid", "student");
        var error = assertThrows(ResponseStatusException.class, () -> equipment.list(student));
        assertEquals(403, error.getStatusCode().value());
        verifyNoInteractions(jdbc);
    }

    @Test void staleVersionCannotOverwriteCurrentMetadata() {
        stored("NORMAL");
        var input = draft(); input.put("expectedVersion", 4);
        var error = assertThrows(ResponseStatusException.class, () -> equipment.update(admin, 1, input));
        assertEquals(409, error.getStatusCode().value());
        verify(jdbc, never()).update(anyString(), any(Object[].class));
    }

    @Test void disablingAndReenablingCannotBypassOutstandingReturn() {
        stored("DISABLED");
        when(jdbc.queryForObject("SELECT COUNT(*) FROM REQUEST_ITEM WHERE EQUIPMENT_ID=? AND STATUS_CODE IN ('CHECKED_OUT','RETURN_REQUESTED','RETURN_HELD')", Long.class, 1L))
                .thenReturn(1L);
        var error = assertThrows(ResponseStatusException.class, () -> equipment.update(admin, 1, draft()));
        assertEquals(409, error.getStatusCode().value());
        verify(jdbc, never()).update(anyString(), any(Object[].class));
    }

    @Test void fullReturnStillRequiresOutstandingRentalInspectionToBeCompleted() {
        stored("DISABLED");
        when(jdbc.queryForObject("SELECT COUNT(*) FROM REQUEST_ITEM WHERE EQUIPMENT_ID=? AND STATUS_CODE IN ('CHECKED_OUT','RETURN_REQUESTED','RETURN_HELD')", Long.class, 1L))
                .thenReturn(0L);
        when(jdbc.queryForMap(startsWith("SELECT NVL(MAX(CASE WHEN L.ACTION_CODE='CHECK_REQUIRED'"), eq(1L)))
                .thenReturn(Map.of("REQUIRED_ID", 10, "COMPLETED_ID", 8));
        var error = assertThrows(ResponseStatusException.class, () -> equipment.update(admin, 1, draft()));
        assertEquals(409, error.getStatusCode().value());
        verify(jdbc, never()).update(anyString(), any(Object[].class));
    }

    @Test void pendingOrApprovedRequestsKeepTheirModelAndComponentDefinition() {
        stored("NORMAL");
        when(jdbc.queryForObject("SELECT COUNT(*) FROM REQUEST_ITEM WHERE EQUIPMENT_ID=? AND STATUS_CODE NOT IN ('RETURNED','REJECTED','CANCELLED')", Long.class, 1L))
                .thenReturn(1L);
        var input = draft();
        input.put("components", List.of(Map.of("id", "11", "name", "새 본체", "quantity", 1, "body", true, "required", true)));
        var error = assertThrows(ResponseStatusException.class, () -> equipment.update(admin, 1, input));
        assertEquals(409, error.getStatusCode().value());
        verify(jdbc, never()).update(anyString(), any(Object[].class));
    }

    @Test void manualPreCheckoutInspectionCanBeCompletedAfterRequestCancellation() {
        stored("CHECKING");
        when(jdbc.queryForObject("SELECT COUNT(*) FROM REQUEST_ITEM WHERE EQUIPMENT_ID=? AND STATUS_CODE IN ('CHECKED_OUT','RETURN_REQUESTED','RETURN_HELD')", Long.class, 1L))
                .thenReturn(0L);
        when(jdbc.queryForMap(startsWith("SELECT NVL(MAX(CASE WHEN L.ACTION_CODE='CHECK_REQUIRED'"), eq(1L)))
                .thenReturn(Map.of("REQUIRED_ID", 0, "COMPLETED_ID", 0));
        when(jdbc.update(startsWith("UPDATE EQUIPMENT SET MODEL_ID=?"), any(Object[].class))).thenReturn(1);
        when(jdbc.queryForObject("SELECT SQ_EQUIPMENT_CHECK_LOG.NEXTVAL FROM DUAL", Long.class)).thenReturn(100L);
        when(jdbc.queryForList("SELECT * FROM EQUIPMENT WHERE EQUIPMENT_ID=? ORDER BY EQUIPMENT_ID", 1L))
                .thenReturn(List.of(Map.of("EQUIPMENT_ID", 1, "MODEL_ID", 2, "ASSET_CODE", "EQ-1", "OPERATING_STATUS", "NORMAL", "ROW_VERSION", 6)));

        var response = equipment.update(admin, 1, draft());

        assertNotNull(response.get("equipment"));
        verify(jdbc).update("INSERT INTO EQUIPMENT_CHECK_LOG(CHECK_LOG_ID,EQUIPMENT_ID,ACTION_CODE,FROM_STATUS,TO_STATUS,REASON_TEXT,CHECKED_BY) VALUES(?,?,?,?,?,?,?)",
                100L, 1L, "CHECK_COMPLETED", "CHECKING", "NORMAL", "실물 확인", 7L);
    }
}
