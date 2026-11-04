package kr.ac.campusrent.rental;

import java.math.BigDecimal;
import java.sql.Timestamp;
import java.time.Clock;
import java.time.LocalDateTime;
import java.time.format.DateTimeParseException;
import java.util.*;
import org.springframework.http.HttpStatus;
import org.springframework.web.server.ResponseStatusException;

/** Server-side state and inspection validation, independent of browser data. */
public final class RentalPolicy {
    private RentalPolicy() {}
    public record Condition(LocalDateTime start, LocalDateTime end, Integer people, String purpose) {
        public Timestamp startTimestamp() { return Timestamp.valueOf(start); }
        public Timestamp endTimestamp() { return Timestamp.valueOf(end); }
        public Map<String,Object> view() {
            return Map.of("start",start.toString(),"end",end.toString(),"people",people==null?1:people,"use",purpose,"purpose",purpose);
        }
    }
    public record Component(String id,String name,int requiredQuantity,int deliveredQuantity,boolean required,boolean body) {}
    public record InspectionRow(Component component,int quantity,int cumulativeQuantity,boolean damaged,String condition,String note) {
        public int missingQuantity() { return component.deliveredQuantity()-cumulativeQuantity; }
    }
    public record InspectionResult(List<InspectionRow> rows,boolean missing,boolean damaged) {}

