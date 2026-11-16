package kr.ac.campusrent.equipment;

import java.math.BigDecimal;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.springframework.web.server.ResponseStatusException;
import static org.junit.jupiter.api.Assertions.*;

class EquipmentPolicyTest {
    private Map<String, Object> component(String name, int quantity, boolean body, boolean required) {
        return new HashMap<>(Map.of("name", name, "quantity", quantity, "body", body, "required", required));
    }

    private Map<String, Object> equipment() {
        Map<String, Object> input = new HashMap<>();
        input.put("modelId", "1");
        input.put("code", "F08-camera-a");
        input.put("name", "카메라");
        input.put("location", "보관실");
        input.put("department", "미디어실");
        input.put("lendAllowed", true);
        input.put("status", "NORMAL");
        input.put("isDemo", true);
        input.put("components", List.of(component("본체", 1, true, true), component("배터리", 2, false, true)));
        input.put("expectedVersion", 0);
        return input;
    }

    @Test void acceptsStringIdsAndPreservesCaseSensitiveManagementCodes() {
        var result = EquipmentPolicy.equipment(equipment(), true);
        assertEquals(1, result.modelId());
        assertEquals("F08-camera-a", result.code());
        assertEquals(0, result.expectedVersion());
        assertEquals(2, result.components().get(1).quantity());
    }

    @Test void requiresOneRequiredBodyOfQuantityOne() {
        assertThrows(ResponseStatusException.class, () -> EquipmentPolicy.components(List.of(component("배터리", 1, false, true))));
        assertThrows(ResponseStatusException.class, () -> EquipmentPolicy.components(List.of(component("본체", 1, true, true), component("다른 본체", 1, true, true))));
        assertThrows(ResponseStatusException.class, () -> EquipmentPolicy.components(List.of(component("본체", 2, true, true))));
        assertThrows(ResponseStatusException.class, () -> EquipmentPolicy.components(List.of(component("본체", 1, true, false))));
    }

    @Test void rejectsFractionalQuantityDuplicateNamesAndForeignInputShapes() {
        var fraction = component("배터리", 1, false, true);
        fraction.put("quantity", new BigDecimal("1.5"));
        assertThrows(ResponseStatusException.class, () -> EquipmentPolicy.components(List.of(component("본체", 1, true, true), fraction)));
        assertThrows(ResponseStatusException.class, () -> EquipmentPolicy.components(List.of(component("Body", 1, true, true), component("body", 1, false, true))));
        assertThrows(ResponseStatusException.class, () -> EquipmentPolicy.components(List.of("not an object")));
        var input = equipment(); input.put("lendAllowed", "true");
        assertThrows(ResponseStatusException.class, () -> EquipmentPolicy.equipment(input, true));
    }

    @Test void rejectsDuplicateComponentIdsAndInvalidVersion() {
        var first = component("본체", 1, true, true); first.put("id", "8");
        var second = component("배터리", 1, false, true); second.put("id", "8");
        assertThrows(ResponseStatusException.class, () -> EquipmentPolicy.components(List.of(first, second)));
        var input = equipment(); input.put("expectedVersion", new BigDecimal("0.5"));
        assertThrows(ResponseStatusException.class, () -> EquipmentPolicy.equipment(input, true));
        input.remove("expectedVersion");
        assertThrows(ResponseStatusException.class, () -> EquipmentPolicy.equipment(input, true));
    }

    @Test void enforcesColumnLengthsAndStructuredModelSpecifications() {
        var input = equipment(); input.put("location", "가".repeat(201));
        assertThrows(ResponseStatusException.class, () -> EquipmentPolicy.equipment(input, false));
        Map<String, Object> model = new HashMap<>(Map.of("typeId", "1", "code", "MODEL-1", "name", "카메라 모델", "isDemo", true, "specs", List.of()));
        assertTrue(EquipmentPolicy.model(model).specs().isEmpty());
        model.put("specs", List.of(Map.of("name", "화소", "value", "24", "unit", "MP", "verified", true)));
        assertTrue(EquipmentPolicy.model(model).specs().getFirst().verified());
        List<Object> duplicate = new ArrayList<>();
        duplicate.addAll((List<?>) model.get("specs"));
        duplicate.add(duplicate.getFirst());
        model.put("specs", duplicate);
        assertThrows(ResponseStatusException.class, () -> EquipmentPolicy.model(model));
    }
}
