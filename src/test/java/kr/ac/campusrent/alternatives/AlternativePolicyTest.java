package kr.ac.campusrent.alternatives;

import java.util.HashMap;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.springframework.web.server.ResponseStatusException;
import static org.junit.jupiter.api.Assertions.*;

class AlternativePolicyTest {
    static Map<String, Object> relation(long target, boolean enabled) {
        return new HashMap<>(Map.of("targetId", String.valueOf(target), "reason", "같은 활동에 활용 가능",
                "difference", "구성품과 사양 확인 필요", "enabled", enabled));
    }

    static Map<String, Object> input(Map<String, Object> relation) {
        return Map.of("expectedVersion", 4, "alternatives", List.of(relation));
    }

    @Test void acceptsAnEmptyListToDisableExistingRelations() {
        assertTrue(AlternativePolicy.configuration(1, Map.of("expectedVersion", 4, "alternatives", List.of())).alternatives().isEmpty());
    }

    @Test void selfRelationsAndDuplicateNumericIdentitiesAreRejected() {
        assertThrows(ResponseStatusException.class, () -> AlternativePolicy.configuration(1, input(relation(1, true))));
        var numeric = relation(2, true); numeric.put("targetId", 2);
        assertThrows(ResponseStatusException.class, () -> AlternativePolicy.configuration(1,
                Map.of("expectedVersion", 4, "alternatives", List.of(relation(2, true), numeric))));
    }

    @Test void everyRelationNeedsItsOwnReasonAndBooleanEnabledFlag() {
        var noReason = relation(2, false); noReason.put("reason", " ");
        assertThrows(ResponseStatusException.class, () -> AlternativePolicy.configuration(1, input(noReason)));
        var wrongFlag = relation(2, true); wrongFlag.put("enabled", "true");
        assertThrows(ResponseStatusException.class, () -> AlternativePolicy.configuration(1, input(wrongFlag)));
    }

    @Test void reasonAndDifferenceUseSchemaCharacterLimits() {
        var exact = relation(2, true); exact.put("reason", "🎓".repeat(500)); exact.put("difference", "차".repeat(1000));
        assertEquals(1000, AlternativePolicy.configuration(1, input(exact)).alternatives().getFirst().difference().length());
        exact.put("reason", "사".repeat(501));
        assertThrows(ResponseStatusException.class, () -> AlternativePolicy.configuration(1, input(exact)));
        exact.put("reason", "이유"); exact.put("difference", "차".repeat(1001));
        assertThrows(ResponseStatusException.class, () -> AlternativePolicy.configuration(1, input(exact)));
    }

    @Test void optionalDifferenceIsNormalizedWithoutInferringAnyCategoryRule() {
        var row = relation(2, false); row.remove("difference");
        var result = AlternativePolicy.configuration(1, input(row)).alternatives().getFirst();
        assertEquals("", result.difference()); assertFalse(result.enabled());
    }

    @Test void malformedVersionsListsAndIdsAreRejected() {
        assertThrows(ResponseStatusException.class, () -> AlternativePolicy.configuration(1,
                Map.of("expectedVersion", "4", "alternatives", List.of())));
        assertThrows(ResponseStatusException.class, () -> AlternativePolicy.configuration(1,
                Map.of("expectedVersion", 4, "alternatives", "2")));
        var fractional = relation(2, true); fractional.put("targetId", 2.5);
        assertThrows(ResponseStatusException.class, () -> AlternativePolicy.configuration(1, input(fractional)));
    }
}
