package kr.ac.campusrent.equipment;

import java.math.BigDecimal;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import static kr.ac.campusrent.rental.RentalPolicy.bad;
import static kr.ac.campusrent.rental.RentalPolicy.integer;
import static kr.ac.campusrent.rental.RentalPolicy.text;

/** Validates management input before any shared catalog definition is changed. */
public final class EquipmentPolicy {
    private EquipmentPolicy() { }

    public record Component(Long id, String name, int quantity, boolean body, boolean required) { }
    public record Spec(String name, String value, String unit, boolean verified) { }
    public record Model(long typeId, String code, String name, String manufacturer,
                        boolean isDemo, List<Spec> specs) { }
    public record Equipment(long modelId, String code, String name, String location, String department,
                            boolean lendAllowed, String status, boolean isDemo, List<Component> components,
                            String reason, boolean confirmed, Long expectedVersion) { }

    public static long id(Object input, String field) {
        if (input instanceof String value && value.matches("[0-9]{1,10}")) {
            try { return integer(new BigDecimal(value), field, 1, 9_999_999_999L); }
            catch (NumberFormatException error) { throw bad(field + " 값을 확인해주세요."); }
        }
        return integer(input, field, 1, 9_999_999_999L);
    }

    public static String requiredText(Object input, int maximum, String field) {
        String result = text(input, maximum, field);
        if (result.isBlank()) throw bad(field + "을(를) 입력해주세요.");
        return result;
    }

    public static Model model(Map<String, Object> input) {
        long typeId = id(input.get("typeId"), "장비 품목");
        String code = requiredText(input.get("code"), 30, "모델 코드");
        String name = requiredText(input.get("name"), 100, "모델명");
        String manufacturer = text(input.get("manufacturer"), 100, "제조사");
        boolean isDemo = flag(input.get("isDemo"), "가상 장비 여부");
        Object rawSpecs = input.get("specs");
        if (!(rawSpecs instanceof List<?> entries) || entries.size() > 999)
            throw bad("사양 목록은 999개 이하로 입력해주세요.");
        List<Spec> specs = new ArrayList<>();
        Set<String> names = new HashSet<>();
        for (Object entry : entries) {
            Map<?, ?> spec = object(entry, "모델 사양");
            String specName = requiredText(spec.get("name"), 100, "사양 항목명");
            if (!names.add(specName.toLowerCase(Locale.ROOT))) throw bad("사양 항목명이 중복되었습니다.");
            specs.add(new Spec(specName, text(spec.get("value"), 300, "사양 값"),
                    text(spec.get("unit"), 30, "사양 단위"), flag(spec.get("verified"), "사양 확인 여부")));
        }
        return new Model(typeId, code, name, manufacturer, isDemo, List.copyOf(specs));
    }

    public static Equipment equipment(Map<String, Object> input, boolean updating) {
        long modelId = id(input.get("modelId"), "장비 모델");
        String code = requiredText(input.get("code"), 30, "개별 관리번호");
        String name = requiredText(input.get("name"), 100, "장비명");
        String location = requiredText(input.get("location"), 200, "보관 장소");
        String department = text(input.get("department"), 100, "담당 부서");
        boolean lendAllowed = flag(input.get("lendAllowed"), "대여 허용 여부");
        String status = requiredText(input.get("status"), 10, "운영 상태");
        if (!Set.of("NORMAL", "CHECKING", "DISABLED").contains(status)) throw bad("운영 상태를 확인해주세요.");
        boolean isDemo = flag(input.get("isDemo"), "가상 장비 여부");
        String reason = text(input.get("reason"), 1000, "변경 사유");
        boolean confirmed = Boolean.TRUE.equals(input.get("confirmed"));
        if (input.get("confirmed") != null && !(input.get("confirmed") instanceof Boolean))
            throw bad("실제 확인 여부를 확인해주세요.");
        Long version = updating ? integer(input.get("expectedVersion"), "기대 버전", 0, 9_999_999_999L) : null;
        return new Equipment(modelId, code, name, location, department, lendAllowed, status, isDemo,
                components(input.get("components")), reason, confirmed, version);
    }

    static List<Component> components(Object input) {
        if (!(input instanceof List<?> entries) || entries.isEmpty() || entries.size() > 999)
            throw bad("본체를 포함한 구성품을 1~999개 입력해주세요.");
        List<Component> components = new ArrayList<>();
        Set<String> names = new HashSet<>();
        Set<Long> ids = new HashSet<>();
        int bodyCount = 0;
        for (Object entry : entries) {
            Map<?, ?> component = object(entry, "구성품");
            Long componentId = component.get("id") == null ? null : id(component.get("id"), "구성품 식별자");
            if (componentId != null && !ids.add(componentId)) throw bad("구성품 식별자가 중복되었습니다.");
            String name = requiredText(component.get("name"), 100, "구성품명");
            if (!names.add(name.toLowerCase(Locale.ROOT))) throw bad("구성품명이 중복되었습니다.");
            int quantity = Math.toIntExact(integer(component.get("quantity"), "구성품 수량", 1, 99_999));
            boolean body = flag(component.get("body"), "본체 여부");
            boolean required = flag(component.get("required"), "필수 반환 여부");
            if (body) {
                bodyCount++;
                if (!required || quantity != 1) throw bad("본체는 필수 반환 구성품이며 수량은 1개여야 합니다.");
            }
            components.add(new Component(componentId, name, quantity, body, required));
        }
        if (bodyCount != 1) throw bad("본체 구성품을 정확히 하나 지정해주세요.");
        return List.copyOf(components);
    }

    private static Map<?, ?> object(Object input, String field) {
        if (!(input instanceof Map<?, ?> object)) throw bad(field + " 입력 형식을 확인해주세요.");
        return object;
    }

    private static boolean flag(Object input, String field) {
        if (!(input instanceof Boolean value)) throw bad(field + "를 선택해주세요.");
        return value;
    }
}
