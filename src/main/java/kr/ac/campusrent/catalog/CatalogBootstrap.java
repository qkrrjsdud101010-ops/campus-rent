package kr.ac.campusrent.catalog;

import java.util.*;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.core.io.ClassPathResource;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Component;
import org.springframework.transaction.support.TransactionTemplate;
import kr.ac.campusrent.auth.AuthController;
import tools.jackson.databind.json.JsonMapper;

@Component
public class CatalogBootstrap implements ApplicationRunner {
    private final JdbcTemplate jdbc; private final PasswordEncoder encoder; private final TransactionTemplate tx;
    @Value("${campus.bootstrap.enabled:false}") boolean bootstrap;
    @Value("${campus.seed-demo-catalog:false}") boolean seed;
    @Value("${campus.bootstrap.admin.email:}") String adminEmail;
    @Value("${campus.bootstrap.admin.password:}") String adminPassword;
    public CatalogBootstrap(JdbcTemplate jdbc,PasswordEncoder encoder,TransactionTemplate tx){this.jdbc=jdbc;this.encoder=encoder;this.tx=tx;}
    @Override public void run(ApplicationArguments args) {
        if(!bootstrap&&!seed)return;
        try {tx.executeWithoutResult(status->{
            if(bootstrap) {
                String email=AuthController.email(adminEmail);AuthController.validatePassword(adminPassword);
                var existing=jdbc.queryForList("SELECT USER_ID,ROLE_CODE FROM APP_USER WHERE LOWER(EMAIL)=?",email);
                if(existing.isEmpty())jdbc.update("INSERT INTO APP_USER(USER_ID,EMAIL,PASSWORD,USER_NAME,ROLE_CODE) VALUES(?,?,?,?,'ADMIN')",next("SQ_APP_USER"),email,encoder.encode(adminPassword),"로컬 관리자");
                else if(!"ADMIN".equals(existing.getFirst().get("ROLE_CODE")))throw new IllegalStateException("Bootstrap account conflict.");
            }
            if(seed) seedCatalog();
        });} catch(Exception error){throw new IllegalStateException("로컬 초기 데이터 준비에 실패했습니다. 설정과 기존 데이터 상태를 확인하세요.");}
    }
    @SuppressWarnings("unchecked") private void seedCatalog(){
        Map<String,Object> data;
        try(var input=new ClassPathResource("demo/catalog.json").getInputStream()){data=JsonMapper.builder().build().readValue(input,Map.class);}catch(Exception error){throw new IllegalStateException("Catalog fixture could not be loaded.");}
        for(String name:(List<String>)data.get("purposes"))if(count("SELECT COUNT(*) FROM USE_PURPOSE WHERE PURPOSE_NAME=?",name)==0)
            jdbc.update("INSERT INTO USE_PURPOSE(PURPOSE_ID,PURPOSE_CODE,PURPOSE_NAME,ENABLED_YN) VALUES(?,?,?,'Y')",next("SQ_USE_PURPOSE"),"DEMO-"+UUID.randomUUID().toString().substring(0,12),name);
        var ids=new HashMap<String,Long>();
        List<Map<String,Object>> resources=(List<Map<String,Object>>)data.get("resources");
        for(var r:resources){String code=CatalogService.str(r.get("code"));boolean equipment="장비".equals(r.get("kind"));
            String table=equipment?"EQUIPMENT":"FACILITY",key=equipment?"EQUIPMENT_ID":"FACILITY_ID",codeKey=equipment?"ASSET_CODE":"FACILITY_CODE";
            var existing=jdbc.queryForList("SELECT "+key+" FROM "+table+" WHERE "+codeKey+"=?",code);
            if(!existing.isEmpty()){ids.put(CatalogService.str(r.get("id")),CatalogService.num(existing.getFirst().get(key)));continue;}
            long id;
            if(equipment){
                String type=CatalogService.str(r.get("category"));Long typeId;
                var types=jdbc.queryForList("SELECT TYPE_ID FROM EQUIPMENT_TYPE WHERE TYPE_NAME=?",type);
                if(types.isEmpty()){typeId=next("SQ_EQUIPMENT_TYPE");jdbc.update("INSERT INTO EQUIPMENT_TYPE(TYPE_ID,TYPE_NAME,CATEGORY_LABEL,ENABLED_YN) VALUES(?,?,?,'Y')",typeId,type,type);}else typeId=CatalogService.num(types.getFirst().get("TYPE_ID"));
                String model=CatalogService.str(r.get("model"));Long modelId;
                var models=jdbc.queryForList("SELECT MODEL_ID FROM EQUIPMENT_MODEL WHERE MODEL_CODE=?",model);
                if(models.isEmpty()){modelId=next("SQ_EQUIPMENT_MODEL");jdbc.update("INSERT INTO EQUIPMENT_MODEL(MODEL_ID,TYPE_ID,MODEL_CODE,MODEL_NAME,IS_DEMO_YN) VALUES(?,?,?,?,'Y')",modelId,typeId,model,model);
                    int ordinal=0;for(String value:(List<String>)r.get("specs")){String label="주요 사양 "+(++ordinal);Long specId;var entries=jdbc.queryForList("SELECT SPEC_ITEM_ID FROM SPEC_ITEM WHERE TYPE_ID=? AND SPEC_NAME=?",typeId,label);
                        if(entries.isEmpty()){specId=next("SQ_SPEC_ITEM");jdbc.update("INSERT INTO SPEC_ITEM(SPEC_ITEM_ID,TYPE_ID,SPEC_NAME,DISPLAY_ORDER) VALUES(?,?,?,?)",specId,typeId,label,ordinal);}else specId=CatalogService.num(entries.getFirst().get("SPEC_ITEM_ID"));
                        jdbc.update("INSERT INTO MODEL_SPEC(MODEL_ID,SPEC_ITEM_ID,SPEC_VALUE,VERIFY_STATUS) VALUES(?,?,?,'UNVERIFIED')",modelId,specId,value);
                    }
                }else modelId=CatalogService.num(models.getFirst().get("MODEL_ID"));
                id=next("SQ_EQUIPMENT");jdbc.update("INSERT INTO EQUIPMENT(EQUIPMENT_ID,MODEL_ID,ASSET_CODE,EQUIPMENT_NAME,STORAGE_LOCATION,LEND_ALLOWED_YN,OPERATING_STATUS,IS_DEMO_YN) VALUES(?,?,?,?,?,'Y',?,'Y')",id,modelId,code,r.get("name"),r.get("location"),"점검".equals(r.get("status"))?"CHECKING":"NORMAL");
                int ordinal=0;for(var c:(List<Map<String,Object>>)r.get("components"))jdbc.update("INSERT INTO EQUIPMENT_COMPONENT(COMPONENT_ID,EQUIPMENT_ID,COMPONENT_NAME,REQUIRED_QTY,BODY_YN,REQUIRED_YN,DISPLAY_ORDER) VALUES(?,?,?,?,?,?,?)",next("SQ_EQUIPMENT_COMPONENT"),id,c.get("name"),c.get("requiredQuantity"),Boolean.TRUE.equals(c.get("body"))?"Y":"N",Boolean.TRUE.equals(c.get("required"))?"Y":"N",++ordinal);
            }else {
                id=next("SQ_FACILITY");jdbc.update("INSERT INTO FACILITY(FACILITY_ID,FACILITY_CODE,FACILITY_NAME,FACILITY_TYPE,LOCATION_TEXT,CAPACITY,FIXED_EQUIPMENT_INFO,USE_ALLOWED_YN,OPERATING_STATUS,IS_DEMO_YN) VALUES(?,?,?,?,?,?,?,'Y','NORMAL','Y')",id,code,r.get("name"),r.get("category"),r.get("location"),r.get("capacity"),String.join(" · ",(List<String>)r.get("contents")));
                for(int day=1;day<=7;day++)jdbc.update("INSERT INTO FACILITY_HOURS(FACILITY_ID,WEEKDAY_NO,OPEN_TIME,CLOSE_TIME) VALUES(?,?,?,?)",id,day,((List<String>)r.get("operatingHours")).get(0),((List<String>)r.get("operatingHours")).get(1));
                for(String use:(List<String>)r.get("allowedUses"))jdbc.update("INSERT INTO FACILITY_PURPOSE(FACILITY_ID,PURPOSE_ID) VALUES(?,?)",id,jdbc.queryForObject("SELECT PURPOSE_ID FROM USE_PURPOSE WHERE PURPOSE_NAME=?",Long.class,use));
            }
            ids.put(CatalogService.str(r.get("id")),id);
        }
        var admins=jdbc.queryForList("SELECT USER_ID FROM APP_USER WHERE LOWER(EMAIL)=? AND ROLE_CODE='ADMIN'",adminEmail.toLowerCase(Locale.ROOT));
        if(admins.isEmpty())throw new IllegalStateException("Explicit local admin bootstrap is required for alternative metadata.");
        long actor=CatalogService.num(admins.getFirst().get("USER_ID"));
        for(var r:resources)if("장비".equals(r.get("kind")))for(String target:(List<String>)r.get("alternatives")){
            long from=ids.get(CatalogService.str(r.get("id"))),to=ids.get(target);
            if(count("SELECT COUNT(*) FROM EQUIPMENT_ALTERNATIVE WHERE SOURCE_EQUIPMENT_ID=? AND TARGET_EQUIPMENT_ID=?",from,to)==0)
                jdbc.update("INSERT INTO EQUIPMENT_ALTERNATIVE(SOURCE_EQUIPMENT_ID,TARGET_EQUIPMENT_ID,REASON_TEXT,DIFFERENCE_TEXT,CONFIGURED_BY) VALUES(?,?,?,?,?)",from,to,"시연용 동일 용도 대체 지정","모델·사양·구성품 차이를 확인하세요.",actor);
        }
    }
    private long next(String sequence){return jdbc.queryForObject("SELECT "+sequence+".NEXTVAL FROM DUAL",Long.class);}
    private long count(String sql,Object...args){return jdbc.queryForObject(sql,Long.class,args);}
}
