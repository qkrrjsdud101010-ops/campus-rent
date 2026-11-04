package kr.ac.campusrent.config;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.HttpMethod;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.security.web.context.HttpSessionSecurityContextRepository;
import org.springframework.security.web.csrf.CsrfTokenRepository;
import org.springframework.security.web.csrf.CsrfTokenRequestAttributeHandler;
import org.springframework.security.web.csrf.HttpSessionCsrfTokenRepository;

@Configuration
public class SecurityConfig {
    @Bean org.springframework.security.core.userdetails.UserDetailsService noDefaultAccount() {
        return username -> { throw new org.springframework.security.core.userdetails.UsernameNotFoundException("Use the CampusRent session login API."); };
    }
    @Bean PasswordEncoder passwordEncoder() { return new BCryptPasswordEncoder(12); }
    @Bean CsrfTokenRepository csrfTokenRepository() { return new HttpSessionCsrfTokenRepository(); }
    @Bean HttpSessionSecurityContextRepository securityContextRepository() {
        return new HttpSessionSecurityContextRepository();
    }
    @Bean SecurityFilterChain securityFilterChain(HttpSecurity http, CsrfTokenRepository csrf,
            HttpSessionSecurityContextRepository contexts) throws Exception {
        http.csrf(config -> config.csrfTokenRepository(csrf)
                .csrfTokenRequestHandler(new CsrfTokenRequestAttributeHandler()));
        http.securityContext(config -> config.securityContextRepository(contexts).requireExplicitSave(true));
        http.authorizeHttpRequests(config -> config
                .requestMatchers(HttpMethod.GET, "/api/auth/me", "/api/auth/csrf", "/api/catalog").permitAll()
                .requestMatchers(HttpMethod.POST, "/api/auth/login", "/api/auth/signup").permitAll()
                .requestMatchers("/api/admin/**").hasRole("ADMIN")
                .requestMatchers("/api/**").authenticated()
                .anyRequest().permitAll());
        http.formLogin(config -> config.disable()).httpBasic(config -> config.disable());
        http.logout(config -> config.disable());
        http.requestCache(config -> config.disable());
        http.exceptionHandling(config -> config
                .authenticationEntryPoint((request, response, error) -> {
                    response.setStatus(401); response.setContentType("application/json;charset=UTF-8");
                    response.getWriter().write("{\"message\":\"로그인이 필요합니다.\"}");
                })
                .accessDeniedHandler((request, response, error) -> {
                    response.setStatus(403); response.setContentType("application/json;charset=UTF-8");
                    response.getWriter().write("{\"message\":\"권한 또는 보안 토큰을 확인해주세요.\"}");
                }));
        return http.build();
    }
}
