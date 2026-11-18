package kr.ac.campusrent.facility;

import java.time.LocalDateTime;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.springframework.web.server.ResponseStatusException;
import static org.junit.jupiter.api.Assertions.*;

class FacilityPolicyTest {
    static Map<String, Object> draft() {
        Map<String, Object> result = new HashMap<>();
        result.put("code", "ROOM-1"); result.put("name", "세미나실"); result.put("type", "세미나실");
        result.put("location", "본관 2층"); result.put("capacity", 12);
        result.put("fixedEquipmentInfo", "프로젝터 · 화이트보드");
        result.put("useAllowed", true); result.put("status", "NORMAL"); result.put("isDemo", true);
        result.put("hoursByWeekday", Map.of("1", List.of("09:00", "18:00")));
        result.put("purposeIds", List.of("2")); result.put("expectedVersion", 5);
        result.put("reason", "현장 운영 확인"); result.put("confirmed", true);
        return result;
    }

    static Map<String, Object> block() {
        return new HashMap<>(Map.of("start", "2026-11-23T10:00:00.123456", "end", "2026-11-23T11:00",
                "reason", "프로젝터 점검", "confirmed", true, "expectedVersion", 5));
    }

    @Test void acceptsEmptyHoursAndPurposesWithoutInventingOperatingPolicy() {
        var input = draft(); input.put("hoursByWeekday", Map.of()); input.put("purposeIds", List.of());
        var result = FacilityPolicy.facility(input, true);
        assertTrue(result.hours().isEmpty()); assertTrue(result.purposeIds().isEmpty());
        assertEquals(5L, result.expectedVersion());
    }

    @Test void rejectsUnknownWeekdaysAndMalformedOrOvernightHours() {
        for (Map<String, List<String>> hours : List.of(Map.of("0", List.of("09:00", "18:00")),
                Map.of("8", List.of("09:00", "18:00")), Map.of("1", List.of("9:00", "18:00")),
                Map.of("1", List.of("09:00", "09:00")), Map.of("1", List.of("23:00", "01:00")),
                Map.of("1", List.of("09:00", "24:00")))) {
            var input = draft(); input.put("hoursByWeekday", hours);
            assertThrows(ResponseStatusException.class, () -> FacilityPolicy.facility(input, true));
        }
    }

    @Test void rejectsFractionalCapacityAndNonBooleanFlags() {
        var fractional = draft(); fractional.put("capacity", 1.5);
        assertThrows(ResponseStatusException.class, () -> FacilityPolicy.facility(fractional, true));
        var oversized = draft(); oversized.put("capacity", 1000);
        assertThrows(ResponseStatusException.class, () -> FacilityPolicy.facility(oversized, true));
        var wrongFlag = draft(); wrongFlag.put("useAllowed", "true");
        assertThrows(ResponseStatusException.class, () -> FacilityPolicy.facility(wrongFlag, true));
    }

    @Test void rejectsDuplicatePurposesEvenAcrossStringAndNumericIds() {
        var input = draft(); input.put("purposeIds", List.of("2", 2));
        assertThrows(ResponseStatusException.class, () -> FacilityPolicy.facility(input, true));
    }

    @Test void textLimitsCountUnicodeCodePoints() {
        var input = draft(); input.put("name", "🎓".repeat(100));
        assertEquals(100, FacilityPolicy.facility(input, false).name().codePointCount(0, 200));
        input.put("name", "🎓".repeat(101));
        assertThrows(ResponseStatusException.class, () -> FacilityPolicy.facility(input, false));
    }

    @Test void rejectsStaleVersionShapesAndMissingRequiredFields() {
        var input = draft(); input.put("expectedVersion", "5");
        assertThrows(ResponseStatusException.class, () -> FacilityPolicy.facility(input, true));
        input.put("expectedVersion", 5); input.put("type", " ");
        assertThrows(ResponseStatusException.class, () -> FacilityPolicy.facility(input, true));
    }

    @Test void preservesSubsecondRestrictionTimesAndRequiresActualConfirmation() {
        var input = block();
        assertEquals(123456000, FacilityPolicy.block(input).start().getNano());
        input.put("confirmed", false);
        assertThrows(ResponseStatusException.class, () -> FacilityPolicy.block(input));
        input.put("confirmed", true); input.put("end", input.get("start"));
        assertThrows(ResponseStatusException.class, () -> FacilityPolicy.block(input));
        input.put("start", "+10000-01-01T09:00"); input.put("end", "+10000-01-01T10:00");
        assertThrows(ResponseStatusException.class, () -> FacilityPolicy.block(input));
    }

    @Test void adjacentPeriodsDoNotOverlapAndOperatingBoundariesAreInclusive() {
        LocalDateTime start = LocalDateTime.parse("2026-11-23T09:00"), end = start.plusHours(1);
        assertFalse(FacilityPolicy.overlaps(start, end, end, end.plusHours(1)));
        assertTrue(FacilityPolicy.overlaps(start, end, end.minusNanos(1), end.plusHours(1)));
        var hours = FacilityPolicy.hours(Map.of("1", List.of("09:00", "10:00"))).get(1);
        assertTrue(hours.contains(start, end));
        assertFalse(hours.contains(start, end.plusMinutes(1)));
    }
}
