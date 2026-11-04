package kr.ac.campusrent.catalog;

import java.sql.Timestamp;
import java.time.*;
import java.util.*;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.web.server.ResponseStatusException;

@Service
@org.springframework.web.context.annotation.RequestScope
public class CatalogService {
    private final JdbcTemplate jdbc;
    private List<Map<String,Object>> cached;
    public CatalogService(JdbcTemplate jdbc) { this.jdbc = jdbc; }
    public List<Map<String,Object>> resources() {
        if(cached!=null)return cached;
        List<Map<String,Object>> result = new ArrayList<>();
        var specs = jdbc.queryForList("SELECT M.MODEL_ID,S.SPEC_NAME,M.SPEC_VALUE,M.VALUE_UNIT FROM MODEL_SPEC M JOIN SPEC_ITEM S ON S.SPEC_ITEM_ID=M.SPEC_ITEM_ID ORDER BY S.DISPLAY_ORDER,S.SPEC_ITEM_ID");
        var components = jdbc.queryForList("SELECT * FROM EQUIPMENT_COMPONENT ORDER BY EQUIPMENT_ID,DISPLAY_ORDER,COMPONENT_ID");
        var alternatives = jdbc.queryForList("SELECT A.SOURCE_EQUIPMENT_ID,E.EQUIPMENT_ID,E.ASSET_CODE FROM EQUIPMENT_ALTERNATIVE A JOIN EQUIPMENT E ON E.EQUIPMENT_ID=A.TARGET_EQUIPMENT_ID WHERE A.ENABLED_YN='Y'");
        for(var row:jdbc.queryForList("SELECT E.*,M.MODEL_NAME,T.TYPE_NAME,T.ENABLED_YN FROM EQUIPMENT E JOIN EQUIPMENT_MODEL M ON M.MODEL_ID=E.MODEL_ID JOIN EQUIPMENT_TYPE T ON T.TYPE_ID=M.TYPE_ID ORDER BY E.EQUIPMENT_ID")) {
            long id=num(row.get("EQUIPMENT_ID"));
            var item=base("E",id,str(row.get("ASSET_CODE")),str(row.get("EQUIPMENT_NAME")),str(row.get("TYPE_NAME")),row);
            item.put("model",str(row.get("MODEL_NAME"))); item.put("location",str(row.get("STORAGE_LOCATION")));
            item.put("rentable",yes(row.get("LEND_ALLOWED_YN"))&&yes(row.get("ENABLED_YN")));
            item.put("specs",specs.stream().filter(s->num(s.get("MODEL_ID"))==num(row.get("MODEL_ID"))).map(s->str(s.get("SPEC_NAME"))+" "+str(s.get("SPEC_VALUE"))+str(s.get("VALUE_UNIT"))).toList());
            List<Map<String,Object>> defs=new ArrayList<>();
            for(var c:components) if(num(c.get("EQUIPMENT_ID"))==id) defs.add(Map.of("componentId",String.valueOf(defs.size()+1),"name",str(c.get("COMPONENT_NAME")),"requiredQuantity",num(c.get("REQUIRED_QTY")),"required",yes(c.get("REQUIRED_YN")),"body",yes(c.get("BODY_YN"))));
            item.put("components",defs); item.put("contents",defs.stream().map(c->str(c.get("name"))+" "+c.get("requiredQuantity")+"개").toList());
            item.put("alternatives",alternatives.stream().filter(a->num(a.get("SOURCE_EQUIPMENT_ID"))==id).map(a->publicId("E",num(a.get("EQUIPMENT_ID")),str(a.get("ASSET_CODE")))).toList());
            item.put("icon",switch(str(row.get("TYPE_NAME"))) {case "카메라"->"ff97a.svg";case "마이크"->"054e2.svg";default->"1eae3.svg";});
            result.add(item);
        }
        var hours=jdbc.queryForList("SELECT * FROM FACILITY_HOURS ORDER BY FACILITY_ID,WEEKDAY_NO");
        var uses=jdbc.queryForList("SELECT F.FACILITY_ID,P.PURPOSE_NAME FROM FACILITY_PURPOSE F JOIN USE_PURPOSE P ON P.PURPOSE_ID=F.PURPOSE_ID WHERE P.ENABLED_YN='Y' ORDER BY P.PURPOSE_ID");
        for(var row:jdbc.queryForList("SELECT * FROM FACILITY ORDER BY FACILITY_ID")) {
            long id=num(row.get("FACILITY_ID"));
            var item=base("F",id,str(row.get("FACILITY_CODE")),str(row.get("FACILITY_NAME")),str(row.get("FACILITY_TYPE")),row);
            item.put("model","시설"); item.put("location",str(row.get("LOCATION_TEXT"))); item.put("capacity",num(row.get("CAPACITY")));
            item.put("rentable",yes(row.get("USE_ALLOWED_YN"))); item.put("specs",List.of("수용 "+num(row.get("CAPACITY"))+"명","공간 전체 예약"));
            String contents=str(row.get("FIXED_EQUIPMENT_INFO")); item.put("contents",contents.isEmpty()?List.of():Arrays.asList(contents.split(" · ")));
            item.put("allowedUses",uses.stream().filter(p->num(p.get("FACILITY_ID"))==id).map(p->str(p.get("PURPOSE_NAME"))).toList());
            Map<String,Object> days=new LinkedHashMap<>();
            for(var h:hours) if(num(h.get("FACILITY_ID"))==id) days.put(String.valueOf(num(h.get("WEEKDAY_NO"))),List.of(str(h.get("OPEN_TIME")),str(h.get("CLOSE_TIME"))));
            item.put("hoursByWeekday",days); item.put("operatingHours",days.values().stream().findFirst().orElse(List.of()));
            item.put("components",List.of()); item.put("alternatives",List.of()); item.put("icon","b46a5.svg"); result.add(item);
        }
        cached=result;
        return result;
    }
    private Map<String,Object> base(String kind,long id,String code,String name,String category,Map<String,Object> row) {
        Map<String,Object> item=new LinkedHashMap<>(); item.put("id",publicId(kind,id,code)); item.put("dbId",id); item.put("code",code);
        item.put("kind",kind.equals("E")?"장비":"시설"); item.put("name",name); item.put("category",category); item.put("isDemo",yes(row.get("IS_DEMO_YN")));
        String state=str(row.get("OPERATING_STATUS")); item.put("status",state.equals("NORMAL")?"정상":state.equals("CHECKING")?"점검":"중지"); item.put("version",num(row.get("ROW_VERSION"))); return item;
    }
    private String publicId(String kind,long id,String code) {
        if(kind.equals("E")&&code.matches("DEMO-(CAM|PROJ|MIC)\\d+")) return code.substring(5).toLowerCase(Locale.ROOT);
        if(kind.equals("F")&&code.matches("DEMO-(ROOM|STUDY|STUDIO)\\d+")) return code.substring(5).toLowerCase(Locale.ROOT);
        return (kind.equals("E")?"equipment:":"facility:")+id;
    }
    public Map<String,Object> resource(String id) {return resources().stream().filter(r->r.get("id").equals(id)).findFirst().orElseThrow(()->new ResponseStatusException(HttpStatus.NOT_FOUND,"자원을 찾을 수 없습니다."));}
    public Map<String,Object> resourceByDb(String kind,long id) {return resources().stream().filter(r->num(r.get("dbId"))==id&&r.get("kind").equals(kind.equals("E")?"장비":"시설")).findFirst().orElseThrow(()->new ResponseStatusException(HttpStatus.NOT_FOUND,"자원을 찾을 수 없습니다."));}
    public void lockResource(Map<String,Object> resource) {
        boolean equipment=resource.get("kind").equals("장비");
        jdbc.queryForObject("SELECT ROW_VERSION FROM "+(equipment?"EQUIPMENT WHERE EQUIPMENT_ID":"FACILITY WHERE FACILITY_ID")+"=? FOR UPDATE",Long.class,num(resource.get("dbId")));
        cached=null;
    }
    public void requireAvailable(String id,Map<String,Object> condition,Long excludedItem) {
        if(condition==null) bad("이용 조건을 입력해주세요.");
        LocalDateTime start=date(condition.get("start")),end=date(condition.get("end"));
        if(!end.isAfter(start)||start.isBefore(LocalDateTime.now().minusMinutes(1))) bad("미래의 시작 시각과 올바른 종료 시각을 지정해주세요.");
        var resource=resource(id); long dbId=num(resource.get("dbId")); boolean equipment=resource.get("kind").equals("장비");
        if(!Boolean.TRUE.equals(resource.get("rentable"))||!"정상".equals(resource.get("status"))) conflict("현재 이용이 제한된 자원입니다.");
        String column=equipment?"EQUIPMENT_ID":"FACILITY_ID";
        Long busy=jdbc.queryForObject("SELECT COUNT(*) FROM REQUEST_ITEM WHERE "+column+"=? AND STATUS_CODE NOT IN ('PENDING','REJECTED','CANCELLED') AND USE_START_AT<? AND USE_END_AT>? AND (? IS NULL OR REQUEST_ITEM_ID<>?)",Long.class,dbId,Timestamp.valueOf(end),Timestamp.valueOf(start),excludedItem,excludedItem);
        if(busy!=null&&busy>0) conflict("승인된 신청 기간과 겹칩니다.");
        if(equipment) {
            if(Duration.between(start,end).compareTo(Duration.ofDays(30))>0) bad("장비는 30일 이내로 신청해주세요.");
            if(jdbc.queryForObject("SELECT COUNT(*) FROM REQUEST_ITEM WHERE EQUIPMENT_ID=? AND STATUS_CODE='RETURN_HELD'",Long.class,dbId)>0) conflict("반환 확인이 완료되지 않은 장비입니다.");
        } else {
            if(!start.toLocalDate().equals(end.toLocalDate())) bad("시설은 같은 날짜의 시간을 지정해주세요.");
            long people=num(condition.get("people")); if(people<1||people>num(resource.get("capacity"))) bad("시설 수용 인원에 맞게 입력해주세요.");
            String use=str(condition.getOrDefault("use",condition.get("purpose")));
            if(jdbc.queryForObject("SELECT COUNT(*) FROM FACILITY_PURPOSE F JOIN USE_PURPOSE P ON P.PURPOSE_ID=F.PURPOSE_ID WHERE F.FACILITY_ID=? AND P.PURPOSE_NAME=? AND P.ENABLED_YN='Y'",Long.class,dbId,use)==0) bad("시설의 허용 목적을 선택해주세요.");
            var times=jdbc.queryForList("SELECT OPEN_TIME,CLOSE_TIME FROM FACILITY_HOURS WHERE FACILITY_ID=? AND WEEKDAY_NO=?",dbId,start.getDayOfWeek().getValue());
            if(times.isEmpty()) conflict("운영 시간이 설정되지 않았습니다.");
            LocalTime open=LocalTime.parse(str(times.getFirst().get("OPEN_TIME"))),close=LocalTime.parse(str(times.getFirst().get("CLOSE_TIME")));
            if(!close.isAfter(open)||start.toLocalTime().isBefore(open)||end.toLocalTime().isAfter(close)) conflict("시설 운영 시간 안에서 선택해주세요.");
            if(jdbc.queryForObject("SELECT COUNT(*) FROM FACILITY_BLOCK WHERE FACILITY_ID=? AND BLOCK_START_AT<? AND BLOCK_END_AT>?",Long.class,dbId,Timestamp.valueOf(end),Timestamp.valueOf(start))>0) conflict("시설 운영 제한 시간과 겹칩니다.");
        }
    }
    public List<Map<String,Object>> reservations() {
        var all=resources(); List<Map<String,Object>> result=new ArrayList<>();
        for(var row:jdbc.queryForList("SELECT ITEM_KIND,EQUIPMENT_ID,FACILITY_ID,USE_START_AT,USE_END_AT FROM REQUEST_ITEM WHERE STATUS_CODE NOT IN ('PENDING','REJECTED','CANCELLED') AND USE_END_AT>LOCALTIMESTAMP")) {
            String kind=str(row.get("ITEM_KIND")); long id=num(row.get(kind.equals("E")?"EQUIPMENT_ID":"FACILITY_ID"));
            all.stream().filter(r->num(r.get("dbId"))==id&&r.get("kind").equals(kind.equals("E")?"장비":"시설")).findFirst().ifPresent(r->result.add(interval(r,row.get("USE_START_AT"),row.get("USE_END_AT"),"승인된 신청과 겹칩니다.")));
        }
        for(var row:jdbc.queryForList("SELECT FACILITY_ID,BLOCK_START_AT,BLOCK_END_AT FROM FACILITY_BLOCK WHERE BLOCK_END_AT>LOCALTIMESTAMP")) all.stream().filter(r->r.get("kind").equals("시설")&&num(r.get("dbId"))==num(row.get("FACILITY_ID"))).findFirst().ifPresent(r->result.add(interval(r,row.get("BLOCK_START_AT"),row.get("BLOCK_END_AT"),"시설 운영 제한 시간입니다.")));
        return result;
    }
    private Map<String,Object> interval(Map<String,Object> r,Object start,Object end,String reason) {return Map.of("resourceId",r.get("id"),"start",time(start),"end",time(end),"approved",true,"reason",reason);}
    public Map<String,String> restrictions() {Map<String,String> result=new LinkedHashMap<>();for(var r:resources())if(!r.get("status").equals("정상"))result.put(str(r.get("id")),"현재 점검 또는 운영 제한 중입니다.");return result;}
    public List<String> purposes() {return jdbc.queryForList("SELECT PURPOSE_NAME FROM USE_PURPOSE WHERE ENABLED_YN='Y' ORDER BY PURPOSE_ID",String.class);}
    public static long num(Object value) {if(value==null)return 0;if(value instanceof Number n)return n.longValue();try{return Long.parseLong(str(value));}catch(RuntimeException error){bad("숫자 입력을 확인해주세요.");return 0;}}
    public static String str(Object value) {return value==null?"":String.valueOf(value);}
    public static String time(Object value) {return value instanceof Timestamp t?t.toLocalDateTime().toString():str(value);}
    private static boolean yes(Object value) {return "Y".equals(value);}
    private static LocalDateTime date(Object value) {try{return LocalDateTime.parse(str(value));}catch(RuntimeException error){bad("날짜·시각 형식을 확인해주세요.");return null;}}
    private static void bad(String message) {throw new ResponseStatusException(HttpStatus.BAD_REQUEST,message);}
    private static void conflict(String message) {throw new ResponseStatusException(HttpStatus.CONFLICT,message);}
}
