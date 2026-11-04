import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.sql.CallableStatement;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Statement;
import java.sql.Types;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/** Fixed CampusRent SQL runner; not a general SQL*Plus replacement. Never prints credentials. */
public final class OracleSchemaTool {
    private static final String[] INSTALL = {
        "00_preflight.sql", "01_tables.sql", "02_relationships.sql", "03_sequences.sql", "04_verify.sql"
    };
    private static final String CONSTRAINTS = "tests/constraints.sql";
    private static final String CRUD = "tests/crud.sql";
    private static final String CONSTRAINT_MARKER = "29 constraint checks passed; fixture DML rolled back.";
    private static final String CRUD_MARKER = "4 CRUD checks passed; fixture DML rolled back.";
    private static final String VERIFY_MARKER = "Schema metadata verification passed. Run tests/constraints.sql separately for DML checks.";
    private static final String PREFLIGHT_MARKER = "Preflight passed. DDL will run in the current connected schema.";
    private static final Pattern PLSQL = Pattern.compile("(?is)^(DECLARE\\b|BEGIN\\b|CREATE\\s+(?:OR\\s+REPLACE\\s+)?TRIGGER\\b).*");
    private static final Pattern SHOW = Pattern.compile("(?i)^SHOW\\s+ERRORS\\s+TRIGGER\\s+([A-Z][A-Z0-9_]{0,29})$");
    private static String stage = "startup";
    private static boolean ddlAttempted;

    public static void main(String[] args) {
        String mode = "";
        try {
            boolean parseOnly = args.length == 2 && "--parse-only".equals(args[0]);
            if (!parseOnly && (args.length != 3 || !Arrays.asList("review", "install", "verify", "constraints", "crud").contains(args[1]))) {
                throw new IllegalArgumentException("Use <local-properties> <review|install|verify|constraints|crud> <repo-root>, or --parse-only <repo-root>.");
            }
            Path root = Paths.get(parseOnly ? args[1] : args[2]).toRealPath();
            stage = "offline SQL parsing";
            Map<String, Script> scripts = loadScripts(root);
            if (parseOnly) {
                parserSelfCheck();
                for (Script script : scripts.values()) {
                    System.out.println("PASS parse " + script.name + ": " + script.commands.size() + " commands");
                }
                System.out.println("PASS: fixed SQL manifest, statement boundaries and parser checks. No local configuration or database was read.");
                return;
            }
            mode = args[1];
            stage = mode + " connection";
            try (Connection connection = OracleConnectionCheck.openAssignedConnection(args[0])) {
                try {
                    if ("review".equals(mode)) {
                        review(connection, false);
                    } else {
                        enableOutput(connection);
                        Set<String> allowedOutput = successOutput(scripts);
                        if ("install".equals(mode)) {
                            stage = "install readiness review";
                            review(connection, true);
                            System.out.println("DDL commits implicitly. On failure, earlier successful objects stay in place; no deletion or automatic retry is performed.");
                            for (String file : INSTALL) execute(connection, scripts.get(file), allowedOutput);
                            System.out.println("PASS: CampusRent schema installation and metadata verification completed.");
                        } else {
                            String file = "verify".equals(mode) ? "04_verify.sql" : "constraints".equals(mode) ? CONSTRAINTS : CRUD;
                            execute(connection, scripts.get(file), allowedOutput);
                        }
                    }
                } finally {
                    connection.rollback();
                }
            }
        } catch (SQLException error) {
            System.err.println("DATABASE: stopped at " + stage + "; Oracle/JDBC error code: " + error.getErrorCode() + ". Error text is hidden.");
            if (ddlAttempted) System.err.println("Earlier DDL may already be committed. Inspect the own-schema state before any manual retry.");
            System.exit(4);
        } catch (ClassNotFoundException error) {
            System.err.println("DRIVER: run tools/setup-oracle-jdbc.ps1 or configure ORACLE_JDBC_JAR.");
            System.exit(3);
        } catch (IOException error) {
            System.err.println("FILES: could not read the fixed SQL sources or local configuration at " + stage + ". File contents and paths are hidden.");
            System.exit(2);
        } catch (RuntimeException error) {
            System.err.println("CHECK: stopped at " + stage + ". Check the fixed SQL files, configuration and readiness; details are hidden.");
            if (ddlAttempted) System.err.println("Earlier successful DDL is preserved. No automatic retry was performed.");
            System.exit(2);
        }
    }

