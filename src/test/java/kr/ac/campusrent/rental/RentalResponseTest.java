package kr.ac.campusrent.rental;

import java.sql.Timestamp;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import kr.ac.campusrent.auth.CurrentUser;
import kr.ac.campusrent.catalog.CatalogService;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

class RentalResponseTest {
    private final JdbcTemplate jdbc = mock(JdbcTemplate.class);
    private final CatalogService catalog = mock(CatalogService.class);
    private final RentalService service = new RentalService(jdbc, catalog);
    private final Timestamp at = Timestamp.valueOf("2026-11-18 10:00:00");

    private void returnedEquipment() {
        var resource = Map.<String, Object>of("id", "equipment:1", "kind", "장비", "status", "정상", "version", 1);
        when(catalog.resources()).thenReturn(List.of(resource));
        when(catalog.resourceByDb("E", 1L)).thenReturn(resource);
        when(jdbc.queryForList(startsWith("SELECT R.*"), any(Object[].class))).thenReturn(List.of(Map.of(
                "REQUEST_ID", 5, "REQUEST_NO", "REQ-TEST", "APPLICANT_ID", 8,
                "USER_NAME", "학생", "REQUESTED_AT", at)));
        var item = new LinkedHashMap<String, Object>();
        item.put("REQUEST_ITEM_ID", 3); item.put("EQUIPMENT_ID", 1); item.put("ITEM_KIND", "E");
        item.put("ITEM_NO", 1); item.put("ROW_VERSION", 0); item.put("STATUS_CODE", "RETURN_HELD");
        item.put("USE_START_AT", at); item.put("USE_END_AT", Timestamp.valueOf("2026-11-19 10:00:00"));
        when(jdbc.queryForList("SELECT * FROM REQUEST_ITEM WHERE REQUEST_ID=? ORDER BY ITEM_NO", 5L))
                .thenReturn(List.of(item));
        when(jdbc.queryForList("SELECT * FROM REQUEST_STATUS_LOG WHERE REQUEST_ITEM_ID=? ORDER BY CHANGED_AT,STATUS_LOG_ID", 3L))
                .thenReturn(List.of(Map.of("TO_STATUS", "RETURN_HELD", "FROM_STATUS", "RETURN_REQUESTED",
                        "REASON_TEXT", "배터리 추가 반환 필요", "CHANGED_AT", at)));
        when(jdbc.queryForList("SELECT * FROM EQUIPMENT_CHECKOUT WHERE REQUEST_ITEM_ID=?", 3L))
                .thenReturn(List.of(Map.of("CHECKOUT_ID", 7, "ASSET_CODE_SNAPSHOT", "EQ-1",
                        "EQUIPMENT_NAME_SNAPSHOT", "출고 당시 카메라", "SOURCE_CODE", "LATE_REGISTERED",
                        "REGISTERED_AT", at)));
        when(jdbc.queryForList("SELECT * FROM CHECKOUT_COMPONENT WHERE CHECKOUT_ID=? ORDER BY COMPONENT_SEQ", 7L))
                .thenReturn(List.of(Map.of("COMPONENT_SEQ", 1, "COMPONENT_NAME", "배터리", "REQUIRED_QTY", 1,
                        "DELIVERED_QTY", 1, "REQUIRED_YN", "Y", "BODY_YN", "N", "OUT_CONDITION", "NORMAL")));
        when(jdbc.queryForList("SELECT * FROM RETURN_INSPECTION WHERE CHECKOUT_ID=? ORDER BY INSPECTION_ROUND", 7L))
                .thenReturn(List.of(Map.of("INSPECTION_ROUND", 1, "INSPECTED_AT", at,
                        "HOLD_REASON", "배터리 추가 반환 필요", "OUTCOME_CODE", "HOLD")));
        when(jdbc.queryForList("SELECT * FROM RETURN_COMPONENT WHERE CHECKOUT_ID=? AND INSPECTION_ROUND=? ORDER BY COMPONENT_SEQ", 7L, 1L))
                .thenReturn(List.of(Map.of("COMPONENT_SEQ", 1, "RETURNED_QTY", 0,
                        "RETURN_CONDITION", "NORMAL", "NOTE_TEXT", "관리자 내부 메모")));
    }

