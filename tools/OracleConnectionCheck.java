import java.io.IOException;
import java.io.Reader;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.sql.Connection;
import java.sql.DatabaseMetaData;
import java.sql.DriverManager;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Statement;
import java.util.Properties;
import java.util.regex.Pattern;

/** Read-only JDBC check. No DDL, DML, SQL file execution, or credential output. */
public final class OracleConnectionCheck {
    private static final Pattern SID_URL = Pattern.compile(
        "jdbc:oracle:thin:@[A-Za-z0-9.-]+:[0-9]{1,5}:[A-Za-z0-9_]+"
    );
    private static final Pattern USER_NAME = Pattern.compile("[A-Za-z][A-Za-z0-9_$#]{0,29}");

    public static void main(String[] args) {
        try {
            if (args.length < 1 || args.length > 2 ||
                (args.length == 2 && !"--validate-only".equals(args[1]))) {
                throw new IllegalArgumentException("Usage: OracleConnectionCheck <local-properties> [--validate-only]");
            }
            if (args.length == 2) {
                Properties settings = validatedSettings(args[0]);
                settings.clear();
                Class.forName("oracle.jdbc.OracleDriver");
                System.out.println("PASS: local configuration format and JDBC driver loading (no network connection).");
                return;
            }
            try (Connection connection = openAssignedConnection(args[0])) {
                try {
                    DatabaseMetaData metadata = connection.getMetaData();
                    System.out.println("PASS: SELECT 1 FROM DUAL and assigned account/current-schema match.");
                    System.out.println("Database version: " + safeVersion(metadata.getDatabaseProductVersion()));
                    System.out.println("JDBC version: " + safeVersion(metadata.getDriverVersion()));
                    try (Statement statement = connection.createStatement()) {
                        statement.setQueryTimeout(10);
                        try (ResultSet result = statement.executeQuery("SELECT COUNT(*) FROM USER_TABLES")) {
                            if (result.next()) System.out.println("Own-schema table count: " + result.getInt(1));
                        }
                    }
                    System.out.println("Read-only check completed. No tables, sequences, or rows were changed.");
                } finally {
                    connection.rollback();
                }
            }
        } catch (IllegalArgumentException error) {
            System.err.println("CONFIGURATION: " + error.getMessage());
            System.exit(2);
        } catch (ClassNotFoundException error) {
            System.err.println("DRIVER: Oracle JDBC driver is missing. Run tools/setup-oracle-jdbc.ps1.");
            System.exit(3);
        } catch (IOException error) {
            System.err.println("CONFIGURATION: Cannot read the local properties file. Check its path and permissions.");
            System.exit(2);
        } catch (SQLException error) {
            // Driver messages and stack traces can contain connection details. Do not print them.
            System.err.println("DATABASE: Connection/check failed. Oracle/JDBC error code: " + error.getErrorCode());
            if (error.getErrorCode() == 1017) {
                System.err.println("Check the assigned username/password locally; no alternate account will be tried.");
            } else if (error.getErrorCode() == 28000) {
                System.err.println("The assigned account is locked. Contact the database administrator.");
            } else if (error.getErrorCode() == 28001) {
                System.err.println("The assigned password has expired. Contact the database administrator.");
            } else {
                System.err.println("Check the provided host, port, SID, network access, and JDBC compatibility locally.");
            }
            System.exit(4);
        } catch (RuntimeException error) {
            System.err.println("CHECK: Unable to complete the check. No credentials or driver details were printed.");
            System.exit(5);
        }
    }

    private static Properties validatedSettings(String configPath) throws IOException {
        Properties local = new Properties();
        Path config = Paths.get(configPath);
        if (Files.isRegularFile(config)) {
            try (Reader reader = Files.newBufferedReader(config, StandardCharsets.UTF_8)) {
                local.load(reader);
            }
        }
        checkEnvironmentConflict(local, "url", "SPRING_DATASOURCE_URL");
        checkEnvironmentConflict(local, "username", "SPRING_DATASOURCE_USERNAME");
        Properties settings = new Properties();
        settings.setProperty("url", setting(local, "url", "SPRING_DATASOURCE_URL"));
        settings.setProperty("username", setting(local, "username", "SPRING_DATASOURCE_USERNAME"));
        settings.setProperty("password", setting(local, "password", "SPRING_DATASOURCE_PASSWORD"));
        local.clear();
        validate(settings.getProperty("url"), settings.getProperty("username"), settings.getProperty("password"));
        return settings;
    }

