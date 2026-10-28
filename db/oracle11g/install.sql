-- CampusRent / Oracle Database 11g / UTF-8
-- Source: docs/erd/[New-Era] CampusRent_ERD_20261020.pdf (physical page 2)
-- Codes, defaults, UQ and CHECK additions are documented in README.md.
-- SQL*Plus / SQL Developer Run Script (F5). Use an application-owned schema.
-- DDL commits implicitly. This installer never drops or truncates existing data.
SET DEFINE OFF
SET SQLBLANKLINES ON
SET SERVEROUTPUT ON
WHENEVER OSERROR EXIT FAILURE ROLLBACK
WHENEVER SQLERROR EXIT SQL.SQLCODE ROLLBACK

@@00_preflight.sql
@@01_tables.sql
@@02_relationships.sql
@@03_sequences.sql
@@04_verify.sql

PROMPT CampusRent Oracle 11g schema installation completed.
PROMPT No users, demo accounts, or production data were inserted.
