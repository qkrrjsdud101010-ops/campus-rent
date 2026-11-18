package kr.ac.campusrent.facility;

import java.sql.Timestamp;
import java.time.LocalDateTime;
import java.util.List;
import java.util.Map;
import kr.ac.campusrent.auth.CurrentUser;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.web.server.ResponseStatusException;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

class FacilityServiceTest {
    private static final String RESERVATIONS = "SELECT REQUEST_ITEM_ID,STATUS_CODE,USE_START_AT,USE_END_AT,PEOPLE_COUNT,PURPOSE_ID FROM REQUEST_ITEM WHERE FACILITY_ID=? AND (STATUS_CODE='IN_USE' OR (STATUS_CODE='APPROVED' AND USE_END_AT>LOCALTIMESTAMP)) ORDER BY USE_START_AT,REQUEST_ITEM_ID";
    private final JdbcTemplate jdbc = mock(JdbcTemplate.class);
    private final FacilityService facilities = new FacilityService(jdbc);
    private final CurrentUser admin = new CurrentUser("7", "관리자", "admin@example.invalid", "admin");

    private void stored() {
        when(jdbc.queryForList("SELECT * FROM FACILITY WHERE FACILITY_ID=? FOR UPDATE", 1L))
                .thenReturn(List.of(Map.of("ROW_VERSION", 5, "FACILITY_CODE", "ROOM-1", "CAPACITY", 12,
                        "OPERATING_STATUS", "NORMAL", "USE_ALLOWED_YN", "Y")));
        when(jdbc.queryForList("SELECT WEEKDAY_NO,OPEN_TIME,CLOSE_TIME FROM FACILITY_HOURS WHERE FACILITY_ID=? ORDER BY WEEKDAY_NO", 1L))
                .thenReturn(List.of(Map.of("WEEKDAY_NO", 1, "OPEN_TIME", "09:00", "CLOSE_TIME", "18:00")));
        when(jdbc.queryForList("SELECT PURPOSE_ID FROM FACILITY_PURPOSE WHERE FACILITY_ID=? ORDER BY PURPOSE_ID", 1L))
                .thenReturn(List.of(Map.of("PURPOSE_ID", 2)));
        when(jdbc.queryForList("SELECT PURPOSE_ID,ENABLED_YN FROM USE_PURPOSE ORDER BY PURPOSE_ID"))
                .thenReturn(List.of(Map.of("PURPOSE_ID", 2, "ENABLED_YN", "Y")));
    }

    private void reservation(String state, String start, String end) {
        when(jdbc.queryForList(RESERVATIONS, 1L)).thenReturn(List.of(Map.of("REQUEST_ITEM_ID", 20,
                "STATUS_CODE", state, "USE_START_AT", Timestamp.valueOf(LocalDateTime.parse(start)),
                "USE_END_AT", Timestamp.valueOf(LocalDateTime.parse(end)), "PEOPLE_COUNT", 8, "PURPOSE_ID", 2)));
    }

    private void response() {
        when(jdbc.update(anyString(), any(Object[].class))).thenReturn(1);
        when(jdbc.queryForList("SELECT * FROM FACILITY WHERE FACILITY_ID=? ORDER BY FACILITY_ID", 1L))
                .thenReturn(List.of(Map.of("FACILITY_ID", 1, "FACILITY_CODE", "ROOM-1", "FACILITY_NAME", "세미나실",
                        "ROW_VERSION", 6, "CAPACITY", 12, "OPERATING_STATUS", "NORMAL", "USE_ALLOWED_YN", "Y")));
    }

    private void assertConflict(Runnable operation) {
        var error = assertThrows(ResponseStatusException.class, operation::run);
        assertEquals(409, error.getStatusCode().value());
        verify(jdbc, never()).update(anyString(), any(Object[].class));
    }

    @Test void managementRequiresAuthenticatedAdministrator() {
        var student = new CurrentUser("8", "학생", "student@example.invalid", "student");
        assertEquals(403, assertThrows(ResponseStatusException.class, () -> facilities.list(student)).getStatusCode().value());
        assertEquals(401, assertThrows(ResponseStatusException.class, () -> facilities.create(null, FacilityPolicyTest.draft())).getStatusCode().value());
        verifyNoInteractions(jdbc);
    }

    @Test void listCapturesParentVersionsBeforeReadingEditableChildren() {
        facilities.list(admin);
        var order = inOrder(jdbc);
        order.verify(jdbc).queryForList("SELECT * FROM FACILITY ORDER BY FACILITY_ID", new Object[]{});
        order.verify(jdbc).queryForList("SELECT * FROM FACILITY_HOURS ORDER BY FACILITY_ID,WEEKDAY_NO", new Object[]{});
        order.verify(jdbc).queryForList("SELECT * FROM FACILITY_PURPOSE ORDER BY FACILITY_ID,PURPOSE_ID", new Object[]{});
        order.verify(jdbc).queryForList("SELECT * FROM FACILITY_BLOCK ORDER BY FACILITY_ID,BLOCK_START_AT,BLOCK_ID", new Object[]{});
    }

