package kr.ac.campusrent.analysis;

import java.io.ByteArrayOutputStream;
import java.net.http.HttpRequest;
import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.Flow;
import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.runner.ApplicationContextRunner;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;
import static kr.ac.campusrent.analysis.AnalysisHttp.*;

class OpenAiAnalysisTest {
    static OpenAiAnalysisAdapter adapter(Transport transport) {
        return new OpenAiAnalysisAdapter(new OpenAiAnalysisAdapter.Settings(true,"synthetic-openai-key","gpt-5.4-mini",8000),transport);
    }
    static byte[] response(String text) {
        return JSON.writeValueAsBytes(Map.of("status","completed","output",List.of(message(text))));
    }
    static Map<String,Object> message(String text) {
        return Map.of("type","message","role","assistant","status","completed",
                "content",List.of(Map.of("type","output_text","text",text,"annotations",List.of())));
    }
    static String body(HttpRequest request) throws Exception {
        var complete=new CompletableFuture<String>();
        request.bodyPublisher().orElseThrow().subscribe(new Flow.Subscriber<ByteBuffer>() {
            final ByteArrayOutputStream data=new ByteArrayOutputStream();
            public void onSubscribe(Flow.Subscription next) { next.request(Long.MAX_VALUE); }
            public void onNext(ByteBuffer next) { byte[] bytes=new byte[next.remaining()];next.get(bytes);data.writeBytes(bytes); }
            public void onError(Throwable error) { complete.completeExceptionally(error); }
            public void onComplete() { complete.complete(data.toString(StandardCharsets.UTF_8)); }
        });
        return complete.get(2,TimeUnit.SECONDS);
    }
    @Test void requestUsesFixedEndpointPrivateHeaderStrictSchemaAndActivityOnly() {
        var provider=adapter((request,timeout)->{
            assertEquals("https://api.openai.com/v1/responses",request.uri().toString());
            assertEquals("Bearer synthetic-openai-key",request.headers().firstValue("Authorization").orElseThrow());
            String raw=body(request);var payload=JSON.readValue(raw,Map.class);
            assertFalse(raw.contains("synthetic-openai-key"));
            assertEquals(Set.of("model","instructions","input","store","max_output_tokens","reasoning","text"),payload.keySet());
            assertEquals("4명이 면접 연습을 녹화",payload.get("input"));assertEquals(false,payload.get("store"));
            assertEquals(768,payload.get("max_output_tokens"));assertEquals(Map.of("effort","none"),payload.get("reasoning"));
            Map<?,?> format=(Map<?,?>)((Map<?,?>)payload.get("text")).get("format");
            assertEquals("json_schema",format.get("type"));assertEquals(true,format.get("strict"));
            assertEquals(AnalysisPolicy.schema(),format.get("schema"));assertEquals(8000,timeout);
            return new Reply(200,response(JSON.writeValueAsString(ActivityAnalysisTest.valid())));
        });
        assertEquals(4,provider.analyze("4명이 면접 연습을 녹화").analysis().get("people"));
    }
    @Test void disabledMissingOrMalformedCredentialsNeverUseTransport() {
        Transport transport=mock(Transport.class);
        assertEquals("disabled",new OpenAiAnalysisAdapter(new OpenAiAnalysisAdapter.Settings(false,"","",8000),transport).analyze("면접").reason());
        for(String key:List.of("","bad\nkey","has space","한글")) {
            assertEquals("unconfigured",new OpenAiAnalysisAdapter(new OpenAiAnalysisAdapter.Settings(true,key,"gpt-5.4-mini",8000),transport).analyze("면접").reason());
        }
        assertEquals("unconfigured",new OpenAiAnalysisAdapter(new OpenAiAnalysisAdapter.Settings(true,"key","../../endpoint",8000),transport).unavailableReason());
        assertFalse(new OpenAiAnalysisAdapter.Settings(true,"synthetic-openai-key","model",8000).toString().contains("synthetic-openai-key"));
        verifyNoInteractions(transport);
    }
    @Test void refusesIncompleteRefusedToolAndMultipleMessageResponses() {
        String text=JSON.writeValueAsString(ActivityAnalysisTest.valid());
        List<Map<String,Object>> envelopes=List.of(
                Map.of("status","incomplete","output",List.of(message(text))),
                Map.of("status","completed","error",Map.of("message","private"),"output",List.of(message(text))),
                Map.of("status","completed","incomplete_details",Map.of("reason","max_output_tokens"),"output",List.of(message(text))),
                Map.of("status","completed","output",List.of(Map.of("type","message","status","completed","role","assistant","content",List.of(Map.of("type","refusal","refusal","private"))))),
                Map.of("status","completed","output",List.of(Map.of("type","function_call","arguments","{}"))),
                Map.of("status","completed","output",List.of(message(text),message(text))),
                Map.of("status","completed","output",List.of()));
        for(var envelope:envelopes) assertEquals("invalid-response",adapter((r,t)->new Reply(200,JSON.writeValueAsBytes(envelope))).analyze("면접").reason());
    }
    @Test void rejectsDuplicateTrailingOversizedAndUnauthorizedOutputFields() {
        String valid=JSON.writeValueAsString(ActivityAnalysisTest.valid());
        var permission=ActivityAnalysisTest.valid();permission.put("facilityUse","면접");
        for(byte[] bytes:List.of(response(valid+" {}"),response(valid.replace("\"people\":4","\"people\":4,\"people\":5")),
                response(JSON.writeValueAsString(permission)),new byte[65537],new byte[]{(byte)0xff},"{}".getBytes(StandardCharsets.UTF_8))) {
            assertEquals("invalid-response",adapter((r,t)->new Reply(200,bytes)).analyze("면접").reason());
        }
    }
    @Test void providerErrorsFallbackWithoutRetryOrPrivateErrorDisclosure() {
        for(int status:List.of(401,403,429,500,503)) {
            Transport transport=mock(Transport.class);
            try { when(transport.send(any(),anyInt())).thenReturn(new Reply(status,"private error".getBytes(StandardCharsets.UTF_8))); }
            catch(Exception error) { throw new AssertionError(error); }
            var result=adapter(transport).analyze("면접");assertNull(result.analysis());
            assertEquals(status==429?"rate-limited":"unavailable",result.reason());
            try { verify(transport,times(1)).send(any(),anyInt()); }catch(Exception error) { throw new AssertionError(error); }
        }
        assertEquals("unavailable",adapter((r,t)->{throw new TimeoutException("private");}).analyze("면접").reason());
    }
    @Test void defaultSpringProviderIsOpenAiAndGeminiMustBeExplicit() {
        var runner=new ApplicationContextRunner().withUserConfiguration(OpenAiAnalysisAdapter.class,GeminiAnalysisAdapter.class);
        runner.run(context->{
            assertNull(context.getStartupFailure());assertEquals(1,context.getBeansOfType(ActivityAnalysisProvider.class).size());
            assertEquals("openai",context.getBean(ActivityAnalysisProvider.class).provider());
            assertEquals("disabled",context.getBean(ActivityAnalysisProvider.class).unavailableReason());
        });
        runner.withPropertyValues("campus.analysis.provider=gemini").run(context->{
            assertNull(context.getStartupFailure());assertEquals(1,context.getBeansOfType(ActivityAnalysisProvider.class).size());
            assertEquals("gemini",context.getBean(ActivityAnalysisProvider.class).provider());
        });
        runner.withPropertyValues("campus.analysis.enabled=true","campus.analysis.api-key=synthetic-gemini-key").run(context->{
            assertEquals("unconfigured",context.getBean(ActivityAnalysisProvider.class).unavailableReason());
        });
    }
    @Test void sharedResponseSubscriberCancelsOversizedBodies() {
        var body=new LimitedBody();Flow.Subscription subscription=mock(Flow.Subscription.class);body.onSubscribe(subscription);
        body.onNext(List.of(ByteBuffer.wrap(new byte[MAX_RESPONSE_BYTES+1])));
        verify(subscription).cancel();assertTrue(body.getBody().toCompletableFuture().isCompletedExceptionally());
    }
}
