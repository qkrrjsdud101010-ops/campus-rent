-- CampusRent / Oracle Database 11g / UTF-8
-- Optional, single-row CRUD check in the current assigned schema only.
-- A unique fixture is inserted, read, updated, and deleted; all fixture DML
-- is rolled back to this script's savepoint on success or failure.
-- No DDL or COMMIT. Sequence values consumed by INSERT are not restored.
SET DEFINE OFF
SET SERVEROUTPUT ON SIZE UNLIMITED
SET AUTOCOMMIT OFF
WHENEVER SQLERROR CONTINUE NONE

PROMPT Optional CRUD check - fixture DML will be rolled back

DECLARE
    l_tag VARCHAR2(32) := LOWER(RAWTOHEX(SYS_GUID()));
    l_savepoint VARCHAR2(30) := 'CR_CRUD_' || SUBSTR(RAWTOHEX(SYS_GUID()), 1, 22);
    l_started BOOLEAN := FALSE;
    l_user_id NUMBER;
    l_email VARCHAR2(254);
    l_count PLS_INTEGER;
    l_name VARCHAR2(50);
    PROCEDURE ensure(p_condition BOOLEAN, p_label VARCHAR2) IS
    BEGIN
        IF NOT p_condition OR p_condition IS NULL THEN
            RAISE_APPLICATION_ERROR(-20081, 'CRUD check failed.');
        END IF;
        DBMS_OUTPUT.PUT_LINE('PASS CRUD ' || p_label);
    END;
BEGIN
    EXECUTE IMMEDIATE 'SAVEPOINT ' || l_savepoint;
    l_started := TRUE;
    l_email := 'crud_' || l_tag || '@example.invalid';

    INSERT INTO APP_USER (EMAIL, PASSWORD, USER_NAME, ROLE_CODE)
    VALUES (l_email, 'TEST_HASH_ONLY_' || l_tag, 'CRUD fixture', 'STUDENT')
    RETURNING USER_ID INTO l_user_id;
    ensure(l_user_id IS NOT NULL AND SQL%ROWCOUNT = 1, 'CREATE');

    SELECT USER_NAME INTO l_name FROM APP_USER
     WHERE USER_ID = l_user_id AND EMAIL = l_email;
    ensure(l_name = 'CRUD fixture', 'READ');

    UPDATE APP_USER SET USER_NAME = 'CRUD updated'
     WHERE USER_ID = l_user_id AND EMAIL = l_email;
    IF SQL%ROWCOUNT <> 1 THEN
        RAISE_APPLICATION_ERROR(-20082, 'CRUD update count failed.');
    END IF;
    SELECT USER_NAME INTO l_name FROM APP_USER
     WHERE USER_ID = l_user_id AND EMAIL = l_email;
    ensure(l_name = 'CRUD updated', 'UPDATE');

    DELETE FROM APP_USER WHERE USER_ID = l_user_id AND EMAIL = l_email;
    IF SQL%ROWCOUNT <> 1 THEN
        RAISE_APPLICATION_ERROR(-20083, 'CRUD delete count failed.');
    END IF;
    SELECT COUNT(*) INTO l_count FROM APP_USER
     WHERE USER_ID = l_user_id AND EMAIL = l_email;
    ensure(l_count = 0, 'DELETE');

    EXECUTE IMMEDIATE 'ROLLBACK TO SAVEPOINT ' || l_savepoint;
    l_started := FALSE;
    DBMS_OUTPUT.PUT_LINE('4 CRUD checks passed; fixture DML rolled back.');
    DBMS_OUTPUT.PUT_LINE('Sequence values consumed by this test are not restored.');
EXCEPTION
    WHEN OTHERS THEN
        IF l_started THEN
            EXECUTE IMMEDIATE 'ROLLBACK TO SAVEPOINT ' || l_savepoint;
        END IF;
        DBMS_OUTPUT.PUT_LINE('FAIL CRUD check; raw database details omitted.');
        RAISE;
END;
/
