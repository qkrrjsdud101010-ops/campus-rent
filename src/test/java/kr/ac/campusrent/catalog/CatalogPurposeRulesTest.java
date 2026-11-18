package kr.ac.campusrent.catalog;

import java.util.List;
import java.util.Map;
import java.util.Set;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

class CatalogPurposeRulesTest {
    private static final String PURPOSES = "SELECT PURPOSE_ID,PURPOSE_NAME FROM USE_PURPOSE WHERE ENABLED_YN='Y' ORDER BY PURPOSE_ID";
    private static final String KEYWORDS = "SELECT K.PURPOSE_ID,K.KEYWORD_TEXT,K.MATCH_MODE,K.EFFECT_CODE,K.PRIORITY_NO FROM PURPOSE_KEYWORD K JOIN USE_PURPOSE P ON P.PURPOSE_ID=K.PURPOSE_ID WHERE K.ENABLED_YN='Y' AND P.ENABLED_YN='Y' ORDER BY K.PURPOSE_ID,K.PRIORITY_NO DESC,K.KEYWORD_ID";
    private static final String EQUIPMENT = "SELECT R.PURPOSE_ID,T.TYPE_NAME,R.NEED_LEVEL,R.REASON_TEXT FROM PURPOSE_EQUIPMENT_RULE R JOIN USE_PURPOSE P ON P.PURPOSE_ID=R.PURPOSE_ID JOIN EQUIPMENT_TYPE T ON T.TYPE_ID=R.TYPE_ID WHERE P.ENABLED_YN='Y' AND T.ENABLED_YN='Y' ORDER BY R.PURPOSE_ID,R.DISPLAY_ORDER,R.TYPE_ID";
    private final JdbcTemplate jdbc = mock(JdbcTemplate.class);
    private final CatalogService catalog = new CatalogService(jdbc);

    @Test void groupsConfiguredKeywordsAndEquipmentUnderTheirEnabledPurpose() {
        when(jdbc.queryForList(PURPOSES)).thenReturn(List.of(
                Map.of("PURPOSE_ID", 1, "PURPOSE_NAME", "팀 회의"), Map.of("PURPOSE_ID", 2, "PURPOSE_NAME", "인터뷰 촬영")));
        when(jdbc.queryForList(KEYWORDS)).thenReturn(List.of(
                Map.of("PURPOSE_ID", 2, "KEYWORD_TEXT", "촬영", "MATCH_MODE", "CONTAINS", "EFFECT_CODE", "INCLUDE", "PRIORITY_NO", 4)));
        when(jdbc.queryForList(EQUIPMENT)).thenReturn(List.of(
                Map.of("PURPOSE_ID", 2, "TYPE_NAME", "카메라", "NEED_LEVEL", "REQUIRED", "REASON_TEXT", "영상 기록에 필요")));

        var rules = catalog.purposeRules();

        assertEquals(List.of("팀 회의", "인터뷰 촬영"), rules.stream().map(row -> row.get("name")).toList());
        assertEquals(List.of(), rules.getFirst().get("keywords"));
        assertEquals(List.of(), rules.getFirst().get("equipment"));
        assertEquals(List.of(Map.of("keyword", "촬영", "matchMode", "CONTAINS", "effect", "INCLUDE", "priority", 4L)), rules.get(1).get("keywords"));
        assertEquals(List.of(Map.of("typeName", "카메라", "needLevel", "REQUIRED", "reason", "영상 기록에 필요")), rules.get(1).get("equipment"));
    }

    @Test void emptyDatabaseRulesDoNotInventInterviewPurposeOrWriteSeedData() {
        assertEquals(List.of(), catalog.purposeRules());
        verify(jdbc, never()).update(anyString(), any(Object[].class));
    }

