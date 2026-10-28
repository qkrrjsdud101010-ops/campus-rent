-- CampusRent / Oracle Database 11g / UTF-8
-- OPTIONAL DML smoke test, after 01_tables.sql / 02_relationships.sql /
-- 03_sequences.sql have been installed successfully.
-- Run with SQL*Plus or SQL Developer Run Script in a separate test connection.
-- No database user or database object is created by this file.
-- All fixture rows use a SYS_GUID tag and are rolled back to this file's
-- savepoint on success and on failure. Earlier pending caller DML is retained.
-- Sequence NEXTVAL values consumed by inserts/triggers are NOT rolled back.
-- This is a row/FK/index smoke test. It does not validate cross-row booking
-- overlap, cumulative returns, role authorization or service transactions.
-- Client settings below intentionally remain in effect after this script.

SET DEFINE OFF
SET SERVEROUTPUT ON SIZE UNLIMITED
SET AUTOCOMMIT OFF
WHENEVER SQLERROR CONTINUE NONE

PROMPT Optional constraint smoke test - fixture rows will be rolled back

DECLARE
    l_tag VARCHAR2(32) := LOWER(RAWTOHEX(SYS_GUID()));
    l_sp VARCHAR2(30) := 'CR_SMK_' || SUBSTR(RAWTOHEX(SYS_GUID()), 1, 23);
    l_sp_created BOOLEAN := FALSE;
    l_now TIMESTAMP := LOCALTIMESTAMP;
    l_start TIMESTAMP;
    l_end TIMESTAMP;
    l_email VARCHAR2(254);
    l_student NUMBER;
    l_admin NUMBER;
    l_type NUMBER;
    l_model NUMBER;
    l_equipment NUMBER;
    l_body NUMBER;
    l_accessory NUMBER;
    l_purpose NUMBER;
    l_facility_a NUMBER;
    l_facility_b NUMBER;
    l_request NUMBER;
    l_item_e NUMBER;
    l_item_f NUMBER;
    l_checkout NUMBER;
    l_usage NUMBER;
    l_count PLS_INTEGER;
    l_tests PLS_INTEGER := 0;

    PROCEDURE passed(p_name IN VARCHAR2) IS
    BEGIN
        l_tests := l_tests + 1;
        DBMS_OUTPUT.PUT_LINE('PASS ' || p_name);
    END;

    PROCEDURE ensure(p_ok IN BOOLEAN, p_name IN VARCHAR2) IS
    BEGIN
        IF p_ok THEN
            passed(p_name);
        ELSE
            RAISE_APPLICATION_ERROR(-20071, 'FAIL ' || p_name);
        END IF;
    END;

    PROCEDURE expect_error(
        p_case IN VARCHAR2,
        p_code IN NUMBER,
        p_constraint IN VARCHAR2
    ) IS
        l_expected BOOLEAN := FALSE;
    BEGIN
        BEGIN
            CASE p_case
            WHEN 'EMAIL_CASE_DUPLICATE' THEN
                INSERT INTO APP_USER (EMAIL, PASSWORD, USER_NAME)
                VALUES (UPPER(l_email), 'TEST_HASH_ONLY_' || l_tag, 'SQL smoke duplicate');
            WHEN 'EMAIL_BLANK' THEN
                INSERT INTO APP_USER (EMAIL, PASSWORD, USER_NAME)
                VALUES ('   ', 'TEST_HASH_ONLY_' || l_tag, 'SQL smoke blank');
            WHEN 'EMAIL_PADDED' THEN
                INSERT INTO APP_USER (EMAIL, PASSWORD, USER_NAME)
                VALUES (' ' || l_email, 'TEST_HASH_ONLY_' || l_tag, 'SQL smoke padded');
            WHEN 'SELECTION_NO_RESOURCE' THEN
                INSERT INTO SELECTION_ITEM (USER_ID, ITEM_KIND)
                VALUES (l_admin, 'E');
            WHEN 'SELECTION_BOTH_RESOURCES' THEN
                INSERT INTO SELECTION_ITEM (USER_ID, ITEM_KIND, EQUIPMENT_ID, FACILITY_ID)
                VALUES (l_admin, 'E', l_equipment, l_facility_a);
            WHEN 'REQUEST_NO_RESOURCE' THEN
                INSERT INTO REQUEST_ITEM (REQUEST_ID, ITEM_NO, ITEM_KIND, USE_START_AT, USE_END_AT)
                VALUES (l_request, 101, 'E', l_start, l_end);
            WHEN 'REQUEST_BOTH_RESOURCES' THEN
                INSERT INTO REQUEST_ITEM (REQUEST_ID, ITEM_NO, ITEM_KIND, EQUIPMENT_ID, FACILITY_ID, USE_START_AT, USE_END_AT)
                VALUES (l_request, 102, 'E', l_equipment, l_facility_a, l_start, l_end);
            WHEN 'FACILITY_PEOPLE_NULL' THEN
                INSERT INTO REQUEST_ITEM (REQUEST_ID, ITEM_NO, ITEM_KIND, FACILITY_ID, USE_START_AT, USE_END_AT, PURPOSE_ID)
                VALUES (l_request, 103, 'F', l_facility_a, l_start, l_end, l_purpose);
            WHEN 'FACILITY_PURPOSE_NULL' THEN
                INSERT INTO REQUEST_ITEM (REQUEST_ID, ITEM_NO, ITEM_KIND, FACILITY_ID, USE_START_AT, USE_END_AT, PEOPLE_COUNT)
                VALUES (l_request, 104, 'F', l_facility_a, l_start, l_end, 6);
            WHEN 'REQUEST_REVERSED_PERIOD' THEN
                INSERT INTO REQUEST_ITEM (REQUEST_ID, ITEM_NO, ITEM_KIND, EQUIPMENT_ID, USE_START_AT, USE_END_AT)
                VALUES (l_request, 105, 'E', l_equipment, l_end, l_start);
            WHEN 'SELECTION_REVERSED_PERIOD' THEN
                INSERT INTO SELECTION_ITEM (USER_ID, ITEM_KIND, EQUIPMENT_ID, USE_START_AT, USE_END_AT)
                VALUES (l_admin, 'E', l_equipment, l_end, l_start);
            WHEN 'CHECKOUT_KIND_FK' THEN
                INSERT INTO EQUIPMENT_CHECKOUT
                    (REQUEST_ITEM_ID, ITEM_KIND, ASSET_CODE_SNAPSHOT, EQUIPMENT_NAME_SNAPSHOT,
                     SOURCE_CODE, ACTUAL_CHECKOUT_AT, REGISTERED_AT, REGISTERED_BY)
                VALUES
                    (l_item_f, 'E', 'SMOKE', 'SQL smoke kind mismatch',
                     'ACTUAL', l_now, l_now, l_admin);
            WHEN 'FACILITY_USAGE_KIND_FK' THEN
                INSERT INTO FACILITY_USAGE (REQUEST_ITEM_ID, ITEM_KIND, STARTED_AT, STARTED_BY)
                VALUES (l_item_e, 'F', l_now, l_admin);
            WHEN 'RETURN_ROUND_COMPOSITE_FK' THEN
                INSERT INTO RETURN_COMPONENT
                    (CHECKOUT_ID, INSPECTION_ROUND, COMPONENT_SEQ, RETURNED_QTY, RETURN_CONDITION)
                VALUES (l_checkout, 99, 1, 1, 'NORMAL');
            WHEN 'RETURN_COMPONENT_COMPOSITE_FK' THEN
                INSERT INTO RETURN_COMPONENT
                    (CHECKOUT_ID, INSPECTION_ROUND, COMPONENT_SEQ, RETURNED_QTY, RETURN_CONDITION)
                VALUES (l_checkout, 1, 99, 1, 'NORMAL');
            WHEN 'RETURN_NEGATIVE_QUANTITY' THEN
                INSERT INTO RETURN_COMPONENT
                    (CHECKOUT_ID, INSPECTION_ROUND, COMPONENT_SEQ, RETURNED_QTY, RETURN_CONDITION)
                VALUES (l_checkout, 1, 2, -1, 'NORMAL');
            WHEN 'SELECTION_EQUIPMENT_DUPLICATE' THEN
                INSERT INTO SELECTION_ITEM (USER_ID, ITEM_KIND, EQUIPMENT_ID)
                VALUES (l_student, 'E', l_equipment);
            WHEN 'SELECTION_FACILITY_DUPLICATE' THEN
                INSERT INTO SELECTION_ITEM (USER_ID, ITEM_KIND, FACILITY_ID)
                VALUES (l_student, 'F', l_facility_a);
            WHEN 'BASE_COMPONENT_QUANTITY' THEN
                INSERT INTO EQUIPMENT_COMPONENT (EQUIPMENT_ID, COMPONENT_NAME, REQUIRED_QTY)
                VALUES (l_equipment, 'SQL smoke zero quantity', 0);
            WHEN 'BASE_BODY_MUST_BE_REQUIRED' THEN
                UPDATE EQUIPMENT_COMPONENT SET REQUIRED_YN = 'N'
                WHERE COMPONENT_ID = l_body;
            WHEN 'BASE_SECOND_BODY' THEN
                INSERT INTO EQUIPMENT_COMPONENT
                    (EQUIPMENT_ID, COMPONENT_NAME, REQUIRED_QTY, BODY_YN, REQUIRED_YN)
                VALUES (l_equipment, 'SQL smoke second body', 1, 'Y', 'Y');
            WHEN 'CHECKOUT_REQUIRED_QUANTITY' THEN
                INSERT INTO CHECKOUT_COMPONENT
                    (CHECKOUT_ID, COMPONENT_SEQ, COMPONENT_NAME, REQUIRED_QTY, DELIVERED_QTY,
                     BODY_YN, REQUIRED_YN, OUT_CONDITION)
                VALUES (l_checkout, 3, 'SQL smoke incomplete set', 2, 1, 'N', 'Y', 'NORMAL');
            WHEN 'CHECKOUT_BODY_MUST_BE_REQUIRED' THEN
                INSERT INTO CHECKOUT_COMPONENT
                    (CHECKOUT_ID, COMPONENT_SEQ, COMPONENT_NAME, REQUIRED_QTY, DELIVERED_QTY,
                     BODY_YN, REQUIRED_YN, OUT_CONDITION)
                VALUES (l_checkout, 4, 'SQL smoke optional snapshot body', 1, 0, 'Y', 'N', 'NORMAL');
            ELSE
                RAISE_APPLICATION_ERROR(-20072, 'Unknown smoke case: ' || p_case);
            END CASE;
        EXCEPTION
            WHEN OTHERS THEN
                IF SQLCODE = p_code
                   AND INSTR(UPPER(SQLERRM), UPPER(p_constraint)) > 0 THEN
                    l_expected := TRUE;
                ELSE
                    DBMS_OUTPUT.PUT_LINE('FAIL ' || p_case || ': expected '
                        || p_code || ' / ' || p_constraint || '; got ' || SQLERRM);
                    RAISE;
                END IF;
        END;
        IF NOT l_expected THEN
            RAISE_APPLICATION_ERROR(-20073,
                'FAIL ' || p_case || ': invalid DML unexpectedly succeeded');
        END IF;
        passed(p_case || ' (' || p_code || ', ' || p_constraint || ')');
    END;
