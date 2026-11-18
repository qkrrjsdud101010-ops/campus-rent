package kr.ac.campusrent.alternatives;

import java.sql.Timestamp;
import java.util.List;
import java.util.Map;
import kr.ac.campusrent.auth.CurrentUser;
import org.junit.jupiter.api.Test;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.web.server.ResponseStatusException;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

class AlternativeServiceTest {
    private static final String EQUIPMENT = "SELECT E.*,M.MODEL_NAME,M.TYPE_ID,T.TYPE_NAME FROM EQUIPMENT E JOIN EQUIPMENT_MODEL M ON M.MODEL_ID=E.MODEL_ID JOIN EQUIPMENT_TYPE T ON T.TYPE_ID=M.TYPE_ID ORDER BY E.EQUIPMENT_ID";
    private static final String EXISTING = "SELECT * FROM EQUIPMENT_ALTERNATIVE WHERE SOURCE_EQUIPMENT_ID=? ORDER BY TARGET_EQUIPMENT_ID";
    private static final String BUMP = "UPDATE EQUIPMENT SET ROW_VERSION=ROW_VERSION+1 WHERE EQUIPMENT_ID=? AND ROW_VERSION=?";
    private static final String INSERT = "INSERT INTO EQUIPMENT_ALTERNATIVE(SOURCE_EQUIPMENT_ID,TARGET_EQUIPMENT_ID,REASON_TEXT,DIFFERENCE_TEXT,ENABLED_YN,CONFIGURED_BY) VALUES(?,?,?,?,?,?)";
    private static final String UPDATE = "UPDATE EQUIPMENT_ALTERNATIVE SET REASON_TEXT=?,DIFFERENCE_TEXT=?,ENABLED_YN=?,CONFIGURED_BY=? WHERE SOURCE_EQUIPMENT_ID=? AND TARGET_EQUIPMENT_ID=?";
    private final JdbcTemplate jdbc = mock(JdbcTemplate.class);
    private final AlternativeService alternatives = new AlternativeService(jdbc);
    private final CurrentUser admin = new CurrentUser("7", "관리자", "admin@example.invalid", "admin");

    private void source() {
        when(jdbc.queryForList("SELECT * FROM EQUIPMENT WHERE EQUIPMENT_ID=? FOR UPDATE", 1L))
                .thenReturn(List.of(Map.of("EQUIPMENT_ID", 1, "ROW_VERSION", 4, "OPERATING_STATUS", "DISABLED", "LEND_ALLOWED_YN", "N")));
        when(jdbc.queryForList("SELECT EQUIPMENT_ID FROM EQUIPMENT ORDER BY EQUIPMENT_ID"))
                .thenReturn(List.of(Map.of("EQUIPMENT_ID", 1), Map.of("EQUIPMENT_ID", 2), Map.of("EQUIPMENT_ID", 3)));
    }

    private Map<String, Object> existing(boolean enabled) {
        return Map.of("SOURCE_EQUIPMENT_ID", 1, "TARGET_EQUIPMENT_ID", 2, "REASON_TEXT", "같은 활동에 활용 가능",
                "DIFFERENCE_TEXT", "구성품과 사양 확인 필요", "ENABLED_YN", enabled ? "Y" : "N", "CONFIGURED_BY", 9,
                "CREATED_AT", Timestamp.valueOf("2026-01-01 10:00:00"));
    }

    private void writable() { when(jdbc.update(anyString(), any(Object[].class))).thenReturn(1); }

    @Test void anonymousAndStudentUsersCannotManageRelations() {
        var student = new CurrentUser("8", "학생", "student@example.invalid", "student");
        assertEquals(401, assertThrows(ResponseStatusException.class, () -> alternatives.list(null)).getStatusCode().value());
        assertEquals(403, assertThrows(ResponseStatusException.class,
                () -> alternatives.update(student, 1, AlternativePolicyTest.input(AlternativePolicyTest.relation(2, true)))).getStatusCode().value());
        verifyNoInteractions(jdbc);
    }

    @Test void snapshotReadsSourceVersionsBeforeBothActiveAndDisabledRelations() {
        when(jdbc.queryForList("SELECT * FROM EQUIPMENT_ALTERNATIVE ORDER BY SOURCE_EQUIPMENT_ID,TARGET_EQUIPMENT_ID"))
                .thenReturn(List.of(existing(true), existing(false)));
        var result = alternatives.list(admin);
        assertEquals(2, ((List<?>) result.get("alternatives")).size());
        var order = inOrder(jdbc);
        order.verify(jdbc).queryForList(EQUIPMENT);
        order.verify(jdbc).queryForList("SELECT * FROM EQUIPMENT_ALTERNATIVE ORDER BY SOURCE_EQUIPMENT_ID,TARGET_EQUIPMENT_ID");
    }

    @Test void staleEquipmentOrRelationVersionCannotOverwriteConfiguration() {
        source();
        var input = Map.<String, Object>of("expectedVersion", 3, "alternatives", List.of(AlternativePolicyTest.relation(2, true)));
        assertEquals(409, assertThrows(ResponseStatusException.class,
                () -> alternatives.update(admin, 1, input)).getStatusCode().value());
        verify(jdbc, never()).update(anyString(), any(Object[].class));
    }