    private static Map<String, Script> loadScripts(Path root) throws IOException {
        Path base = root.resolve("db/oracle11g").toRealPath();
        List<String> includes = new ArrayList<String>();
        for (String line : Files.readAllLines(base.resolve("install.sql"), StandardCharsets.UTF_8)) {
            String text = line.trim();
            if (text.isEmpty() || text.startsWith("--") || directive(text)) continue;
            if (text.startsWith("@@")) includes.add(text.substring(2).trim());
            else throw new IllegalArgumentException("Unexpected installer command.");
        }
        if (!includes.equals(Arrays.asList(INSTALL))) throw new IllegalArgumentException("Installer manifest changed.");
        Map<String, Script> scripts = new LinkedHashMap<String, Script>();
        List<String> files = new ArrayList<String>(includes);
        files.add(CONSTRAINTS); files.add(CRUD);
        for (String file : files) {
            Path path = base.resolve(file).toRealPath();
            if (!path.startsWith(base)) throw new IllegalArgumentException("SQL source escaped the fixed directory.");
            Script script = parse(file, new String(Files.readAllBytes(path), StandardCharsets.UTF_8));
            validateScript(script);
            scripts.put(file, script);
        }
        return scripts;
    }

    private static boolean directive(String line) {
        String upper = line.toUpperCase(Locale.ROOT);
        return upper.matches("SET (DEFINE OFF|SQLBLANKLINES ON|SERVEROUTPUT ON(?: SIZE UNLIMITED)?|AUTOCOMMIT OFF)") ||
            upper.equals("WHENEVER OSERROR EXIT FAILURE ROLLBACK") ||
            upper.equals("WHENEVER SQLERROR EXIT SQL.SQLCODE ROLLBACK") ||
            upper.equals("WHENEVER SQLERROR CONTINUE NONE") || upper.startsWith("PROMPT ");
    }

    private static Script parse(String name, String source) {
        Script script = new Script(name);
        StringBuilder sql = new StringBuilder();
        boolean quoted = false, identifier = false, blockComment = false;
        int startedAt = 1;
        String[] lines = source.replace("\r\n", "\n").replace('\r', '\n').split("\n", -1);
        for (int lineNo = 0; lineNo < lines.length; lineNo++) {
            String line = lines[lineNo];
            String trimmed = line.trim();
            if (!quoted && !identifier && !blockComment) {
                if (sql.toString().trim().isEmpty()) {
                    sql.setLength(0);
                    if (trimmed.isEmpty() || trimmed.startsWith("--") || directive(trimmed)) continue;
                    Matcher show = SHOW.matcher(trimmed);
                    if (show.matches()) { script.commands.add(new Command(null, show.group(1).toUpperCase(Locale.ROOT), lineNo + 1)); continue; }
                    startedAt = lineNo + 1;
                }
                if ("/".equals(trimmed)) {
                    if (!PLSQL.matcher(sql.toString().trim()).matches()) throw new IllegalArgumentException("Unexpected slash.");
                    script.commands.add(new Command(sql.toString().trim(), null, startedAt));
                    sql.setLength(0);
                    continue;
                }
            }
            for (int index = 0; index < line.length(); index++) {
                char value = line.charAt(index);
                char next = index + 1 < line.length() ? line.charAt(index + 1) : '\0';
                if (blockComment) {
                    if (value == '*' && next == '/') { blockComment = false; index++; sql.append(' '); }
                } else if (quoted) {
                    sql.append(value);
                    if (value == '\'') { if (next == '\'') { sql.append(next); index++; } else quoted = false; }
                } else if (identifier) {
                    sql.append(value);
                    if (value == '"') { if (next == '"') { sql.append(next); index++; } else identifier = false; }
                } else if (value == '-' && next == '-') {
                    break;
                } else if (value == '/' && next == '*') {
                    blockComment = true; index++; sql.append(' ');
                } else if ((value == 'q' || value == 'Q') && next == '\'') {
                    throw new IllegalArgumentException("Alternative quote syntax is not used by the fixed sources.");
                } else if (value == '\'') {
                    quoted = true; sql.append(value);
                } else if (value == '"') {
                    identifier = true; sql.append(value);
                } else if (value == ';' && !PLSQL.matcher(sql.toString().trim()).matches()) {
                    if (sql.toString().trim().isEmpty()) throw new IllegalArgumentException("Empty SQL statement.");
                    script.commands.add(new Command(sql.toString().trim(), null, startedAt));
                    sql.setLength(0); startedAt = lineNo + 1;
                } else {
                    sql.append(value);
                }
            }
            sql.append('\n');
        }
        if (quoted || identifier || blockComment || !sql.toString().trim().isEmpty()) throw new IllegalArgumentException("Unterminated SQL.");
        return script;
    }