BEGIN
    -- Generated solely from hexadecimal SYS_GUID text; no external identifier input.
    EXECUTE IMMEDIATE 'SAVEPOINT ' || l_sp;
    l_sp_created := TRUE;
    l_start := l_now + INTERVAL '1' DAY;
    l_end := l_start + INTERVAL '2' HOUR;
    l_email := 'smoke.student.' || l_tag || '@campusrent.example';

    INSERT INTO APP_USER (EMAIL, PASSWORD, USER_NAME)
    VALUES (l_email, 'TEST_HASH_ONLY_' || l_tag, 'SQL smoke student')
    RETURNING USER_ID INTO l_student;
    INSERT INTO APP_USER (EMAIL, PASSWORD, USER_NAME, ROLE_CODE)
    VALUES ('smoke.admin.' || l_tag || '@campusrent.example',
            'TEST_HASH_ONLY_' || l_tag, 'SQL smoke admin', 'ADMIN')
    RETURNING USER_ID INTO l_admin;
    ensure(l_student IS NOT NULL AND l_student > 0
           AND l_admin IS NOT NULL AND l_admin > 0 AND l_student <> l_admin,
           'AUTOMATIC_USER_IDS');

    INSERT INTO EQUIPMENT_TYPE (TYPE_NAME, CATEGORY_LABEL)
    VALUES ('SMOKE_TYPE_' || l_tag, 'SQL smoke')
    RETURNING TYPE_ID INTO l_type;
    INSERT INTO EQUIPMENT_MODEL (TYPE_ID, MODEL_CODE, MODEL_NAME, IS_DEMO_YN)
    VALUES (l_type, 'M_' || SUBSTR(l_tag, 1, 28), 'SQL smoke model', 'Y')
    RETURNING MODEL_ID INTO l_model;
    INSERT INTO EQUIPMENT
        (MODEL_ID, ASSET_CODE, EQUIPMENT_NAME, STORAGE_LOCATION, IS_DEMO_YN)
    VALUES (l_model, 'E_' || SUBSTR(l_tag, 1, 28), 'SQL smoke equipment', 'SQL smoke', 'Y')
    RETURNING EQUIPMENT_ID INTO l_equipment;
    INSERT INTO EQUIPMENT_COMPONENT
        (EQUIPMENT_ID, COMPONENT_NAME, REQUIRED_QTY, BODY_YN, REQUIRED_YN)
    VALUES (l_equipment, 'SQL smoke body', 1, 'Y', 'Y')
    RETURNING COMPONENT_ID INTO l_body;
    INSERT INTO EQUIPMENT_COMPONENT (EQUIPMENT_ID, COMPONENT_NAME, REQUIRED_QTY)
    VALUES (l_equipment, 'SQL smoke accessory', 2)
    RETURNING COMPONENT_ID INTO l_accessory;
    SELECT COUNT(*) INTO l_count FROM EQUIPMENT_COMPONENT
     WHERE COMPONENT_ID = l_accessory AND BODY_YN = 'N' AND REQUIRED_YN = 'Y';
    ensure(l_count = 1, 'BASE_COMPONENT_DEFAULT_FLAGS');

    INSERT INTO USE_PURPOSE (PURPOSE_CODE, PURPOSE_NAME)
    VALUES ('P_' || SUBSTR(l_tag, 1, 28), 'SMOKE_PURPOSE_' || l_tag)
    RETURNING PURPOSE_ID INTO l_purpose;
    INSERT INTO FACILITY
        (FACILITY_CODE, FACILITY_NAME, FACILITY_TYPE, LOCATION_TEXT, CAPACITY, IS_DEMO_YN)
    VALUES ('F1' || SUBSTR(l_tag, 1, 28), 'SQL smoke room A', 'MEETING', 'SQL smoke', 8, 'Y')
    RETURNING FACILITY_ID INTO l_facility_a;
    INSERT INTO FACILITY
        (FACILITY_CODE, FACILITY_NAME, FACILITY_TYPE, LOCATION_TEXT, CAPACITY, IS_DEMO_YN)
    VALUES ('F2' || SUBSTR(l_tag, 1, 28), 'SQL smoke room B', 'MEETING', 'SQL smoke', 8, 'Y')
    RETURNING FACILITY_ID INTO l_facility_b;
    INSERT INTO FACILITY_PURPOSE (FACILITY_ID, PURPOSE_ID) VALUES (l_facility_a, l_purpose);
    INSERT INTO FACILITY_PURPOSE (FACILITY_ID, PURPOSE_ID) VALUES (l_facility_b, l_purpose);
    INSERT INTO RENT_REQUEST (REQUEST_NO, APPLICANT_ID)
    VALUES ('R_' || SUBSTR(l_tag, 1, 28), l_student)
    RETURNING REQUEST_ID INTO l_request;
    INSERT INTO REQUEST_ITEM
        (REQUEST_ID, ITEM_NO, ITEM_KIND, EQUIPMENT_ID, USE_START_AT, USE_END_AT, STATUS_CODE)
    VALUES (l_request, 1, 'E', l_equipment, l_start, l_end, 'CHECKED_OUT')
    RETURNING REQUEST_ITEM_ID INTO l_item_e;
    INSERT INTO REQUEST_ITEM
        (REQUEST_ID, ITEM_NO, ITEM_KIND, FACILITY_ID, USE_START_AT, USE_END_AT,
         PEOPLE_COUNT, PURPOSE_ID, STATUS_CODE)
    VALUES (l_request, 2, 'F', l_facility_a, l_start, l_end, 6, l_purpose, 'IN_USE')
    RETURNING REQUEST_ITEM_ID INTO l_item_f;
    INSERT INTO EQUIPMENT_CHECKOUT
        (REQUEST_ITEM_ID, ITEM_KIND, ASSET_CODE_SNAPSHOT, EQUIPMENT_NAME_SNAPSHOT,
         SOURCE_CODE, ACTUAL_CHECKOUT_AT, REGISTERED_AT, REGISTERED_BY)
    VALUES (l_item_e, 'E', 'E_' || SUBSTR(l_tag, 1, 28), 'SQL smoke equipment',
            'ACTUAL', l_now, l_now, l_admin)
    RETURNING CHECKOUT_ID INTO l_checkout;
    INSERT INTO CHECKOUT_COMPONENT
        (CHECKOUT_ID, COMPONENT_SEQ, COMPONENT_NAME, REQUIRED_QTY, DELIVERED_QTY,
         BODY_YN, REQUIRED_YN, OUT_CONDITION)
    VALUES (l_checkout, 1, 'SQL smoke body', 1, 1, 'Y', 'Y', 'NORMAL');
    INSERT INTO CHECKOUT_COMPONENT
        (CHECKOUT_ID, COMPONENT_SEQ, COMPONENT_NAME, REQUIRED_QTY, DELIVERED_QTY,
         BODY_YN, REQUIRED_YN, OUT_CONDITION)
    VALUES (l_checkout, 2, 'SQL smoke accessory', 2, 2, 'N', 'Y', 'NORMAL');
    INSERT INTO RETURN_INSPECTION
        (CHECKOUT_ID, INSPECTION_ROUND, INSPECTED_BY, OUTCOME_CODE, HOLD_REASON)
    VALUES (l_checkout, 1, l_admin, 'HOLD', 'SQL smoke fixture, not a real inspection');
    INSERT INTO RETURN_COMPONENT
        (CHECKOUT_ID, INSPECTION_ROUND, COMPONENT_SEQ, RETURNED_QTY, RETURN_CONDITION)
    VALUES (l_checkout, 1, 1, 1, 'NORMAL');
    passed('RETURN_COMPONENT_VALID_COMPOSITE_KEYS');
    INSERT INTO FACILITY_USAGE (REQUEST_ITEM_ID, ITEM_KIND, STARTED_AT, STARTED_BY)
    VALUES (l_item_f, 'F', l_now, l_admin)
    RETURNING USAGE_ID INTO l_usage;
    ensure(l_type > 0 AND l_model > 0 AND l_equipment > 0 AND l_body > 0
           AND l_accessory > 0 AND l_purpose > 0 AND l_facility_a > 0
           AND l_facility_b > 0 AND l_request > 0 AND l_item_e > 0
           AND l_item_f > 0 AND l_checkout > 0 AND l_usage > 0,
           'AUTOMATIC_FIXTURE_IDS_AND_VALID_KIND_FKS');

    -- Both F rows must be allowed: the E-only index must map ALL keys to NULL.
    INSERT INTO SELECTION_ITEM (USER_ID, ITEM_KIND, FACILITY_ID)
    VALUES (l_student, 'F', l_facility_a);
    INSERT INTO SELECTION_ITEM (USER_ID, ITEM_KIND, FACILITY_ID)
    VALUES (l_student, 'F', l_facility_b);
    SELECT COUNT(*) INTO l_count FROM SELECTION_ITEM
     WHERE USER_ID = l_student AND ITEM_KIND = 'F'
       AND FACILITY_ID IN (l_facility_a, l_facility_b);
    ensure(l_count = 2, 'TWO_DIFFERENT_FACILITIES_CAN_BE_SELECTED');
    INSERT INTO SELECTION_ITEM (USER_ID, ITEM_KIND, EQUIPMENT_ID)
    VALUES (l_student, 'E', l_equipment);
    SELECT COUNT(*) INTO l_count FROM SELECTION_ITEM WHERE USER_ID = l_student;
    ensure(l_count = 3, 'EQUIPMENT_AND_TWO_FACILITIES_CAN_COEXIST');

    expect_error('EMAIL_CASE_DUPLICATE', -1, 'UX_USER_EMAIL_CI');
    expect_error('EMAIL_BLANK', -2290, 'CK_USR_EMAIL_TRIM');
    expect_error('EMAIL_PADDED', -2290, 'CK_USR_EMAIL_TRIM');
    expect_error('SELECTION_NO_RESOURCE', -2290, 'CK_SEL_RESOURCE');
    expect_error('SELECTION_BOTH_RESOURCES', -2290, 'CK_SEL_RESOURCE');
    expect_error('REQUEST_NO_RESOURCE', -2290, 'CK_RI_RESOURCE');
    expect_error('REQUEST_BOTH_RESOURCES', -2290, 'CK_RI_RESOURCE');
    expect_error('FACILITY_PEOPLE_NULL', -2290, 'CK_RI_FAC_FIELDS');
    expect_error('FACILITY_PURPOSE_NULL', -2290, 'CK_RI_FAC_FIELDS');
    expect_error('REQUEST_REVERSED_PERIOD', -2290, 'CK_RI_PERIOD');
    expect_error('SELECTION_REVERSED_PERIOD', -2290, 'CK_SEL_PERIOD');
    expect_error('CHECKOUT_KIND_FK', -2291, 'FK_CO_ITEM_KIND');
    expect_error('FACILITY_USAGE_KIND_FK', -2291, 'FK_FU_ITEM_KIND');
    expect_error('RETURN_ROUND_COMPOSITE_FK', -2291, 'FK_RC_ROUND');
    expect_error('RETURN_COMPONENT_COMPOSITE_FK', -2291, 'FK_RC_COMPONENT');
    expect_error('RETURN_NEGATIVE_QUANTITY', -2290, 'CK_RC_QTY');
    expect_error('SELECTION_EQUIPMENT_DUPLICATE', -1, 'UX_SEL_EQUIPMENT');
    expect_error('SELECTION_FACILITY_DUPLICATE', -1, 'UX_SEL_FACILITY');
    expect_error('BASE_COMPONENT_QUANTITY', -2290, 'CK_EC_QTY');
    expect_error('BASE_BODY_MUST_BE_REQUIRED', -2290, 'CK_EC_BODY_REQUIRED');
    expect_error('BASE_SECOND_BODY', -1, 'UX_EQ_ONE_BODY');
    expect_error('CHECKOUT_REQUIRED_QUANTITY', -2290, 'CK_CC_REQ_DELIVERED');
    expect_error('CHECKOUT_BODY_MUST_BE_REQUIRED', -2290, 'CK_CC_BODY_REQUIRED');

    EXECUTE IMMEDIATE 'ROLLBACK TO SAVEPOINT ' || l_sp;
    l_sp_created := FALSE;
    DBMS_OUTPUT.PUT_LINE(l_tests || ' constraint checks passed; fixture DML rolled back.');
    DBMS_OUTPUT.PUT_LINE('Sequence values consumed by this test are not restored.');
    DBMS_OUTPUT.PUT_LINE('Cross-row booking, cumulative-return and authorization rules were not tested.');
EXCEPTION
    WHEN OTHERS THEN
        DBMS_OUTPUT.PUT_LINE('FAIL constraint smoke test: ' || SQLERRM);
        IF l_sp_created THEN
            BEGIN
                EXECUTE IMMEDIATE 'ROLLBACK TO SAVEPOINT ' || l_sp;
            EXCEPTION
                WHEN OTHERS THEN
                    RAISE_APPLICATION_ERROR(-20074,
                        'Rollback to the smoke savepoint failed: ' || SQLERRM, TRUE);
            END;
        END IF;
        RAISE;
END;
/
