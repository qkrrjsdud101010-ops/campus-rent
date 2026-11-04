package kr.ac.campusrent.config;

import com.zaxxer.hikari.HikariDataSource;
import javax.sql.DataSource;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.jdbc.core.JdbcTemplate;

@Configuration
public class DatabaseConfig {
    @Bean(destroyMethod = "close")
    HikariDataSource dataSource(@Value("${spring.datasource.url:}") String url,
            @Value("${spring.datasource.username:}") String username,
            @Value("${spring.datasource.password:}") String password) {
        if (!url.matches("jdbc:oracle:thin:@[A-Za-z0-9.-]+:[0-9]{1,5}:[A-Za-z0-9_]+") ||
                username.isBlank() || password.isEmpty()) {
            throw new IllegalStateException("Git 제외 로컬 DB 설정을 확인하세요.");
        }
        HikariDataSource source = new HikariDataSource();
        source.setDriverClassName("oracle.jdbc.OracleDriver");
        source.setJdbcUrl(url); source.setUsername(username); source.setPassword(password);
        source.setMaximumPoolSize(5); source.setMinimumIdle(0);
        source.setConnectionTimeout(15000); source.setValidationTimeout(5000);
        source.setInitializationFailTimeout(-1);
        source.addDataSourceProperty("oracle.net.CONNECT_TIMEOUT", "10000");
        source.addDataSourceProperty("oracle.jdbc.ReadTimeout", "60000");
        source.addDataSourceProperty("oracle.jdbc.timezoneAsRegion", "false");
        return source;
    }
    @Bean JdbcTemplate jdbcTemplate(DataSource source) {
        JdbcTemplate jdbc = new JdbcTemplate(source);
        jdbc.setQueryTimeout(30);
        return jdbc;
    }
}