    @Test void staleFacilityAndChildEditsCannotOverwriteNewerChanges() {
        stored();
        var input = FacilityPolicyTest.draft(); input.put("expectedVersion", 4);
        assertConflict(() -> facilities.update(admin, 1, input));
        var block = FacilityPolicyTest.block(); block.put("expectedVersion", 4);
        assertConflict(() -> facilities.createBlock(admin, 1, block));
        assertConflict(() -> facilities.removeBlock(admin, 1, 4, block));
    }

    @Test void facilityCodeCannotChangeAfterRegistration() {
        stored(); var input = FacilityPolicyTest.draft(); input.put("code", "ROOM-OTHER");
        assertEquals(400, assertThrows(ResponseStatusException.class,
                () -> facilities.update(admin, 1, input)).getStatusCode().value());
        verify(jdbc, never()).update(anyString(), any(Object[].class));
    }

    @Test void capacityReductionCannotInvalidateApprovedAttendance() {
        stored(); reservation("APPROVED", "2026-11-23T10:00", "2026-11-23T11:00");
        var input = FacilityPolicyTest.draft(); input.put("capacity", 7);
        assertConflict(() -> facilities.update(admin, 1, input));
    }

    @Test void shortenedHoursAndRemovedPurposeCannotInvalidateApprovedReservation() {
        stored(); reservation("APPROVED", "2026-11-23T10:00", "2026-11-23T11:00");
        var shortHours = FacilityPolicyTest.draft(); shortHours.put("hoursByWeekday", Map.of("1", List.of("09:00", "10:30")));
        assertConflict(() -> facilities.update(admin, 1, shortHours));
        var noPurpose = FacilityPolicyTest.draft(); noPurpose.put("purposeIds", List.of());
        assertConflict(() -> facilities.update(admin, 1, noPurpose));
        var noHours = FacilityPolicyTest.draft(); noHours.put("hoursByWeekday", Map.of());
        assertConflict(() -> facilities.update(admin, 1, noHours));
    }

    @Test void actualUseIsProtectedEvenAfterItsPlannedEnd() {
        stored(); reservation("IN_USE", "2000-01-03T10:00", "2000-01-03T11:00");
        var input = FacilityPolicyTest.draft(); input.put("status", "CHECKING");
        assertConflict(() -> facilities.update(admin, 1, input));
    }

    @Test void maintenanceAndUseDisablingCannotOverrideApprovedReservation() {
        stored(); reservation("APPROVED", "2026-11-23T10:00", "2026-11-23T11:00");
        var suspended = FacilityPolicyTest.draft(); suspended.put("useAllowed", false);
        assertConflict(() -> facilities.update(admin, 1, suspended));
        assertConflict(() -> facilities.createBlock(admin, 1, FacilityPolicyTest.block()));
    }

    @Test void adjacentBlockCanBeRegisteredUnderSameParentLockAndVersion() {
        stored(); response(); reservation("APPROVED", "2026-11-23T10:00", "2026-11-23T11:00");
        when(jdbc.queryForObject("SELECT SQ_FACILITY_BLOCK.NEXTVAL FROM DUAL", Long.class)).thenReturn(9L);
        var input = FacilityPolicyTest.block(); input.put("start", "2026-11-23T11:00"); input.put("end", "2026-11-23T12:00");
        assertNotNull(facilities.createBlock(admin, 1, input).get("facility"));
        var order = inOrder(jdbc);
        order.verify(jdbc).queryForList("SELECT * FROM FACILITY WHERE FACILITY_ID=? FOR UPDATE", 1L);
        order.verify(jdbc).queryForList(RESERVATIONS, 1L);
        order.verify(jdbc).update("UPDATE FACILITY SET ROW_VERSION=ROW_VERSION+1 WHERE FACILITY_ID=? AND ROW_VERSION=?", 1L, 5L);
        verify(jdbc).update("INSERT INTO FACILITY_BLOCK(BLOCK_ID,FACILITY_ID,BLOCK_START_AT,BLOCK_END_AT,REASON_TEXT,REGISTERED_BY) VALUES(?,?,?,?,?,?)",
                9L, 1L, Timestamp.valueOf("2026-11-23 11:00:00"), Timestamp.valueOf("2026-11-23 12:00:00"), "프로젝터 점검", 7L);
    }

    @Test void restrictionCannotBeEditedOrDeletedThroughAnotherFacility() {
        stored();
        assertEquals(404, assertThrows(ResponseStatusException.class,
                () -> facilities.updateBlock(admin, 1, 999, FacilityPolicyTest.block())).getStatusCode().value());
        assertEquals(404, assertThrows(ResponseStatusException.class,
                () -> facilities.removeBlock(admin, 1, 999, FacilityPolicyTest.block())).getStatusCode().value());
        verify(jdbc, never()).update(anyString(), any(Object[].class));
    }

