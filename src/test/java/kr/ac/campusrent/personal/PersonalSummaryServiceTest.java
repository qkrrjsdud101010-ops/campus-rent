package kr.ac.campusrent.personal;

import java.time.*;
import java.util.*;
import kr.ac.campusrent.auth.CurrentUser;
import kr.ac.campusrent.rental.RentalService;
import org.junit.jupiter.api.Test;
import org.springframework.web.server.ResponseStatusException;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

class PersonalSummaryServiceTest {
    static final Instant NOW=Instant.parse("2026-11-17T15:30:00Z"); // 11/18 00:30 KST

    @Test void usesKoreanDayAndExcludesUnconfirmedItemsAtDayBoundaries() {
        var s=summary(item("1","장비","APPROVED","2026-11-18T00:00","2026-11-19T00:00"),
                item("2","장비","APPROVED","2026-11-19T00:00","2026-11-20T00:00"),
                item("3","장비","PENDING","2026-11-18T01:00","2026-11-18T02:00"),
                item("4","장비","CHECKED_OUT","2026-11-17T12:00","2026-11-18T00:00"),
                item("5","장비","CHECKED_OUT","2026-11-17T12:00","2026-11-19T00:00"));
        assertEquals("2026-11-18",s.get("basisDate")); assertEquals("Asia/Seoul",s.get("timeZone"));
        assertEquals(Map.of("pickup",1L,"returnDue",1L,"facilityUse",0L),s.get("counts"));
    }
    @Test void facilityOverlapIsHalfOpenAndIncludesActiveUse() {
        var s=summary(item("1","시설","APPROVED","2026-11-17T20:00","2026-11-18T00:00"),
                item("2","시설","APPROVED","2026-11-18T23:00","2026-11-19T00:00"),
                item("3","시설","IN_USE","2026-11-17T23:00","2026-11-18T01:00"),
                item("4","시설","APPROVED","2026-11-19T00:00","2026-11-19T01:00"),
                item("5","시설","COMPLETED","2026-11-18T08:00","2026-11-18T09:00"));
        assertEquals(2L,((Map<?,?>)s.get("counts")).get("facilityUse"));
    }
    @Test void heldThenRequestedTakePriorityAndNewestInspectionComesFirst() {
        var requested=item("20","장비","RETURN_REQUESTED","2026-10-01T09:00","2026-10-02T09:00");
        requested.put("history",List.of(Map.of("action","RETURN_REQUESTED","at","2026-11-17T12:00")));
        var tasks=todo(summary(item("1","장비","APPROVED","2026-11-18T01:00","2026-11-19T01:00"),
                held("2","2026-11-01T09:00"),requested,held("10","2026-11-10T09:00")));
        assertEquals(List.of("10","2","20"),tasks.stream().map(row->row.get("itemId")).toList());
        assertEquals("return-requested",tasks.get(2).get("actionType"));
        assertEquals("2026-11-17T12:00",tasks.get(2).get("actionAt"));
    }
    @Test void scheduledTodoUsesCorrectActionTimeAndSevenDayBoundaryWithNumericTieBreak() {
        var tasks=todo(summary(item("8","장비","APPROVED","2026-11-18T00:29","2026-11-19T01:00"),
                item("9","장비","APPROVED","2026-11-25T00:30","2026-11-26T01:00"),
                item("10","시설","IN_USE","2026-11-17T00:00","2026-11-18T00:30"),
                item("2","장비","CHECKED_OUT","2026-11-17T00:00","2026-11-18T00:30"),
                item("11","시설","APPROVED","2026-11-24T23:00","2026-11-24T23:30")));
        assertEquals(List.of("2","10","11"),tasks.stream().map(row->row.get("itemId")).toList());
        assertEquals(List.of("return","facility-end","facility-start"),tasks.stream().map(row->row.get("actionType")).toList());
    }
    @Test void countsAreNotLimitedByTodoAndTodoDeduplicates() {
        var first=item("1","장비","APPROVED","2026-11-18T01:00","2026-11-18T02:00");
        var s=summary(first,item("2","장비","APPROVED","2026-11-18T02:00","2026-11-18T03:00"),
                item("3","장비","APPROVED","2026-11-18T03:00","2026-11-18T04:00"),
                item("4","장비","APPROVED","2026-11-18T04:00","2026-11-18T05:00"));
        assertEquals(4L,((Map<?,?>)s.get("counts")).get("pickup")); assertEquals(3,todo(s).size());
        assertEquals(1,todo(summary(first,first)).size());
    }
    @Test void heldMissingQuantityUsesCheckoutSnapshotAndCumulativeReturn() {
        var h=held("1","2026-11-17T09:00");
        h.put("checkoutComponents",List.of(Map.of("componentId","1","name","본체","quantity",1),Map.of("componentId","2","name","배터리","quantity",3)));
        h.put("returnedComponents",Map.of("1",1,"2",2)); h.put("reason","배터리 1개 확인 필요");
        var task=todo(summary(h)).getFirst();
        assertEquals(List.of(Map.of("componentId","2","name","배터리","quantity",1L)),task.get("missingComponents"));
        assertEquals("배터리 1개 확인 필요",task.get("reason"));
    }
    @Test void usesAuthenticatedStudentAndRejectsOtherRolesBeforeQuery() {
        var rentals=mock(RentalService.class);
        var student=new CurrentUser("42","학생","student@example.invalid","student");
        when(rentals.list(student)).thenReturn(Map.of("records",List.of()));
        var service=new PersonalSummaryService(rentals,Clock.fixed(NOW,ZoneOffset.UTC));
        assertEquals(List.of(),service.summary(student).get("todo")); verify(rentals).list(student);
        assertEquals(403,assertThrows(ResponseStatusException.class,()->service.summary(new CurrentUser("7","admin","a@example.invalid","admin"))).getStatusCode().value());
        assertEquals(401,assertThrows(ResponseStatusException.class,()->service.summary(null)).getStatusCode().value());
        verifyNoMoreInteractions(rentals);
    }
    @Test void missingDatesDoNotInventTasksAndEmptySummaryIsZero() {
        var s=summary(item("1","시설","APPROVED","",""));
        assertEquals(Map.of("pickup",0L,"returnDue",0L,"facilityUse",0L),s.get("counts")); assertTrue(todo(s).isEmpty());
    }
    static Map<String,Object> item(String id,String kind,String code,String start,String end) {
        return new LinkedHashMap<>(Map.of("id",id,"kind",kind,"statusCode",code,"status",code,"name","합성 자원","originalIndex",1,"condition",Map.of("start",start,"end",end)));
    }
    static Map<String,Object> held(String id,String at) {
        var h=item(id,"장비","RETURN_HELD","2026-10-01T09:00","2026-10-02T09:00"); h.put("inspections",List.of(Map.of("at",at)));return h;
    }
    @SafeVarargs static Map<String,Object> summary(Map<String,Object>...items) {return PersonalSummaryService.summarize(List.of(Map.of("number","TEST-1","items",List.of(items))),NOW);}
    @SuppressWarnings("unchecked") static List<Map<String,Object>> todo(Map<String,Object>s){return (List<Map<String,Object>>)s.get("todo");}
}
