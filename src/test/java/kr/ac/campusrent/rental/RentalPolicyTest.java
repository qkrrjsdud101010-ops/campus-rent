package kr.ac.campusrent.rental;

import java.math.BigDecimal;
import java.time.*;
import java.util.*;
import org.junit.jupiter.api.Test;
import org.springframework.web.server.ResponseStatusException;
import static org.junit.jupiter.api.Assertions.*;
import static kr.ac.campusrent.rental.RentalPolicy.*;

class RentalPolicyTest {
    private final Clock clock = Clock.fixed(Instant.parse("2026-11-04T00:00:00Z"), ZoneId.of("Asia/Seoul"));
    private final List<Component> definitions = List.of(
        new Component("1", "본체", 1, 1, true, true),
        new Component("2", "배터리", 2, 2, true, false));

    private Map<String,Object> row(String id, int quantity) {
        return new HashMap<>(Map.of("componentId", id, "quantity", quantity, "condition", "정상", "confirmed", true));
    }

    @Test void facilityRequiresFutureIntervalPeopleAndPurpose() {
        var input = new HashMap<String,Object>(Map.of("start", "2026-11-05T11:00", "end", "2026-11-05T12:00", "people", 6, "use", "팀 회의"));
        assertEquals("팀 회의", condition(input, true, clock).purpose());
        input.put("start", "2026-11-04T08:59");
        assertThrows(ResponseStatusException.class, () -> condition(input, true, clock));
        input.put("start", "2026-11-05T11:00"); input.put("people", new BigDecimal("1.5"));
        assertThrows(ResponseStatusException.class, () -> condition(input, true, clock));
        input.put("people", 6); input.remove("use");
        assertThrows(ResponseStatusException.class, () -> condition(input, true, clock));
    }

    @Test void versionsRejectFractionalNegativeAndStringValues() {
        assertEquals(4, expectedVersion(new BigDecimal("4.0")));
        for (Object value : List.of(-1, "1", new BigDecimal("0.1"), new BigDecimal("1e100")))
            assertThrows(ResponseStatusException.class, () -> expectedVersion(value));
    }

    @Test void checkoutRequiresEveryConfirmedNormalComponentAndExactRequiredQuantity() {
        assertEquals(2, checkout(definitions, List.of(row("1", 1), row("2", 2))).size());
        assertThrows(ResponseStatusException.class, () -> checkout(definitions, List.of(row("1", 1))));
        assertThrows(ResponseStatusException.class, () -> checkout(definitions, List.of(row("1", 1), row("2", 1))));
        var unchecked = row("2", 2); unchecked.put("confirmed", false);
        assertThrows(ResponseStatusException.class, () -> checkout(definitions, List.of(row("1", 1), unchecked)));
        assertThrows(ResponseStatusException.class, () -> checkout(definitions, List.of(row("1", 1), row("1", 1))));
    }

    @Test void partialReturnAddsDeltasToPriorTotalsWithoutCountingEarlierRoundsAgain() {
        var first = returned(definitions, Map.of(), Set.of(), List.of(row("1", 1), row("2", 1)), false, "배터리 1개 미반납", true);
        assertTrue(first.missing()); assertEquals(1, first.rows().get(1).missingQuantity());
        var second = returned(definitions, Map.of("1", 1, "2", 1), Set.of(), List.of(row("2", 1)), true, "", false);
        assertFalse(second.missing());
        assertEquals(0, second.rows().getFirst().quantity());
        assertEquals(1, second.rows().getFirst().cumulativeQuantity());
        assertEquals(2, second.rows().get(1).cumulativeQuantity());
        assertEquals(0, second.rows().get(1).missingQuantity());
    }

    @Test void extraReturnRejectsOverReturnUnknownComponentsAndNoActualReturn() {
        var prior = Map.of("1", 1, "2", 1);
        assertThrows(ResponseStatusException.class, () -> returned(definitions, prior, Set.of(), List.of(row("2", 2)), true, "", false));
        assertThrows(ResponseStatusException.class, () -> returned(definitions, prior, Set.of(), List.of(row("9", 1)), true, "", false));
        assertThrows(ResponseStatusException.class, () -> returned(definitions, prior, Set.of(), List.of(row("2", 0)), true, "미반납", false));
    }

    @Test void damageRemainsRecordedAfterLaterNormalReturnAndNeedsExplanation() {
        var damaged = row("1", 1); damaged.put("condition", "손상");
        assertThrows(ResponseStatusException.class, () -> returned(definitions, Map.of(), Set.of(), List.of(damaged, row("2", 2)), false, "", false));
        damaged.put("note", "본체 외관 균열");
        assertTrue(returned(definitions, Map.of(), Set.of(), List.of(damaged, row("2", 2)), false, "", false).damaged());
        var later = returned(definitions, Map.of("1", 1, "2", 1), Set.of("1"), List.of(row("2", 1)), true, "", false);
        assertTrue(later.damaged()); assertFalse(later.missing());
    }

    @Test void holdRequiresMissingRequiredComponentsAndReason() {
        assertThrows(ResponseStatusException.class, () -> returned(definitions, Map.of(), Set.of(), List.of(row("1", 1), row("2", 1)), false, "", true));
        assertThrows(ResponseStatusException.class, () -> returned(definitions, Map.of(), Set.of(), List.of(row("1", 1), row("2", 2)), false, "보류", true));
    }
}
