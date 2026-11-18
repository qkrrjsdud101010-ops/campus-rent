package kr.ac.campusrent.personal;

import java.time.*;
import java.util.*;
import kr.ac.campusrent.auth.AuthSupport;
import kr.ac.campusrent.auth.CurrentUser;
import kr.ac.campusrent.rental.RentalService;
import org.springframework.stereotype.Service;

@Service
public class PersonalSummaryService {
    static final ZoneId SEOUL = ZoneId.of("Asia/Seoul");
    private final RentalService rentals;
    private final Clock clock;

    @org.springframework.beans.factory.annotation.Autowired
    public PersonalSummaryService(RentalService rentals) { this(rentals, Clock.system(SEOUL)); }
    PersonalSummaryService(RentalService rentals, Clock clock) { this.rentals = rentals; this.clock = clock; }

    @SuppressWarnings("unchecked")
    public Map<String,Object> summary(CurrentUser user) {
        AuthSupport.requireRole(user, "student");
        // Reuse the ownership-filtered, student-safe request projection.
        var records = (List<Map<String,Object>>) rentals.list(user).get("records");
        return summarize(records, clock.instant());
    }

    static Map<String,Object> summarize(List<Map<String,Object>> records, Instant instant) {
        LocalDateTime now = LocalDateTime.ofInstant(instant, SEOUL);
        LocalDateTime day = now.toLocalDate().atStartOfDay(), tomorrow = day.plusDays(1);
        long pickup = 0, returnDue = 0, facilityUse = 0;
        List<Candidate> candidates = new ArrayList<>();
        for (var record : records) for (var item : maps(record.get("items"))) {
            String code = text(item.get("statusCode"));
            boolean facility = "시설".equals(item.get("kind"));
            var condition = map(item.get("condition"));
            LocalDateTime start = date(condition.get("start")), end = date(condition.get("end"));
            if (!facility && "APPROVED".equals(code) && within(start, day, tomorrow)) pickup++;
            if (!facility && "CHECKED_OUT".equals(code) && within(end, day, tomorrow)) returnDue++;
            if (facility && Set.of("APPROVED","IN_USE").contains(code) && start != null && end != null && start.isBefore(tomorrow) && end.isAfter(day)) facilityUse++;

            int priority;
            String action;
            LocalDateTime at;
            if ("RETURN_HELD".equals(code)) {
                priority = 0; action = "return-held";
                at = latest(maps(item.get("inspections")), "at", null);
            } else if ("RETURN_REQUESTED".equals(code)) {
                priority = 1; action = "return-requested";
                at = latest(maps(item.get("history")), "at", "RETURN_REQUESTED");
            } else {
                priority = 2;
                action = switch (code) {
                    case "APPROVED" -> facility ? "facility-start" : "pickup";
                    case "CHECKED_OUT" -> facility ? "" : "return";
                    case "IN_USE" -> facility ? "facility-end" : "";
                    default -> "";
                };
                at = Set.of("return","facility-end").contains(action) ? end : start;
                if (action.isEmpty() || !within(at, now, now.plusDays(7))) continue;
            }
            Map<String,Object> todo = new LinkedHashMap<>();
            todo.put("itemId", text(item.get("id")));
            todo.put("requestNumber", text(record.get("number")));
            todo.put("originalIndex", item.getOrDefault("originalIndex", 0));
            for (String key : List.of("name","kind","status","statusCode")) todo.put(key,text(item.get(key)));
            todo.put("actionAt", at == null ? "" : at.toString());
            todo.put("actionType", action);
            todo.put("reason", "RETURN_HELD".equals(code) ? text(item.get("reason")) : "");
            todo.put("missingComponents", "RETURN_HELD".equals(code) ? missing(item) : List.of());
            candidates.add(new Candidate(priority, at, text(item.get("id")), todo));
        }
        candidates.sort((a,b) -> {
            int order = Integer.compare(a.priority, b.priority);
            if (order != 0) return order;
            Comparator<LocalDateTime> times = a.priority < 2 ? Comparator.reverseOrder() : Comparator.naturalOrder();
            order = Comparator.nullsLast(times).compare(a.at,b.at);
            return order != 0 ? order : numericId(a.id).compareTo(numericId(b.id));
        });
        Set<String> seen = new HashSet<>();
        var todo = candidates.stream().filter(candidate -> seen.add(candidate.id)).limit(3).map(Candidate::view).toList();
        return Map.of("basisDate",day.toLocalDate().toString(),"generatedAt",now.atZone(SEOUL).toOffsetDateTime().toString(),
                "timeZone",SEOUL.getId(),"counts",Map.of("pickup",pickup,"returnDue",returnDue,"facilityUse",facilityUse),"todo",todo);
    }

    private record Candidate(int priority, LocalDateTime at, String id, Map<String,Object> view) { }
    private static boolean within(LocalDateTime value, LocalDateTime from, LocalDateTime until) {
        return value != null && !value.isBefore(from) && value.isBefore(until);
    }
    private static LocalDateTime latest(List<Map<String,Object>> rows, String key, String action) {
        return rows.stream().filter(row -> action == null || action.equals(row.get("action")))
                .map(row -> date(row.get(key))).filter(Objects::nonNull).max(Comparator.naturalOrder()).orElse(null);
    }
    private static List<Map<String,Object>> missing(Map<String,Object> item) {
        Map<String,Object> returned = map(item.get("returnedComponents"));
        List<Map<String,Object>> result = new ArrayList<>();
        for (var component : maps(item.get("checkoutComponents"))) {
            String id = text(component.get("componentId"));
            long quantity = number(component.get("quantity")) - number(returned.get(id));
            if (quantity > 0) result.add(Map.of("componentId",id,"name",text(component.get("name")),"quantity",quantity));
        }
        return result;
    }
    private static LocalDateTime date(Object value) {
        if (value == null || text(value).isBlank()) return null;
        try { return LocalDateTime.parse(text(value)); }
        catch (RuntimeException ignored) {
            try { return OffsetDateTime.parse(text(value)).atZoneSameInstant(SEOUL).toLocalDateTime(); }
            catch (RuntimeException invalid) { return null; }
        }
    }
    private static String text(Object value) { return value == null ? "" : String.valueOf(value); }
    private static long number(Object value) { try {return Long.parseLong(text(value));}catch(RuntimeException ignored){return 0;} }
    private static java.math.BigInteger numericId(String id) {
        try {return new java.math.BigInteger(id);}catch(RuntimeException ignored){return java.math.BigInteger.ZERO;}
    }
    @SuppressWarnings("unchecked") private static Map<String,Object> map(Object value) {
        return value instanceof Map<?,?> ? (Map<String,Object>)value : Map.of();
    }
    @SuppressWarnings("unchecked") private static List<Map<String,Object>> maps(Object value) {
        return value instanceof List<?> rows ? rows.stream().filter(Map.class::isInstance).map(row -> (Map<String,Object>)row).toList() : List.of();
    }
}
