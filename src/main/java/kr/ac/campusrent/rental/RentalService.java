package kr.ac.campusrent.rental;

import java.sql.Timestamp;
import java.time.Clock;
import java.util.*;
import kr.ac.campusrent.auth.*;
import kr.ac.campusrent.catalog.CatalogService;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import static kr.ac.campusrent.catalog.CatalogService.*;
import static kr.ac.campusrent.rental.RentalPolicy.*;

@Service
public class RentalService {
    private final JdbcTemplate jdbc; private final CatalogService catalog;
    public RentalService(JdbcTemplate jdbc,CatalogService catalog){this.jdbc=jdbc;this.catalog=catalog;}
    public Map<String,Object> list(CurrentUser user){
        AuthSupport.require(user); List<Map<String,Object>> records=new ArrayList<>();
        String where="admin".equals(user.role())?"":" WHERE R.APPLICANT_ID=?";
        Object[] args="admin".equals(user.role())?new Object[]{}:new Object[]{Long.parseLong(user.id())};
        for(var head:jdbc.queryForList("SELECT R.*,U.USER_NAME FROM RENT_REQUEST R JOIN APP_USER U ON U.USER_ID=R.APPLICANT_ID"+where+" ORDER BY R.REQUESTED_AT DESC,R.REQUEST_ID DESC",args)){
            Map<String,Object> record=new LinkedHashMap<>();record.put("number",str(head.get("REQUEST_NO")));record.put("userId",str(head.get("APPLICANT_ID")));record.put("userName",str(head.get("USER_NAME")));record.put("createdAt",time(head.get("REQUESTED_AT")));
            List<Map<String,Object>> items=new ArrayList<>();for(var row:jdbc.queryForList("SELECT * FROM REQUEST_ITEM WHERE REQUEST_ID=? ORDER BY ITEM_NO",num(head.get("REQUEST_ID"))))items.add(view(row));record.put("items",items);records.add(record);
        }
        Map<String,Object> equipmentStates=new LinkedHashMap<>();for(var r:catalog.resources())if("장비".equals(r.get("kind")))equipmentStates.put(str(r.get("id")),Map.of("status",r.get("status"),"version",r.get("version")));
        return Map.of("records",records,"equipmentStates",equipmentStates);
    }
    @SuppressWarnings("unchecked") private Map<String,Object> view(Map<String,Object> row){
        String kind=str(row.get("ITEM_KIND"));long itemId=num(row.get("REQUEST_ITEM_ID"));
        var resource=catalog.resourceByDb(kind,num(row.get(kind.equals("E")?"EQUIPMENT_ID":"FACILITY_ID")));
        Map<String,Object> item=new LinkedHashMap<>(resource);item.put("resourceId",resource.get("id"));item.put("id",String.valueOf(itemId));item.put("originalIndex",num(row.get("ITEM_NO")));item.put("version",num(row.get("ROW_VERSION")));
        item.put("status",statusLabel(kind,str(row.get("STATUS_CODE"))));
        String purpose=row.get("PURPOSE_ID")==null?"":jdbc.queryForObject("SELECT PURPOSE_NAME FROM USE_PURPOSE WHERE PURPOSE_ID=?",String.class,num(row.get("PURPOSE_ID")));
        item.put("condition",Map.of("start",time(row.get("USE_START_AT")),"end",time(row.get("USE_END_AT")),"people",row.get("PEOPLE_COUNT")==null?1:num(row.get("PEOPLE_COUNT")),"use",purpose,"purpose",purpose));
        List<Map<String,Object>> history=new ArrayList<>();String reason="";
        for(var log:jdbc.queryForList("SELECT * FROM REQUEST_STATUS_LOG WHERE REQUEST_ITEM_ID=? ORDER BY CHANGED_AT,STATUS_LOG_ID",itemId)){
            String next=str(log.get("TO_STATUS"));reason=str(log.get("REASON_TEXT"));
            history.add(Map.of("action",next,"at",time(log.get("CHANGED_AT")),"from",log.get("FROM_STATUS")==null?"":statusLabel(kind,str(log.get("FROM_STATUS"))),"to",statusLabel(kind,next),"actor","처리 담당자","reason",reason));
        }
        item.put("history",history);item.put("reason",reason);item.put("inspections",List.of());item.put("returnedComponents",Map.of());
        if(kind.equals("E")){
            var checkouts=jdbc.queryForList("SELECT * FROM EQUIPMENT_CHECKOUT WHERE REQUEST_ITEM_ID=?",itemId);
            if(!checkouts.isEmpty()){
                var checkout=checkouts.getFirst();long checkoutId=num(checkout.get("CHECKOUT_ID"));item.put("name",str(checkout.get("EQUIPMENT_NAME_SNAPSHOT")));item.put("code",str(checkout.get("ASSET_CODE_SNAPSHOT")));item.put("checkoutAt",time(checkout.get("ACTUAL_CHECKOUT_AT")));
                List<Map<String,Object>> definitions=new ArrayList<>();for(var c:jdbc.queryForList("SELECT * FROM CHECKOUT_COMPONENT WHERE CHECKOUT_ID=? ORDER BY COMPONENT_SEQ",checkoutId))definitions.add(Map.of("componentId",str(c.get("COMPONENT_SEQ")),"name",str(c.get("COMPONENT_NAME")),"requiredQuantity",num(c.get("REQUIRED_QTY")),"quantity",num(c.get("DELIVERED_QTY")),"required","Y".equals(c.get("REQUIRED_YN")),"body","Y".equals(c.get("BODY_YN")),"condition","NORMAL".equals(c.get("OUT_CONDITION"))?"정상":"손상"));item.put("checkoutComponents",definitions);
                Map<String,Integer> returned=new LinkedHashMap<>();List<Map<String,Object>> rounds=new ArrayList<>();
                for(var inspection:jdbc.queryForList("SELECT * FROM RETURN_INSPECTION WHERE CHECKOUT_ID=? ORDER BY INSPECTION_ROUND",checkoutId)){
                    long round=num(inspection.get("INSPECTION_ROUND"));List<Map<String,Object>> components=new ArrayList<>();
                    for(var c:jdbc.queryForList("SELECT * FROM RETURN_COMPONENT WHERE CHECKOUT_ID=? AND INSPECTION_ROUND=? ORDER BY COMPONENT_SEQ",checkoutId,round)){
                        String id=str(c.get("COMPONENT_SEQ"));int quantity=Math.toIntExact(num(c.get("RETURNED_QTY")));returned.merge(id,quantity,Integer::sum);
                        var d=definitions.stream().filter(def->id.equals(def.get("componentId"))).findFirst().orElseThrow();
                        components.add(Map.of("componentId",id,"name",d.get("name"),"quantity",quantity,"cumulativeQuantity",returned.get(id),"missingQuantity",num(d.get("quantity"))-returned.get(id),"condition","DAMAGED".equals(c.get("RETURN_CONDITION"))?"손상":"정상","note",str(c.get("NOTE_TEXT"))));
                    }
                    String hold=str(inspection.get("HOLD_REASON"));rounds.add(Map.of("round",round,"at",time(inspection.get("INSPECTED_AT")),"actor","관리자","reason",hold,"status","HOLD".equals(inspection.get("OUTCOME_CODE"))?"반납 보류":"반납 완료","components",components));
                    if("RETURN_HELD".equals(row.get("STATUS_CODE")))item.put("reason",hold);
                }
                item.put("inspections",rounds);item.put("returnedComponents",returned);
            }
        } else {
            var usages=jdbc.queryForList("SELECT STARTED_AT,ENDED_AT FROM FACILITY_USAGE WHERE REQUEST_ITEM_ID=?",itemId);
            if(!usages.isEmpty()){item.put("startedAt",time(usages.getFirst().get("STARTED_AT")));item.put("endedAt",time(usages.getFirst().get("ENDED_AT")));}
        }
        return item;
    }
    @Transactional
    @SuppressWarnings("unchecked") public Map<String,Object> submit(CurrentUser user,Map<String,Object> body){
        AuthSupport.requireRole(user,"student");Object input=body.get("items");if(!(input instanceof List<?> entries)||entries.isEmpty()||entries.size()>20)throw bad("1~20개 자원을 선택해주세요.");
        List<Map<String,Object>> selections=new ArrayList<>();Set<String> unique=new HashSet<>();
        for(Object raw:entries){if(!(raw instanceof Map<?,?>))throw bad("선택 목록 형식을 확인해주세요.");var entry=(Map<String,Object>)raw;String id=text(entry.get("resourceId"),80,"자원");if(!unique.add(id))throw bad("같은 자원을 중복 신청할 수 없습니다.");var r=catalog.resource(id);condition((Map<String,Object>)entry.get("condition"),"시설".equals(r.get("kind")),Clock.systemDefaultZone());selections.add(entry);}
        selections.stream().sorted(Comparator.comparing(e->str(e.get("resourceId")))).forEach(e->catalog.lockResource(catalog.resource(str(e.get("resourceId")))));
        for(var entry:selections)catalog.requireAvailable(str(entry.get("resourceId")),(Map<String,Object>)entry.get("condition"),null);
        long requestId=next("SQ_RENT_REQUEST");String number="CR-"+java.time.LocalDate.now().toString().replace("-","")+"-"+requestId;
        jdbc.update("INSERT INTO RENT_REQUEST(REQUEST_ID,REQUEST_NO,APPLICANT_ID) VALUES(?,?,?)",requestId,number,Long.parseLong(user.id()));
        int order=0;for(var entry:selections){var r=catalog.resource(str(entry.get("resourceId")));boolean equipment="장비".equals(r.get("kind"));var c=condition((Map<String,Object>)entry.get("condition"),!equipment,Clock.systemDefaultZone());Long purpose=equipment?null:jdbc.queryForObject("SELECT PURPOSE_ID FROM USE_PURPOSE WHERE PURPOSE_NAME=? AND ENABLED_YN='Y'",Long.class,c.purpose());long id=next("SQ_REQUEST_ITEM");
            jdbc.update("INSERT INTO REQUEST_ITEM(REQUEST_ITEM_ID,REQUEST_ID,ITEM_NO,ITEM_KIND,EQUIPMENT_ID,FACILITY_ID,USE_START_AT,USE_END_AT,PEOPLE_COUNT,PURPOSE_ID,ORIGIN_CODE,STATUS_CODE) VALUES(?,?,?,?,?,?,?,?,?,?,'DIRECT','PENDING')",id,requestId,++order,equipment?"E":"F",equipment?r.get("dbId"):null,equipment?null:r.get("dbId"),c.startTimestamp(),c.endTimestamp(),equipment?null:c.people(),purpose);log(id,null,"PENDING",user,"");}
        var record=((List<Map<String,Object>>)list(user).get("records")).stream().filter(r->number.equals(r.get("number"))).findFirst().orElseThrow();return Map.of("record",record);
    }
    @Transactional public Map<String,Object> change(CurrentUser user,String number,long id,String action,Map<String,Object> details){
        boolean student=Set.of("cancel","request-return").contains(action);AuthSupport.requireRole(user,student?"student":"admin");
        var identity=jdbc.queryForList("SELECT I.*,R.APPLICANT_ID FROM REQUEST_ITEM I JOIN RENT_REQUEST R ON R.REQUEST_ID=I.REQUEST_ID WHERE I.REQUEST_ITEM_ID=? AND R.REQUEST_NO=?",id,number);if(identity.isEmpty())throw notFound();var initial=identity.getFirst();
        if(student&&num(initial.get("APPLICANT_ID"))!=Long.parseLong(user.id()))throw notFound();
        String kind=str(initial.get("ITEM_KIND"));var resource=catalog.resourceByDb(kind,num(initial.get(kind.equals("E")?"EQUIPMENT_ID":"FACILITY_ID")));catalog.lockResource(resource);
        var row=jdbc.queryForMap("SELECT * FROM REQUEST_ITEM WHERE REQUEST_ITEM_ID=? FOR UPDATE",id);long version=expectedVersion(details.get("expectedVersion"));if(version!=num(row.get("ROW_VERSION")))throw conflict("다른 창에서 상태가 변경되었습니다. 최신 내역을 확인해주세요.");
        resource=catalog.resourceByDb(kind,num(row.get(kind.equals("E")?"EQUIPMENT_ID":"FACILITY_ID")));long resourceId=num(resource.get("dbId"));
        if(!student&&kind.equals("E")&&details.get("expectedEquipmentVersion")!=null&&expectedVersion(details.get("expectedEquipmentVersion"))!=num(resource.get("version")))throw conflict("장비 상태가 변경되었습니다. 최신 기준을 확인해주세요.");
        String from=str(row.get("STATUS_CODE")),to=from,reason=text(details.get("reason"),1000,"처리 사유");
        switch(action){
            case "cancel"->{requireState(from,"PENDING");to="CANCELLED";}
            case "request-return"->{requireKind(kind,"E");requireState(from,"CHECKED_OUT");to="RETURN_REQUESTED";}
            case "approve"->{requireState(from,"PENDING");Map<String,Object> condition=new HashMap<>();condition.put("start",time(row.get("USE_START_AT")));condition.put("end",time(row.get("USE_END_AT")));condition.put("people",row.get("PEOPLE_COUNT"));condition.put("use",row.get("PURPOSE_ID")==null?"":jdbc.queryForObject("SELECT PURPOSE_NAME FROM USE_PURPOSE WHERE PURPOSE_ID=?",String.class,num(row.get("PURPOSE_ID"))));catalog.requireAvailable(str(resource.get("id")),condition,id);to="APPROVED";}
            case "reject"->{requireState(from,"PENDING");if(reason.isBlank())throw bad("거절 사유를 입력해주세요.");to="REJECTED";}
            case "start"->{requireKind(kind,"F");requireState(from,"APPROVED");jdbc.update("INSERT INTO FACILITY_USAGE(USAGE_ID,REQUEST_ITEM_ID,ITEM_KIND,STARTED_AT,STARTED_BY) VALUES(?,?,'F',LOCALTIMESTAMP,?)",next("SQ_FACILITY_USAGE"),id,Long.parseLong(user.id()));to="IN_USE";}
            case "finish"->{requireKind(kind,"F");requireState(from,"IN_USE");jdbc.update("UPDATE FACILITY_USAGE SET ENDED_AT=LOCALTIMESTAMP,ENDED_BY=? WHERE REQUEST_ITEM_ID=? AND ENDED_AT IS NULL",Long.parseLong(user.id()),id);to="COMPLETED";}
            case "checkout"->{requireKind(kind,"E");requireState(from,"APPROVED");if(!"정상".equals(resource.get("status"))||!Boolean.TRUE.equals(resource.get("rentable"))||outstanding(resourceId,id))throw conflict("장비 상태와 이전 반환 확인을 먼저 완료해주세요.");
                var inspected=checkout(baseComponents(resource),details.get("components"));long checkoutId=next("SQ_EQUIPMENT_CHECKOUT");jdbc.update("INSERT INTO EQUIPMENT_CHECKOUT(CHECKOUT_ID,REQUEST_ITEM_ID,ITEM_KIND,ASSET_CODE_SNAPSHOT,EQUIPMENT_NAME_SNAPSHOT,SOURCE_CODE,ACTUAL_CHECKOUT_AT,REGISTERED_AT,REGISTERED_BY) VALUES(?,?,'E',?,?,'ACTUAL',LOCALTIMESTAMP,LOCALTIMESTAMP,?)",checkoutId,id,resource.get("code"),resource.get("name"),Long.parseLong(user.id()));
                for(var c:inspected)jdbc.update("INSERT INTO CHECKOUT_COMPONENT(CHECKOUT_ID,COMPONENT_SEQ,COMPONENT_NAME,REQUIRED_QTY,DELIVERED_QTY,BODY_YN,REQUIRED_YN,OUT_CONDITION,NOTE_TEXT) VALUES(?,?,?,?,?,?,?,'NORMAL',?)",checkoutId,Integer.parseInt(c.component().id()),c.component().name(),c.component().requiredQuantity(),c.quantity(),c.component().body()?"Y":"N",c.component().required()?"Y":"N",c.note());to="CHECKED_OUT";}
            case "return","hold","return-extra"->{requireKind(kind,"E");if(!Set.of("RETURN_REQUESTED","RETURN_HELD").contains(from))throw conflict("반납 신청 또는 보류 상태만 확인할 수 있습니다.");if(action.equals("return-extra"))requireState(from,"RETURN_HELD");
                long checkoutId=jdbc.queryForObject("SELECT CHECKOUT_ID FROM EQUIPMENT_CHECKOUT WHERE REQUEST_ITEM_ID=?",Long.class,id);var defs=snapshotComponents(checkoutId);Map<String,Integer> prior=new HashMap<>();Set<String> damaged=new HashSet<>();
                for(var c:jdbc.queryForList("SELECT COMPONENT_SEQ,SUM(RETURNED_QTY) AS TOTAL FROM RETURN_COMPONENT WHERE CHECKOUT_ID=? GROUP BY COMPONENT_SEQ",checkoutId))prior.put(str(c.get("COMPONENT_SEQ")),Math.toIntExact(num(c.get("TOTAL"))));
                for(String c:jdbc.queryForList("SELECT DISTINCT TO_CHAR(COMPONENT_SEQ) FROM RETURN_COMPONENT WHERE CHECKOUT_ID=? AND RETURN_CONDITION='DAMAGED' AND RETURNED_QTY>0",String.class,checkoutId))damaged.add(c);
                var checked=returned(defs,prior,damaged,details.get("components"),action.equals("return-extra"),reason,action.equals("hold"));
                long round=jdbc.queryForObject("SELECT NVL(MAX(INSPECTION_ROUND),0)+1 FROM RETURN_INSPECTION WHERE CHECKOUT_ID=?",Long.class,checkoutId);
                jdbc.update("INSERT INTO RETURN_INSPECTION(CHECKOUT_ID,INSPECTION_ROUND,INSPECTED_BY,OUTCOME_CODE,HOLD_REASON) VALUES(?,?,?,?,?)",checkoutId,round,Long.parseLong(user.id()),checked.missing()?"HOLD":"COMPLETE",checked.missing()?reason:null);
                for(var c:checked.rows())jdbc.update("INSERT INTO RETURN_COMPONENT(CHECKOUT_ID,INSPECTION_ROUND,COMPONENT_SEQ,RETURNED_QTY,RETURN_CONDITION,NOTE_TEXT) VALUES(?,?,?,?,?,?)",checkoutId,round,Integer.parseInt(c.component().id()),c.quantity(),c.condition(),c.note());
                to=checked.missing()?"RETURN_HELD":"RETURNED";if(checked.missing()||checked.damaged())setEquipment(resourceId,id,user,"CHECKING",reason.isBlank()?"반환 손상 상태 점검 필요":reason);}
            case "maintenance-required"->{requireKind(kind,"E");if(reason.isBlank()||!Boolean.TRUE.equals(details.get("confirmed")))throw bad("실제 점검 확인과 사유를 입력해주세요.");setEquipment(resourceId,id,user,"CHECKING",reason);}
            case "maintenance-done"->{requireKind(kind,"E");requireState(from,"RETURNED");if(!"점검".equals(resource.get("status"))||outstanding(resourceId,0)||!Boolean.TRUE.equals(resource.get("rentable")))throw conflict("반환 해결과 점검 중 상태를 확인해주세요.");if(reason.isBlank()||!Boolean.TRUE.equals(details.get("confirmed")))throw bad("점검 완료 확인과 메모를 입력해주세요.");setEquipment(resourceId,id,user,"NORMAL",reason);}
            default->throw bad("지원하지 않는 처리입니다.");
        }
        if(jdbc.update("UPDATE REQUEST_ITEM SET STATUS_CODE=?,ROW_VERSION=ROW_VERSION+1,UPDATED_AT=LOCALTIMESTAMP WHERE REQUEST_ITEM_ID=? AND ROW_VERSION=?",to,id,version)!=1)throw conflict("최신 신청 상태를 다시 확인해주세요.");log(id,from,to,user,reason);return Map.of("item",view(jdbc.queryForMap("SELECT * FROM REQUEST_ITEM WHERE REQUEST_ITEM_ID=?",id)));
    }
    @SuppressWarnings("unchecked") private List<Component> baseComponents(Map<String,Object> resource){return ((List<Map<String,Object>>)resource.get("components")).stream().map(c->new Component(str(c.get("componentId")),str(c.get("name")),Math.toIntExact(num(c.get("requiredQuantity"))),Math.toIntExact(num(c.get("requiredQuantity"))),Boolean.TRUE.equals(c.get("required")),Boolean.TRUE.equals(c.get("body")))).toList();}
    private List<Component> snapshotComponents(long checkoutId){return jdbc.queryForList("SELECT * FROM CHECKOUT_COMPONENT WHERE CHECKOUT_ID=? ORDER BY COMPONENT_SEQ",checkoutId).stream().map(c->new Component(str(c.get("COMPONENT_SEQ")),str(c.get("COMPONENT_NAME")),Math.toIntExact(num(c.get("REQUIRED_QTY"))),Math.toIntExact(num(c.get("DELIVERED_QTY"))),"Y".equals(c.get("REQUIRED_YN")),"Y".equals(c.get("BODY_YN")))).toList();}
    private boolean outstanding(long resourceId,long excluded){return jdbc.queryForObject("SELECT COUNT(*) FROM REQUEST_ITEM WHERE EQUIPMENT_ID=? AND REQUEST_ITEM_ID<>? AND STATUS_CODE IN ('CHECKED_OUT','RETURN_REQUESTED','RETURN_HELD')",Long.class,resourceId,excluded)>0;}
    private void setEquipment(long resourceId,long itemId,CurrentUser actor,String status,String reason){String from=jdbc.queryForObject("SELECT OPERATING_STATUS FROM EQUIPMENT WHERE EQUIPMENT_ID=?",String.class,resourceId);jdbc.update("UPDATE EQUIPMENT SET OPERATING_STATUS=?,ROW_VERSION=ROW_VERSION+1 WHERE EQUIPMENT_ID=?",status,resourceId);jdbc.update("INSERT INTO EQUIPMENT_CHECK_LOG(CHECK_LOG_ID,EQUIPMENT_ID,RELATED_ITEM_ID,ACTION_CODE,FROM_STATUS,TO_STATUS,REASON_TEXT,CHECKED_BY) VALUES(?,?,?,?,?,?,?,?)",next("SQ_EQUIPMENT_CHECK_LOG"),resourceId,itemId,status.equals("NORMAL")?"CHECK_COMPLETED":"CHECK_REQUIRED",from,status,reason,Long.parseLong(actor.id()));}
    private void log(long item,String from,String to,CurrentUser user,String reason){jdbc.update("INSERT INTO REQUEST_STATUS_LOG(STATUS_LOG_ID,REQUEST_ITEM_ID,FROM_STATUS,TO_STATUS,CHANGED_BY,REASON_TEXT) VALUES(?,?,?,?,?,?)",next("SQ_REQUEST_STATUS_LOG"),item,from,to,Long.parseLong(user.id()),reason);}
    private long next(String sequence){return jdbc.queryForObject("SELECT "+sequence+".NEXTVAL FROM DUAL",Long.class);}
    private void requireState(String actual,String expected){if(!actual.equals(expected))throw conflict("현재 상태에서는 이 작업을 수행할 수 없습니다.");}
    private void requireKind(String actual,String expected){if(!actual.equals(expected))throw bad("자원 종류에 맞지 않는 작업입니다.");}
}
