package kr.ac.campusrent.alternatives;

import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import static kr.ac.campusrent.equipment.EquipmentPolicy.id;
import static kr.ac.campusrent.equipment.EquipmentPolicy.requiredText;
import static kr.ac.campusrent.rental.RentalPolicy.bad;
import static kr.ac.campusrent.rental.RentalPolicy.expectedVersion;
import static kr.ac.campusrent.rental.RentalPolicy.text;

/** A replacement is a directed administrator-defined relation, independent of current availability. */
public final class AlternativePolicy {
    private AlternativePolicy() { }

    public record Alternative(long targetId, String reason, String difference, boolean enabled) { }
    public record Configuration(long expectedVersion, List<Alternative> alternatives) { }

    public static Configuration configuration(long sourceId, Map<String, Object> input) {
        if (input == null) throw bad("대체 장비 설정을 입력해주세요.");
        long version = expectedVersion(input.get("expectedVersion"));
        if (!(input.get("alternatives") instanceof List<?> entries) || entries.size() > 999)
            throw bad("대체 장비 목록은 999개 이하로 입력해주세요.");
        Set<Long> unique = new HashSet<>();
        List<Alternative> alternatives = new ArrayList<>();
        for (Object entry : entries) {
            if (!(entry instanceof Map<?, ?> row)) throw bad("대체 장비 입력 형식을 확인해주세요.");
            long targetId = id(row.get("targetId"), "대체 장비");
            if (sourceId == targetId) throw bad("자기 자신을 대체 장비로 지정할 수 없습니다.");
            if (!unique.add(targetId)) throw bad("같은 대체 장비를 중복 지정할 수 없습니다.");
            if (!(row.get("enabled") instanceof Boolean enabled)) throw bad("대체 관계 사용 여부를 선택해주세요.");
            alternatives.add(new Alternative(targetId, requiredText(row.get("reason"), 500, "대체 지정 사유"),
                    text(row.get("difference"), 1000, "주요 차이"), enabled));
        }
        return new Configuration(version, List.copyOf(alternatives));
    }
}