    @Test void inactivePurposeCanBePreservedButCannotBeNewlyAssigned() {
        stored(); response();
        when(jdbc.queryForList("SELECT PURPOSE_ID,ENABLED_YN FROM USE_PURPOSE ORDER BY PURPOSE_ID"))
                .thenReturn(List.of(Map.of("PURPOSE_ID", 2, "ENABLED_YN", "N"), Map.of("PURPOSE_ID", 3, "ENABLED_YN", "N")));
        assertNotNull(facilities.update(admin, 1, FacilityPolicyTest.draft()).get("facility"));
        clearInvocations(jdbc);
        var input = FacilityPolicyTest.draft(); input.put("purposeIds", List.of("2", "3"));
        assertConflict(() -> facilities.update(admin, 1, input));
    }

    @Test void metadataEditDoesNotRewriteRequestsHoursPurposesOrUsageHistory() {
        stored(); response();
        var input = FacilityPolicyTest.draft(); input.put("name", "새 시설명");
        var result = facilities.update(admin, 1, input);
        assertEquals(6L, ((Map<?, ?>) result.get("facility")).get("version"));
        verify(jdbc, never()).queryForList(RESERVATIONS, 1L);
        verify(jdbc, never()).update(startsWith("DELETE"), any(Object[].class));
        verify(jdbc, never()).update(contains("REQUEST_ITEM SET"), any(Object[].class));
        verify(jdbc, never()).update(contains("FACILITY_USAGE"), any(Object[].class));
    }

    @Test void newSuspendedFacilityRequiresReasonAndConfirmationBeforeInserting() {
        stored();
        var input = FacilityPolicyTest.draft(); input.put("status", "DISABLED"); input.put("confirmed", false);
        assertEquals(400, assertThrows(ResponseStatusException.class,
                () -> facilities.create(admin, input)).getStatusCode().value());
        verify(jdbc, never()).update(anyString(), any(Object[].class));
    }

    @Test void registrationCanLeaveHoursAndPurposesUnconfigured() {
        stored(); response();
        when(jdbc.queryForObject("SELECT SQ_FACILITY.NEXTVAL FROM DUAL", Long.class)).thenReturn(1L);
        var input = FacilityPolicyTest.draft(); input.remove("expectedVersion");
        input.put("hoursByWeekday", Map.of()); input.put("purposeIds", List.of());
        assertNotNull(facilities.create(admin, input).get("facility"));
        verify(jdbc).update("INSERT INTO FACILITY(FACILITY_ID,FACILITY_CODE,FACILITY_NAME,FACILITY_TYPE,LOCATION_TEXT,CAPACITY,FIXED_EQUIPMENT_INFO,USE_ALLOWED_YN,OPERATING_STATUS,IS_DEMO_YN) VALUES(?,?,?,?,?,?,?,?,?,?)",
                1L, "ROOM-1", "세미나실", "세미나실", "본관 2층", 12, "프로젝터 · 화이트보드", "Y", "NORMAL", "Y");
        verify(jdbc, never()).update(startsWith("INSERT INTO FACILITY_HOURS"), any(Object[].class));
        verify(jdbc, never()).update(startsWith("INSERT INTO FACILITY_PURPOSE"), any(Object[].class));
    }

    @Test void failedConditionalParentUpdateNeverReplacesChildDefinitions() {
        stored();
        var input = FacilityPolicyTest.draft(); input.put("hoursByWeekday", Map.of());
        assertEquals(409, assertThrows(ResponseStatusException.class,
                () -> facilities.update(admin, 1, input)).getStatusCode().value());
        verify(jdbc, never()).update(startsWith("DELETE FROM FACILITY_HOURS"), any(Object[].class));
    }

    @Test void blockEditPreservesRegistrationMetadataAndRemovalOnlyDeletesRestriction() {
        stored(); response();
        when(jdbc.queryForList("SELECT BLOCK_ID FROM FACILITY_BLOCK WHERE FACILITY_ID=? AND BLOCK_ID=?", 1L, 9L))
                .thenReturn(List.of(Map.of("BLOCK_ID", 9)));
        assertNotNull(facilities.updateBlock(admin, 1, 9, FacilityPolicyTest.block()).get("facility"));
        verify(jdbc).update("UPDATE FACILITY_BLOCK SET BLOCK_START_AT=?,BLOCK_END_AT=?,REASON_TEXT=? WHERE FACILITY_ID=? AND BLOCK_ID=?",
                Timestamp.valueOf("2026-11-23 10:00:00.123456"), Timestamp.valueOf("2026-11-23 11:00:00"), "프로젝터 점검", 1L, 9L);
        assertNotNull(facilities.removeBlock(admin, 1, 9, FacilityPolicyTest.block()).get("facility"));
        verify(jdbc).update("DELETE FROM FACILITY_BLOCK WHERE FACILITY_ID=? AND BLOCK_ID=?", 1L, 9L);
        verify(jdbc, never()).update(contains("REQUEST_ITEM SET"), any(Object[].class));
        verify(jdbc, never()).update(contains("FACILITY_USAGE"), any(Object[].class));
    }
}
