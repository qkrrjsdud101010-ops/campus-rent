package kr.ac.campusrent.analysis;

import java.nio.charset.StandardCharsets;
import java.time.*;
import java.util.*;
import java.util.concurrent.*;
import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;
import tools.jackson.databind.json.JsonMapper;

class ActivityAnalysisTest {
    static final JsonMapper JSON=JsonMapper.builder().build();
    static Map<String,Object> valid() {
        return new LinkedHashMap<>(Map.of("activity","면접 연습","people",4,"peopleStatus","explicit",
                "needs",Map.of("space",true,"video",true,"audio",false,"presentation",false),"needsClarification",false));
    }
    static byte[] envelope(String output) {
        return JSON.writeValueAsString(Map.of("candidates",List.of(Map.of("finishReason","STOP","content",Map.of("parts",List.of(Map.of("text",output))))))).getBytes(StandardCharsets.UTF_8);
    }
    static GeminiAnalysisAdapter adapter(AnalysisHttp.Transport transport) {
        return new GeminiAnalysisAdapter(new GeminiAnalysisAdapter.Settings(true,"synthetic-test-key","gemini-3.1-flash-lite",8000),transport);
    }
    @Test void acceptsOnlyBoundedActivityField() {
        assertEquals("면접 4명",AnalysisPolicy.activity(Map.of("activity"," 면접 4명 ")));
        for(var input:List.<Map<String,Object>>of(Map.of(),Map.of("activity",""),Map.of("activity","a".repeat(501)),Map.of("activity",3),Map.of("activity","면접","userId",1)))
            assertThrows(RuntimeException.class,()->AnalysisPolicy.activity(input));
    }
    @Test void outputCannotAssignSchoolPermissionsOrResourceIdentifiers() {
        var value=valid();value.put("facilityUse","면접");assertThrows(IllegalArgumentException.class,()->AnalysisPolicy.output(value));
        value.remove("facilityUse");value.put("resourceId","equipment:1");assertThrows(IllegalArgumentException.class,()->AnalysisPolicy.output(value));
    }
    @Test void enforcesIntegerPeopleBooleanNeedsAndAmbiguity() {
        var value=valid();
        for(Object count:List.of(0,1000,2.5,"4")){value.put("people",count);assertThrows(IllegalArgumentException.class,()->AnalysisPolicy.output(value));}
        value.put("people",null);value.put("peopleStatus","ambiguous");assertThrows(IllegalArgumentException.class,()->AnalysisPolicy.output(value));
        value.put("needsClarification",true);assertNull(AnalysisPolicy.output(value).get("people"));
        value.put("needs",Map.of("space","true","video",false,"audio",false,"presentation",false));
        assertThrows(IllegalArgumentException.class,()->AnalysisPolicy.output(value));
    }
    @Test void disabledAndMissingKeyNeverCallTransport() {
        AnalysisHttp.Transport transport=mock(AnalysisHttp.Transport.class);
        var disabled=new GeminiAnalysisAdapter(new GeminiAnalysisAdapter.Settings(false,"","",8000),transport);
        assertEquals("disabled",disabled.analyze("면접").reason());
        var missing=new GeminiAnalysisAdapter(new GeminiAnalysisAdapter.Settings(true,"","gemini-3.1-flash-lite",8000),transport);
        assertEquals("unconfigured",missing.analyze("면접").reason());verifyNoInteractions(transport);
    }
    @Test void validStructuredResponseIsValidatedAndKeyStaysInServerHeader() {
        var provider=adapter((request,timeout)->{
            assertEquals("generativelanguage.googleapis.com",request.uri().getHost());assertNull(request.uri().getQuery());
            assertEquals("synthetic-test-key",request.headers().firstValue("x-goog-api-key").orElseThrow());
            assertEquals(8000,timeout);return new AnalysisHttp.Reply(200,envelope(JSON.writeValueAsString(valid())));
        });
        assertEquals(4,provider.analyze("면접 4명").analysis().get("people"));
        assertFalse(new GeminiAnalysisAdapter.Settings(true,"synthetic-test-key","model",8000).toString().contains("synthetic-test-key"));
    }
    @Test void malformedDuplicateTrailingAndOversizedResponsesFallBack() {
        for(byte[] body:List.of("{}".getBytes(StandardCharsets.UTF_8),envelope("{}"),envelope(JSON.writeValueAsString(valid())+" {}"),
                envelope(JSON.writeValueAsString(valid()).replace("\"people\":4","\"people\":4,\"people\":5")),new byte[65537])){
            assertEquals("invalid-response",adapter((request,timeout)->new AnalysisHttp.Reply(200,body)).analyze("면접").reason());
        }
    }
    @Test void rateLimitsErrorsTimeoutAndInterruptedRequestsNeverExposeProviderBodies() {
        for(int status:List.of(401,429,500,503)){
            var out=adapter((request,timeout)->new AnalysisHttp.Reply(status,"private provider error".getBytes(StandardCharsets.UTF_8))).analyze("면접");
            assertNull(out.analysis());assertEquals(status==429?"rate-limited":"unavailable",out.reason());
        }
        assertEquals("unavailable",adapter((request,timeout)->{throw new TimeoutException("private");}).analyze("면접").reason());
    }
    @Test void refusesBlockedOrTruncatedProviderEnvelopes() {
        for(String reason:List.of("MAX_TOKENS","SAFETY")){
            byte[] body=JSON.writeValueAsString(Map.of("candidates",List.of(Map.of("finishReason",reason,"content",Map.of("parts",List.of(Map.of("text",JSON.writeValueAsString(valid())))))))).getBytes(StandardCharsets.UTF_8);
            assertEquals("invalid-response",adapter((request,timeout)->new AnalysisHttp.Reply(200,body)).analyze("면접").reason());
        }
    }
    @Test void serviceRevalidatesEveryProviderAndSanitizesFallbackReasons() {
        var provider=mock(ActivityAnalysisProvider.class);when(provider.unavailableReason()).thenReturn("");
        var service=new ActivityAnalysisService(provider,20,Clock.systemUTC());
        var invalid=valid();invalid.put("userId",1);
        when(provider.analyze(anyString())).thenReturn(new ActivityAnalysisProvider.Outcome("",invalid));
        assertEquals("invalid-response",service.analyze(Map.of("activity","면접")).get("reason"));
        when(provider.analyze(anyString())).thenReturn(new ActivityAnalysisProvider.Outcome("private-key",null));
        assertEquals("unavailable",service.analyze(Map.of("activity","면접")).get("reason"));
    }
    @Test void serviceEnforcesGlobalRateAndCapabilitiesNeverExposeCredentials() {
        var provider=mock(ActivityAnalysisProvider.class);when(provider.unavailableReason()).thenReturn("");when(provider.available()).thenReturn(true);
        when(provider.provider()).thenReturn("gemini");when(provider.externalProcessing()).thenReturn(true);
        when(provider.analyze(anyString())).thenReturn(new ActivityAnalysisProvider.Outcome("",valid()));
        var service=new ActivityAnalysisService(provider,1,Clock.fixed(Instant.parse("2026-11-18T00:00:00Z"),ZoneOffset.UTC));
        assertEquals("ai",service.analyze(Map.of("activity","면접")).get("source"));
        assertEquals("rate-limited",service.analyze(Map.of("activity","면접")).get("reason"));
        assertEquals(Set.of("available","provider","externalProcessing"),service.capabilities().keySet());verify(provider,times(1)).analyze("면접");
    }
    @Test void serviceRejectsThirdConcurrentCallAndReleasesBothSlots() throws Exception {
        var entered=new CountDownLatch(2);var release=new CountDownLatch(1);
        var provider=mock(ActivityAnalysisProvider.class);when(provider.unavailableReason()).thenReturn("");
        when(provider.analyze(anyString())).thenAnswer(call->{entered.countDown();assertTrue(release.await(5,TimeUnit.SECONDS));return new ActivityAnalysisProvider.Outcome("",valid());});
        var service=new ActivityAnalysisService(provider,20,Clock.systemUTC());
        try(var executor=Executors.newVirtualThreadPerTaskExecutor()){
            var first=executor.submit(()->service.analyze(Map.of("activity","면접")));
            var second=executor.submit(()->service.analyze(Map.of("activity","면접")));
            try{assertTrue(entered.await(5,TimeUnit.SECONDS));assertEquals("busy",service.analyze(Map.of("activity","면접")).get("reason"));}
            finally{release.countDown();}
            assertEquals("ai",first.get(5,TimeUnit.SECONDS).get("source"));assertEquals("ai",second.get(5,TimeUnit.SECONDS).get("source"));
        }
    }
}