    private static void validateScript(Script script) {
        int sqlCount = 0, showCount = 0;
        for (Command command : script.commands) {
            if (command.trigger != null) {
                if (!"03_sequences.sql".equals(script.name)) throw new IllegalArgumentException("Unexpected SHOW ERRORS.");
                showCount++; continue;
            }
            sqlCount++;
            String text = command.sql.toUpperCase(Locale.ROOT);
            boolean accepted;
            if ("01_tables.sql".equals(script.name)) accepted = text.matches("(?s)^(CREATE TABLE [A-Z][A-Z0-9_]*\\s*\\(|COMMENT ON (TABLE|COLUMN) ).*");
            else if ("02_relationships.sql".equals(script.name)) accepted = text.matches("(?s)^(ALTER TABLE [A-Z][A-Z0-9_]*\\s+ADD\\s+CONSTRAINT |CREATE (?:UNIQUE )?INDEX [A-Z][A-Z0-9_]*\\s+ON ).*");
            else if ("03_sequences.sql".equals(script.name)) accepted = text.matches("(?s)^CREATE (SEQUENCE|TRIGGER) [A-Z][A-Z0-9_]*\\s.*");
            else accepted = text.startsWith("DECLARE") || text.startsWith("BEGIN");
            if (!accepted) throw new IllegalArgumentException("Unexpected statement category.");
        }
        int expected = "01_tables.sql".equals(script.name) ? 237 : "02_relationships.sql".equals(script.name) ? 79 : "03_sequences.sql".equals(script.name) ? 34 : 1;
        if (sqlCount != expected || showCount != ("03_sequences.sql".equals(script.name) ? 17 : 0)) throw new IllegalArgumentException("Fixed statement count changed.");
    }

    private static void parserSelfCheck() {
        Script sql = parse("self-check", "-- ; ignored\nCOMMENT ON TABLE X IS 'a; b''s value'; /* ; */\nSELECT 1 FROM DUAL;\n");
        Script block = parse("self-check", "DECLARE x NUMBER; BEGIN x := 1; END;\n/\n");
        Script trigger = parse("self-check", "CREATE OR REPLACE TRIGGER X BEFORE INSERT ON Y BEGIN NULL; END;\n/\nSHOW ERRORS TRIGGER X\n");
        if (sql.commands.size() != 2 || block.commands.size() != 1 || trigger.commands.size() != 2) throw new IllegalStateException("Parser checks failed.");
        boolean rejected = false;
        try { parse("self-check", "SELECT 'unterminated FROM DUAL;\n"); } catch (IllegalArgumentException expected) { rejected = true; }
        if (!rejected) throw new IllegalStateException("Parser accepted an unterminated literal.");
    }

    private static long number(Connection connection, String sql) throws SQLException {
        try (Statement statement = connection.createStatement()) {
            statement.setQueryTimeout(30);
            try (ResultSet rows = statement.executeQuery(sql)) {
                if (!rows.next()) throw new SQLException("Readiness query returned no row.");
                return rows.getLong(1);
            }
        }
    }

    private static void review(Connection connection, boolean requireReady) throws SQLException {
        stage = "own-schema readiness review";
        System.out.println("Own-schema object count: " + number(connection, "SELECT COUNT(*) FROM USER_OBJECTS"));
        boolean privileges = true;
        for (String privilege : Arrays.asList("CREATE TABLE", "CREATE SEQUENCE", "CREATE TRIGGER")) {
            boolean available = number(connection, "SELECT COUNT(*) FROM SESSION_PRIVS WHERE PRIVILEGE = '" + privilege + "'") > 0;
            System.out.println(privilege + ": " + (available ? "available" : "missing"));
            privileges &= available;
        }
        boolean unlimited = number(connection, "SELECT COUNT(*) FROM SESSION_PRIVS WHERE PRIVILEGE = 'UNLIMITED TABLESPACE'") > 0;
        boolean quota = unlimited || number(connection,
            "SELECT COUNT(*) FROM USER_TS_QUOTAS WHERE TABLESPACE_NAME = (SELECT DEFAULT_TABLESPACE FROM USER_USERS) " +
            "AND (MAX_BYTES = -1 OR MAX_BYTES > BYTES)") > 0;
        System.out.println("Default-tablespace quota: " + (unlimited ? "UNLIMITED TABLESPACE available" : quota ? "positive quota available" : "not available"));
        if (requireReady && (!privileges || !quota)) throw new IllegalStateException("Assigned schema is not ready for DDL.");
    }

    private static void enableOutput(Connection connection) throws SQLException {
        try (CallableStatement call = connection.prepareCall("BEGIN DBMS_OUTPUT.ENABLE(NULL); END;")) {
            call.setQueryTimeout(30); call.execute();
        }
    }