    @Test void missingSourceAndMissingTargetCannotCreateDanglingRelations() {
        assertEquals(404, assertThrows(ResponseStatusException.class,
                () -> alternatives.update(admin, 1, AlternativePolicyTest.input(AlternativePolicyTest.relation(2, true)))).getStatusCode().value());
        source();
        assertEquals(400, assertThrows(ResponseStatusException.class,
                () -> alternatives.update(admin, 1, AlternativePolicyTest.input(AlternativePolicyTest.relation(999, true)))).getStatusCode().value());
        verify(jdbc, never()).update(anyString(), any(Object[].class));
    }

    @Test void selfRelationIsRejectedBeforeAnyDatabaseAccess() {
        assertEquals(400, assertThrows(ResponseStatusException.class,
                () -> alternatives.update(admin, 1, AlternativePolicyTest.input(AlternativePolicyTest.relation(1, true)))).getStatusCode().value());
        verifyNoInteractions(jdbc);
    }

    @Test void creatingDirectedRelationWorksForSuspendedSourceWithoutChangingReverseRelation() {
        source(); writable();
        var result = alternatives.update(admin, 1, AlternativePolicyTest.input(AlternativePolicyTest.relation(2, true)));
        assertEquals("1", result.get("sourceId"));
        var order = inOrder(jdbc);
        order.verify(jdbc).queryForList("SELECT * FROM EQUIPMENT WHERE EQUIPMENT_ID=? FOR UPDATE", 1L);
        order.verify(jdbc).update(BUMP, 1L, 4L);
        order.verify(jdbc).update(INSERT, 1L, 2L, "같은 활동에 활용 가능", "구성품과 사양 확인 필요", "Y", 7L);
        verify(jdbc, never()).update(INSERT, 2L, 1L, "같은 활동에 활용 가능", "구성품과 사양 확인 필요", "Y", 7L);
    }

    @Test void unchangedSaveKeepsVersionConfiguratorAndOriginalRegistrationTime() {
        source(); when(jdbc.queryForList(EXISTING, 1L)).thenReturn(List.of(existing(true)));
        alternatives.update(admin, 1, AlternativePolicyTest.input(AlternativePolicyTest.relation(2, true)));
        verify(jdbc, never()).update(anyString(), any(Object[].class));
    }

    @Test void omissionDisablesExistingRelationWithoutDeletingItsReasonOrRegistration() {
        source(); writable(); when(jdbc.queryForList(EXISTING, 1L)).thenReturn(List.of(existing(true)));
        alternatives.update(admin, 1, Map.of("expectedVersion", 4, "alternatives", List.of()));
        verify(jdbc).update(BUMP, 1L, 4L);
        verify(jdbc).update("UPDATE EQUIPMENT_ALTERNATIVE SET ENABLED_YN='N',CONFIGURED_BY=? WHERE SOURCE_EQUIPMENT_ID=? AND TARGET_EQUIPMENT_ID=?", 7L, 1L, 2L);
        verify(jdbc, never()).update(startsWith("DELETE"), any(Object[].class));
        verify(jdbc, never()).update(contains("CREATED_AT="), any(Object[].class));
    }

    @Test void omissionOfAlreadyDisabledRelationIsANoOp() {
        source(); when(jdbc.queryForList(EXISTING, 1L)).thenReturn(List.of(existing(false)));
        alternatives.update(admin, 1, Map.of("expectedVersion", 4, "alternatives", List.of()));
        verify(jdbc, never()).update(anyString(), any(Object[].class));
    }

    @Test void realMetadataChangeUpdatesConfiguratorWhilePreservingCreatedAt() {
        source(); writable(); when(jdbc.queryForList(EXISTING, 1L)).thenReturn(List.of(existing(true)));
        var row = AlternativePolicyTest.relation(2, true); row.put("difference", "어댑터 추가 필요");
        alternatives.update(admin, 1, AlternativePolicyTest.input(row));
        verify(jdbc).update(UPDATE, "같은 활동에 활용 가능", "어댑터 추가 필요", "Y", 7L, 1L, 2L);
        verify(jdbc, never()).update(contains("CREATED_AT="), any(Object[].class));
    }

    @Test void failedConditionalVersionUpdateStopsBeforeAnyRelationMutation() {
        source();
        assertEquals(409, assertThrows(ResponseStatusException.class,
                () -> alternatives.update(admin, 1, AlternativePolicyTest.input(AlternativePolicyTest.relation(2, true)))).getStatusCode().value());
        verify(jdbc, never()).update(startsWith("INSERT"), any(Object[].class));
        verify(jdbc, never()).update(startsWith("UPDATE EQUIPMENT_ALTERNATIVE"), any(Object[].class));
    }

    @Test void concurrentIntegrityFailureBecomesConflictInsteadOfPartialConfiguration() {
        source(); writable();
        when(jdbc.update(eq(INSERT), any(Object[].class))).thenThrow(new DataIntegrityViolationException("changed reference"));
        assertEquals(409, assertThrows(ResponseStatusException.class,
                () -> alternatives.update(admin, 1, AlternativePolicyTest.input(AlternativePolicyTest.relation(2, true)))).getStatusCode().value());
    }
}