    private static String setting(Properties local, String key, String environmentName) {
        String environmentValue = System.getenv(environmentName);
        return environmentValue != null ? environmentValue : local.getProperty("spring.datasource." + key, "");
    }

    private static void checkEnvironmentConflict(Properties local, String key, String environmentName) {
        String configured = local.getProperty("spring.datasource." + key, "");
        String environment = System.getenv(environmentName);
        if (!configured.isEmpty() && !configured.contains("YOUR_") && environment != null &&
            !configured.equals(environment)) {
            throw new IllegalArgumentException("An existing datasource environment setting conflicts with the local file. Clear it or use a consistent configuration.");
        }
    }

    private static void validate(String url, String username, String password) {
        if (!SID_URL.matcher(url).matches() || url.contains("YOUR_")) {
            throw new IllegalArgumentException("Set a valid Oracle Thin SID URL in the ignored local file or environment.");
        }
        String[] parts = url.substring("jdbc:oracle:thin:@".length()).split(":");
        int port = Integer.parseInt(parts[1]);
        if (port < 1 || port > 65535) {
            throw new IllegalArgumentException("The configured database port must be between 1 and 65535.");
        }
        if (!USER_NAME.matcher(username).matches() || username.startsWith("YOUR_") ||
            "SYS".equalsIgnoreCase(username) || "SYSTEM".equalsIgnoreCase(username) ||
            "PUBLIC".equalsIgnoreCase(username)) {
            throw new IllegalArgumentException("Set the assigned application account, not a system account.");
        }
        if (password.isEmpty() || password.startsWith("${") || password.equals("YOUR_PASSWORD")) {
            throw new IllegalArgumentException("Fill the password in application-local.properties or SPRING_DATASOURCE_PASSWORD.");
        }
    }

    /** Opens only the configured assigned account; callers choose their allowed SQL operations. */
    public static Connection openAssignedConnection(String configPath)
            throws IOException, ClassNotFoundException, SQLException {
        Properties settings = validatedSettings(configPath);
        String username = settings.getProperty("username");
        Properties credentials = new Properties();
        credentials.setProperty("user", username);
        credentials.setProperty("password", settings.getProperty("password"));
        credentials.setProperty("oracle.net.CONNECT_TIMEOUT", "10000");
        credentials.setProperty("oracle.jdbc.ReadTimeout", "60000");
        DriverManager.setLoginTimeout(15);
        Connection connection = null;
        try {
            Class.forName("oracle.jdbc.OracleDriver");
            connection = DriverManager.getConnection(settings.getProperty("url"), credentials);
            connection.setAutoCommit(false);
            try (Statement statement = connection.createStatement()) {
                statement.setQueryTimeout(10);
                try (ResultSet result = statement.executeQuery("SELECT 1 FROM DUAL")) {
                    if (!result.next() || result.getInt(1) != 1) {
                        throw new SQLException("Connectivity query failed.");
                    }
                }
                try (ResultSet result = statement.executeQuery(
                    "SELECT SYS_CONTEXT('USERENV', 'SESSION_USER'), " +
                    "SYS_CONTEXT('USERENV', 'CURRENT_SCHEMA') FROM DUAL")) {
                    if (!result.next() || !username.equalsIgnoreCase(result.getString(1)) ||
                        !username.equalsIgnoreCase(result.getString(2))) {
                        throw new SQLException("Assigned account and current schema do not match.");
                    }
                }
            }
            return connection;
        } catch (SQLException error) {
            if (connection != null) try { connection.close(); } catch (SQLException ignored) { }
            throw error;
        } catch (RuntimeException error) {
            if (connection != null) try { connection.close(); } catch (SQLException ignored) { }
            throw error;
        } finally {
            credentials.clear();
            settings.clear();
        }
    }

    private static String safeVersion(String version) {
        if (version == null) return "unavailable";
        String cleaned = version.replaceAll("[\\r\\n\\t]+", " ");
        return cleaned.substring(0, Math.min(cleaned.length(), 300));
    }
}