    private static Set<String> successOutput(Map<String, Script> scripts) {
        Set<String> lines = new LinkedHashSet<String>();
        lines.add(PREFLIGHT_MARKER); lines.add(VERIFY_MARKER); lines.add(CONSTRAINT_MARKER); lines.add(CRUD_MARKER);
        lines.addAll(Arrays.asList("PASS CRUD CREATE", "PASS CRUD READ", "PASS CRUD UPDATE", "PASS CRUD DELETE"));
        lines.add("Sequence values consumed by this test are not restored.");
        lines.add("Cross-row booking, cumulative-return and authorization rules were not tested.");
        String verify = scripts.get("04_verify.sql").commands.get(0).sql;
        Matcher counts = Pattern.compile("expect_count\\(v_count,\\s*(\\d+),\\s*'([^']+)'\\)").matcher(verify);
        while (counts.find()) lines.add("PASS " + counts.group(2) + ": " + counts.group(1));
        for (String file : Arrays.asList(CONSTRAINTS, CRUD)) {
            String text = scripts.get(file).commands.get(0).sql;
            Matcher literalLabels = Pattern.compile("(?:passed|ensure)\\([^;]*?'([A-Z][A-Z0-9_]+)'\\s*\\)", Pattern.CASE_INSENSITIVE).matcher(text);
            while (literalLabels.find()) lines.add("PASS " + literalLabels.group(1));
            Matcher errors = Pattern.compile("expect_error\\('([A-Z0-9_]+)',\\s*(-?\\d+),\\s*'([A-Z0-9_]+)'\\)").matcher(text);
            while (errors.find()) lines.add("PASS " + errors.group(1) + " (" + errors.group(2) + ", " + errors.group(3) + ")");
        }
        return lines;
    }

    private static void execute(Connection connection, Script script, Set<String> allowedOutput) throws SQLException {
        System.out.println("Executing fixed script " + script.name + ".");
        Set<String> observed = new LinkedHashSet<String>();
        int checkedTriggers = 0;
        for (Command command : script.commands) {
            stage = script.name + " line " + command.line;
            if (command.trigger != null) {
                try (PreparedStatement statement = connection.prepareStatement("SELECT COUNT(*) FROM USER_ERRORS WHERE NAME = ? AND TYPE = 'TRIGGER' AND ATTRIBUTE = 'ERROR'")) {
                    statement.setString(1, command.trigger); statement.setQueryTimeout(30);
                    try (ResultSet rows = statement.executeQuery()) {
                        if (!rows.next() || rows.getInt(1) != 0) throw new SQLException("Trigger compilation failed.");
                    }
                }
                checkedTriggers++;
            } else {
                if (command.sql.toUpperCase(Locale.ROOT).startsWith("CREATE ") || command.sql.toUpperCase(Locale.ROOT).startsWith("ALTER ")) ddlAttempted = true;
                try (Statement statement = connection.createStatement()) {
                    statement.setQueryTimeout(script.name.startsWith("tests/") ? 60 : 30);
                    statement.execute(command.sql);
                }
                drainOutput(connection, allowedOutput, observed);
            }
        }
        if (checkedTriggers > 0) System.out.println("PASS trigger compilation checks: " + checkedTriggers);
        String required = "00_preflight.sql".equals(script.name) ? PREFLIGHT_MARKER : "04_verify.sql".equals(script.name) ? VERIFY_MARKER : CONSTRAINTS.equals(script.name) ? CONSTRAINT_MARKER : CRUD.equals(script.name) ? CRUD_MARKER : null;
        if (required != null && !observed.contains(required)) throw new SQLException("Expected verification marker was missing.");
    }

    private static void drainOutput(Connection connection, Set<String> allowed, Set<String> observed) throws SQLException {
        try (CallableStatement call = connection.prepareCall("BEGIN DBMS_OUTPUT.GET_LINE(?, ?); END;")) {
            call.setQueryTimeout(30); call.registerOutParameter(1, Types.VARCHAR); call.registerOutParameter(2, Types.INTEGER);
            for (int count = 0; count < 10000; count++) {
                call.execute();
                if (call.getInt(2) != 0) return;
                String line = call.getString(1);
                if (line != null && line.startsWith("FAIL")) throw new SQLException("Database output reported a failure.");
                if (allowed.contains(line)) { observed.add(line); System.out.println(line); }
            }
            throw new SQLException("Database output limit reached.");
        }
    }

    private static final class Script {
        final String name;
        final List<Command> commands = new ArrayList<Command>();
        Script(String name) { this.name = name; }
    }
    private static final class Command {
        final String sql, trigger;
        final int line;
        Command(String sql, String trigger, int line) { this.sql = sql; this.trigger = trigger; this.line = line; }
    }
}