    public static Condition condition(Map<String,Object> input,boolean facility,Clock clock) {
        if(input==null) throw bad("이용 조건을 입력해주세요.");
        LocalDateTime start=date(input.get("start")),end=date(input.get("end"));
        if(!start.isAfter(LocalDateTime.now(clock))) throw bad("시작 시간은 현재보다 이후여야 합니다.");
        if(!end.isAfter(start)) throw bad("종료 시간은 시작 시간보다 늦어야 합니다.");
        Integer people=input.get("people")==null?null:Math.toIntExact(integer(input.get("people"),"이용 인원",1,999));
        String purpose=text(input.get("purpose"),50,"이용 목적");
        if(purpose.isBlank()) purpose=text(input.get("use"),50,"이용 목적");
        if(facility&&(people==null||purpose.isBlank())) throw bad("시설 이용 인원과 실제 이용 목적을 입력해주세요.");
        return new Condition(start,end,people,purpose);
    }
    public static LocalDateTime date(Object value) {
        if(!(value instanceof String text)||text.isBlank()||text.length()>40) throw bad("시작·종료 날짜와 시간을 입력해주세요.");
        try { return LocalDateTime.parse(text); }
        catch(DateTimeParseException exception) { throw bad("시작·종료 날짜와 시간 형식을 확인해주세요."); }
    }
    public static long integer(Object value,String field,long minimum,long maximum) {
        if(!(value instanceof Number)) throw bad(field+" 값을 확인해주세요.");
        try {
            long number=new BigDecimal(value.toString()).longValueExact();
            if(number<minimum||number>maximum) throw bad(field+" 값을 확인해주세요.");
            return number;
        } catch(ArithmeticException|NumberFormatException exception) { throw bad(field+" 값을 확인해주세요."); }
    }
    public static long expectedVersion(Object value) { return integer(value,"기대 버전",0,9_999_999_999L); }
    public static String text(Object value,int maximum,String field) {
        if(value==null) return "";
        if(!(value instanceof String text)) throw bad(field+" 형식을 확인해주세요.");
        String result=text.trim();
        if(result.codePointCount(0,result.length())>maximum) throw bad(field+"은(는) "+maximum+"자 이내로 입력해주세요.");
        return result;
    }
    public static String statusLabel(String kind,String code) {
        return switch(code) {
            case "PENDING" -> "승인 대기";
            case "APPROVED" -> "E".equals(kind)?"승인·수령 대기":"예약 승인";
            case "CHECKED_OUT" -> "대여 중";
            case "RETURN_REQUESTED" -> "반납 신청";
            case "RETURN_HELD" -> "반납 보류";
            case "RETURNED" -> "반납 완료";
            case "IN_USE" -> "이용 중";
            case "COMPLETED" -> "이용 완료";
            case "REJECTED" -> "거절";
            case "CANCELLED" -> "신청 취소 완료";
            default -> throw new IllegalStateException("지원하지 않는 저장 상태입니다.");
        };
    }
    public static String operatingLabel(String code) {
        return switch(code) { case "NORMAL"->"정상";case "CHECKING"->"점검";case "DISABLED"->"중지";default->"점검"; };
    }
    public static List<InspectionRow> checkout(List<Component> definitions,Object input) {
        if(definitions.isEmpty()||definitions.size()>999) throw conflict("출고 구성품 기준을 확인할 수 없습니다.");
        Map<String,Map<String,Object>> rows=rows(input,definitions);
        if(rows.size()!=definitions.size()) throw bad("본체를 포함한 모든 구성품의 수량과 상태를 확인해주세요.");
        List<InspectionRow> result=new ArrayList<>();
        for(Component definition:definitions) {
            Map<String,Object> row=rows.get(definition.id()); checkConfirmed(row);
            int quantity=Math.toIntExact(integer(row.get("quantity"),"전달 수량",0,definition.requiredQuantity()));
            String condition=text(row.get("condition"),10,"구성품 상태");
            if(!"정상".equals(condition)||(definition.required()&&quantity!=definition.requiredQuantity())) throw bad("필수 구성품의 정해진 수량과 정상 상태를 확인해야 출고할 수 있습니다.");
            Component delivered=new Component(definition.id(),definition.name(),definition.requiredQuantity(),quantity,definition.required(),definition.body());
            result.add(new InspectionRow(delivered,quantity,0,false,"NORMAL",text(row.get("note"),500,"구성품 메모")));
        }
        return List.copyOf(result);
    }
    /** Adds only this round's delta to a grouped prior total; never re-adds history. */
    public static InspectionResult returned(List<Component> definitions,Map<String,Integer> prior,Set<String> previouslyDamaged,Object input,boolean extra,String reason,boolean forceHold) {
        if(definitions.isEmpty()) throw conflict("보존된 출고 기준이 없습니다. 기준 없이 반환 완료로 처리할 수 없습니다.");
        Map<String,Map<String,Object>> submitted=rows(input,definitions);
        if(!extra&&submitted.size()!=definitions.size()) throw bad("출고 당시 모든 구성품의 실제 반환 수량과 상태를 확인해주세요.");
        List<InspectionRow> result=new ArrayList<>();
        boolean missing=false,damaged=!previouslyDamaged.isEmpty(); int added=0;
        for(Component definition:definitions) {
            int already=prior.getOrDefault(definition.id(),0);
            if(already<0||already>definition.deliveredQuantity()) throw conflict("저장된 누적 반환 수량을 확인해야 합니다. 관리자에게 문의해주세요.");
            Map<String,Object> row=submitted.get(definition.id());
            if(row==null) {
                if(!extra||already<definition.deliveredQuantity()) throw bad(definition.name()+": 이번 반환 수량을 확인해주세요.");
                result.add(new InspectionRow(definition,0,already,previouslyDamaged.contains(definition.id()),"NORMAL","")); continue;
            }
            checkConfirmed(row);
            int quantity=Math.toIntExact(integer(row.get("quantity"),"이번 반환 수량",0,99_999));
            if(quantity>definition.deliveredQuantity()-already) throw bad(definition.name()+": 누적 반환 수량은 출고 수량을 초과할 수 없습니다.");
            String condition=text(row.get("condition"),10,"구성품 상태"),note=text(row.get("note"),500,"구성품 메모");
            if(!Set.of("정상","손상").contains(condition)) throw bad("모든 구성품의 정상·손상 상태를 선택해주세요.");
            if("손상".equals(condition)&&note.isBlank()) throw bad("손상 구성품의 확인 내용을 입력해주세요.");
            boolean rowDamaged=previouslyDamaged.contains(definition.id())||(quantity>0&&"손상".equals(condition));
            int cumulative=already+quantity;
            missing|=definition.required()&&cumulative<definition.deliveredQuantity(); damaged|=rowDamaged; added+=quantity;
            String dbCondition=quantity>0&&"손상".equals(condition)?"DAMAGED":quantity==0&&cumulative<definition.deliveredQuantity()?"MISSING":"NORMAL";
            result.add(new InspectionRow(definition,quantity,cumulative,rowDamaged,dbCondition,note));
        }
        if(added==0) throw bad("이번에 실제 반환한 구성품 수량을 입력해주세요.");
        if(missing&&reason.isBlank()) throw bad("누락 구성품과 반납 보류 사유를 입력해주세요.");
        if(forceHold&&!missing) throw bad("필수 구성품이 모두 반환되었습니다. 반납 완료로 확인해주세요.");
        return new InspectionResult(List.copyOf(result),missing,damaged);
    }
    @SuppressWarnings("unchecked")
    private static Map<String,Map<String,Object>> rows(Object input,List<Component> definitions) {
        if(!(input instanceof List<?> list)||list.isEmpty()||list.size()>definitions.size()) throw bad("구성품 확인 내용을 다시 입력해주세요.");
        Set<String> allowed=new HashSet<>(); definitions.forEach(definition->allowed.add(definition.id()));
        Map<String,Map<String,Object>> rows=new HashMap<>();
        for(Object element:list) {
            if(!(element instanceof Map<?,?> raw)) throw bad("구성품 확인 형식을 확인해주세요.");
            Map<String,Object> row=(Map<String,Object>)raw; Object rawId=row.get("componentId");
            if(!(rawId instanceof String id)||!allowed.contains(id)||rows.putIfAbsent(id,row)!=null) throw bad("구성품이 중복되거나 출고 기준과 다릅니다. 최신 기준을 다시 확인해주세요.");
        }
        return rows;
    }
    private static void checkConfirmed(Map<String,Object> row) {
        if(row==null||!Boolean.TRUE.equals(row.get("confirmed"))) throw bad("본체를 포함한 실제 구성품의 수량·상태를 모두 확인해주세요.");
    }
    public static ResponseStatusException bad(String message) { return new ResponseStatusException(HttpStatus.BAD_REQUEST,message); }
    public static ResponseStatusException conflict(String message) { return new ResponseStatusException(HttpStatus.CONFLICT,message); }
    public static ResponseStatusException notFound() { return new ResponseStatusException(HttpStatus.NOT_FOUND,"신청 항목을 찾을 수 없습니다."); }
}