    @SuppressWarnings("unchecked")
    private Map<String, Object> itemFor(String role) {
        var response = service.list(new CurrentUser("8", "사용자", "user@example.invalid", role));
        var records = (List<Map<String, Object>>) response.get("records");
        return ((List<Map<String, Object>>) records.getFirst().get("items")).getFirst();
    }

    @SuppressWarnings("unchecked")
    private Map<String, Object> firstReturnedComponent(Map<String, Object> item) {
        var rounds = (List<Map<String, Object>>) item.get("inspections");
        return ((List<Map<String, Object>>) rounds.getFirst().get("components")).getFirst();
    }

    @Test void studentReceivesReturnOutcomeWithoutInternalNotes() {
        returnedEquipment();
        var item = itemFor("student");
        var component = firstReturnedComponent(item);
        assertFalse(component.containsKey("note"));
        assertEquals(1L, component.get("missingQuantity"));
        assertEquals("배터리 추가 반환 필요", item.get("reason"));
        verify(jdbc).queryForList(contains("WHERE R.APPLICANT_ID=?"), eq(8L));
    }

    @Test void administratorStillReceivesInspectionNotes() {
        returnedEquipment();
        assertEquals("관리자 내부 메모", firstReturnedComponent(itemFor("admin")).get("note"));
    }

    @Test void lateRegistrationDoesNotInventAnActualCheckoutTime() {
        returnedEquipment();
        var item = itemFor("student");
        assertEquals("LATE_REGISTERED", item.get("checkoutSource"));
        assertEquals(at.toLocalDateTime().toString(), item.get("checkoutRegisteredAt"));
        assertEquals("", item.get("checkoutAt"));
    }

    @SuppressWarnings("unchecked")
    @Test void studentHistoryOmitsInternalReasonsWhileKeepingReturnGuidance() {
        returnedEquipment();
        when(jdbc.queryForList("SELECT * FROM REQUEST_STATUS_LOG WHERE REQUEST_ITEM_ID=? ORDER BY CHANGED_AT,STATUS_LOG_ID", 3L))
                .thenReturn(List.of(Map.of("TO_STATUS", "RETURN_HELD", "FROM_STATUS", "RETURN_HELD",
                        "REASON_TEXT", "관리자 내부 진단 메모", "CHANGED_AT", at)));
        var item = itemFor("student");
        var history = (List<Map<String, Object>>) item.get("history");
        assertEquals("", history.getFirst().get("reason"));
        assertEquals("배터리 추가 반환 필요", item.get("reason"));
    }

    @SuppressWarnings("unchecked")
    @Test void rejectedItemKeepsPublicRejectionWithoutExposingLaterMaintenanceReason() {
        returnedEquipment();
        when(jdbc.queryForList("SELECT * FROM REQUEST_STATUS_LOG WHERE REQUEST_ITEM_ID=? ORDER BY CHANGED_AT,STATUS_LOG_ID", 3L))
                .thenReturn(List.of(Map.of("TO_STATUS","REJECTED","FROM_STATUS","PENDING","REASON_TEXT","일정 확인 필요","CHANGED_AT",at),
                        Map.of("TO_STATUS","REJECTED","FROM_STATUS","REJECTED","REASON_TEXT","관리자 내부 점검 메모","CHANGED_AT",at)));
        var item=new LinkedHashMap<String,Object>(Map.of("REQUEST_ITEM_ID",3,"EQUIPMENT_ID",1,"ITEM_KIND","E","ITEM_NO",1,"ROW_VERSION",0,"STATUS_CODE","REJECTED","USE_START_AT",at,"USE_END_AT",at));
        when(jdbc.queryForList("SELECT * FROM REQUEST_ITEM WHERE REQUEST_ID=? ORDER BY ITEM_NO",5L)).thenReturn(List.of(item));
        var view=itemFor("student");
        var history=(List<Map<String,Object>>)view.get("history");
        assertEquals("일정 확인 필요",history.getFirst().get("reason"));
        assertEquals("",history.getLast().get("reason"));
        assertEquals("일정 확인 필요",view.get("reason"));
    }
}