    @Test void purposeWithoutRulesIsRetainedAndUnlistedParentsCannotLeakThroughChildren() {
        when(jdbc.queryForList(PURPOSES)).thenReturn(List.of(Map.of("PURPOSE_ID", 1, "PURPOSE_NAME", "발표 연습")));
        when(jdbc.queryForList(KEYWORDS)).thenReturn(List.of(Map.of("PURPOSE_ID", 99, "KEYWORD_TEXT", "면접", "MATCH_MODE", "CONTAINS", "EFFECT_CODE", "INCLUDE", "PRIORITY_NO", 5)));
        when(jdbc.queryForList(EQUIPMENT)).thenReturn(List.of(Map.of("PURPOSE_ID", 99, "TYPE_NAME", "마이크", "NEED_LEVEL", "OPTIONAL", "REASON_TEXT", "선택 사항")));

        assertEquals(List.of(Map.of("purposeId", "1", "name", "발표 연습", "keywords", List.of(), "equipment", List.of())), catalog.purposeRules());
    }

    @Test void preservesExactExclusionPriorityAndOptionalNeedWithoutConvertingThemToPermissions() {
        when(jdbc.queryForList(PURPOSES)).thenReturn(List.of(Map.of("PURPOSE_ID", 3, "PURPOSE_NAME", "회의")));
        when(jdbc.queryForList(KEYWORDS)).thenReturn(List.of(Map.of("PURPOSE_ID", 3, "KEYWORD_TEXT", "촬영 안 함", "MATCH_MODE", "EXACT", "EFFECT_CODE", "EXCLUDE", "PRIORITY_NO", 999)));
        when(jdbc.queryForList(EQUIPMENT)).thenReturn(List.of(Map.of("PURPOSE_ID", 3, "TYPE_NAME", "마이크", "NEED_LEVEL", "OPTIONAL", "REASON_TEXT", "필요 시 사용")));

        var rule = catalog.purposeRules().getFirst();

        assertEquals(List.of(Map.of("keyword", "촬영 안 함", "matchMode", "EXACT", "effect", "EXCLUDE", "priority", 999L)), rule.get("keywords"));
        assertEquals(List.of(Map.of("typeName", "마이크", "needLevel", "OPTIONAL", "reason", "필요 시 사용")), rule.get("equipment"));
        assertFalse(rule.containsKey("allowedUses"));
    }

    @Test void metadataProjectionContainsOnlyPublicRuleFields() {
        when(jdbc.queryForList(PURPOSES)).thenReturn(List.of(Map.of("PURPOSE_ID", 1, "PURPOSE_NAME", "회의", "PASSWORD", "private")));
        when(jdbc.queryForList(KEYWORDS)).thenReturn(List.of(Map.of("PURPOSE_ID", 1, "KEYWORD_TEXT", "회의", "MATCH_MODE", "CONTAINS", "EFFECT_CODE", "INCLUDE", "PRIORITY_NO", 1, "USER_ID", 7)));
        when(jdbc.queryForList(EQUIPMENT)).thenReturn(List.of(Map.of("PURPOSE_ID", 1, "TYPE_NAME", "마이크", "NEED_LEVEL", "OPTIONAL", "REASON_TEXT", "음성 기록용", "CONFIGURED_BY", 7)));

        var rule = catalog.purposeRules().getFirst();

        assertEquals(Set.of("purposeId", "name", "keywords", "equipment"), rule.keySet());
        assertEquals(Set.of("keyword", "matchMode", "effect", "priority"), ((Map<?, ?>) ((List<?>) rule.get("keywords")).getFirst()).keySet());
        assertEquals(Set.of("typeName", "needLevel", "reason"), ((Map<?, ?>) ((List<?>) rule.get("equipment")).getFirst()).keySet());
    }

    @Test void publicControllerAddsRulesWhileKeepingLegacyCatalogFields() {
        CatalogService service = mock(CatalogService.class);
        var rules = List.<Map<String, Object>>of(Map.of("purposeId", "1", "name", "회의", "keywords", List.of(), "equipment", List.of()));
        when(service.resources()).thenReturn(List.of(Map.of("id", "equipment:1")));
        when(service.purposes()).thenReturn(List.of("회의"));
        when(service.purposeRules()).thenReturn(rules);
        when(service.reservations()).thenReturn(List.of());
        when(service.restrictions()).thenReturn(Map.of());

        var response = new CatalogController(service).get();

        assertEquals(Set.of("resources", "purposes", "purposeRules", "reservations", "restrictions"), response.keySet());
        assertEquals(List.of("회의"), response.get("purposes"));
        assertEquals(rules, response.get("purposeRules"));
        assertEquals(List.of(Map.of("id", "equipment:1")), response.get("resources"));
    }
}
