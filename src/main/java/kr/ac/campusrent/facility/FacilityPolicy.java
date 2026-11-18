package kr.ac.campusrent.facility;

import java.math.BigDecimal;
import java.time.LocalDateTime;
import java.time.LocalTime;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import static kr.ac.campusrent.rental.RentalPolicy.bad;
import static kr.ac.campusrent.rental.RentalPolicy.date;
import static kr.ac.campusrent.rental.RentalPolicy.integer;
import static kr.ac.campusrent.rental.RentalPolicy.text;

/** Validates facility input without changing reservations or stored usage history. */
public final class FacilityPolicy {
    private FacilityPolicy() { }

    public record Hours(LocalTime open, LocalTime close) {
        public List<String> view() { return List.of(open.toString(), close.toString()); }
        public boolean contains(LocalDateTime start, LocalDateTime end) {
            return start.toLocalDate().equals(end.toLocalDate()) &&
                    !start.toLocalTime().isBefore(open) && !end.toLocalTime().isAfter(close);
        }
    }
    public record Facility(String code, String name, String type, String location, int capacity,
                           String fixedEquipmentInfo, boolean useAllowed, String status, boolean isDemo,
                           Map<Integer, Hours> hours, Set<Long> purposeIds, String reason,
                           boolean confirmed, Long expectedVersion) { }
    public record Block(LocalDateTime start, LocalDateTime end, String reason, boolean confirmed,
                        long expectedVersion) { }

    public static Facility facility(Map<String, Object> input, boolean updating) {
        if (input == null) throw bad("시설 정보를 입력해주세요.");
        String status = requiredText(input.get("status"), 10, "운영 상태");
        if (!Set.of("NORMAL", "CHECKING", "DISABLED").contains(status))
            throw bad("시설 운영 상태를 확인해주세요.");
        return new Facility(requiredText(input.get("code"), 30, "시설 관리번호"),
                requiredText(input.get("name"), 100, "시설명"),
                requiredText(input.get("type"), 20, "시설 유형"),
                requiredText(input.get("location"), 200, "시설 위치"),
                Math.toIntExact(integer(input.get("capacity"), "수용 인원", 1, 999)),
                text(input.get("fixedEquipmentInfo"), 1000, "비치 설비 안내"),
                flag(input.get("useAllowed"), "이용 허용 여부"), status,
                flag(input.get("isDemo"), "가상 시설 여부"), hours(input.get("hoursByWeekday")),
                purposeIds(input.get("purposeIds")), text(input.get("reason"), 500, "변경 사유"),
                confirmation(input.get("confirmed")),
                updating ? version(input.get("expectedVersion")) : null);
    }

    public static Block block(Map<String, Object> input) {
        if (input == null) throw bad("운영 제한 정보를 입력해주세요.");
        LocalDateTime start = date(input.get("start")), end = date(input.get("end"));
        if (start.getYear() < 1 || start.getYear() > 9999 || end.getYear() < 1 || end.getYear() > 9999)
            throw bad("운영 제한 연도는 1부터 9999까지 입력해주세요.");
        if (!end.isAfter(start)) throw bad("제한 종료 시각은 시작 시각보다 늦어야 합니다.");
        String reason = requiredText(input.get("reason"), 500, "운영 제한 사유");
        boolean confirmed = confirmation(input.get("confirmed"));
        requireConfirmation(confirmed, reason);
        return new Block(start, end, reason, confirmed, version(input.get("expectedVersion")));
    }

    public static long version(Object input) { return integer(input, "기대 버전", 0, 9_999_999_999L); }

    public static long id(Object input, String field) {
        if (input instanceof String value && value.matches("[0-9]{1,10}"))
            return integer(new BigDecimal(value), field, 1, 9_999_999_999L);
        return integer(input, field, 1, 9_999_999_999L);
    }

    public static String requiredText(Object input, int maximum, String field) {
        String result = text(input, maximum, field);
        if (result.isBlank()) throw bad(field + "을(를) 입력해주세요.");
        return result;
    }

    public static boolean confirmation(Object input) {
        if (input == null) return false;
        return flag(input, "실제 확인 여부");
    }

    public static void requireConfirmation(boolean confirmed, String reason) {
        if (!confirmed || reason.isBlank()) throw bad("운영 변경의 실제 확인과 사유를 입력해주세요.");
    }

    public static boolean overlaps(LocalDateTime start, LocalDateTime end,
                                   LocalDateTime otherStart, LocalDateTime otherEnd) {
        return start.isBefore(otherEnd) && end.isAfter(otherStart);
    }

    static Map<Integer, Hours> hours(Object input) {
        if (!(input instanceof Map<?, ?> days) || days.size() > 7)
            throw bad("요일별 운영 시간을 입력해주세요.");
        Map<Integer, Hours> result = new LinkedHashMap<>();
        for (Map.Entry<?, ?> entry : days.entrySet()) {
            if (!(entry.getKey() instanceof String day) || !day.matches("[1-7]"))
                throw bad("요일 번호는 월요일 1부터 일요일 7까지 입력해주세요.");
            if (!(entry.getValue() instanceof List<?> values) || values.size() != 2)
                throw bad("요일별 시작·종료 시각을 입력해주세요.");
            LocalTime open = clockTime(values.get(0)), close = clockTime(values.get(1));
            if (!close.isAfter(open)) throw bad("운영 종료 시각은 같은 날의 시작 시각보다 늦어야 합니다.");
            result.put(Integer.parseInt(day), new Hours(open, close));
        }
        return Map.copyOf(result);
    }

    static Set<Long> purposeIds(Object input) {
        if (!(input instanceof List<?> entries) || entries.size() > 999)
            throw bad("허용 목적 목록을 확인해주세요.");
        Set<Long> result = new LinkedHashSet<>();
        for (Object entry : entries)
            if (!result.add(id(entry, "이용 목적"))) throw bad("허용 목적이 중복되었습니다.");
        return Set.copyOf(result);
    }

    private static LocalTime clockTime(Object input) {
        if (!(input instanceof String value) || !value.matches("([01][0-9]|2[0-3]):[0-5][0-9]"))
            throw bad("운영 시각은 HH:mm 형식으로 입력해주세요.");
        return LocalTime.parse(value);
    }

    private static boolean flag(Object input, String field) {
        if (!(input instanceof Boolean value)) throw bad(field + "를 선택해주세요.");
        return value;
    }
}
