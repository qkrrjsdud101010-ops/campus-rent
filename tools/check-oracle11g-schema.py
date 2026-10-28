"""Check generated SQL against the actual ERD PDF; never connect to a database.

This is a structural/compatibility check, not an Oracle SQL/PLSQL compiler.
Requires pypdf. Run from any directory with Python 3.9 or newer.
"""
from pathlib import Path
import re
import sys
from collections import Counter

from pypdf import PdfReader

ROOT = Path(__file__).resolve().parents[1]
SQL_DIR = ROOT / 'db/oracle11g'
PDF = ROOT / 'docs/erd/[New-Era] CampusRent_ERD_20261020.pdf'


def require(condition, message):
    if not condition:
        raise AssertionError(message)


def parenthesized(text, start):
    require(text[start] == '(', 'Expected opening parenthesis')
    depth, quoted, i = 0, False, start
    while i < len(text):
        char = text[i]
        if char == "'":
            if quoted and i + 1 < len(text) and text[i + 1] == "'":
                i += 2
                continue
            quoted = not quoted
        elif not quoted:
            if char == '(':
                depth += 1
            elif char == ')':
                depth -= 1
                if depth == 0:
                    return text[start + 1:i], i + 1
        i += 1
    raise AssertionError('Unbalanced SQL parentheses or quotes')


def split_items(body):
    pieces, depth, quoted, start, i = [], 0, False, 0, 0
    while i < len(body):
        char = body[i]
        if char == "'":
            if quoted and i + 1 < len(body) and body[i + 1] == "'":
                i += 2
                continue
            quoted = not quoted
        elif not quoted:
            if char == '(':
                depth += 1
            elif char == ')':
                depth -= 1
            elif char == ',' and depth == 0:
                pieces.append(body[start:i].strip())
                start = i + 1
        i += 1
    pieces.append(body[start:].strip())
    return pieces


def keys(value):
    return tuple(part.strip() for part in value.split(','))


def main():
    expected, expected_fk_columns = {}, set()
    for line in PdfReader(PDF).pages[1].extract_text().splitlines():
        line = line.strip()
        if re.fullmatch(r'[A-Z][A-Z_]+', line):
            table = line
            expected[table] = []
        elif ':' in line and expected:
            match = re.fullmatch(r'(\w+): (NUMBER\(\d+\)|VARCHAR2\(\d+ CHAR\)|CHAR\(\d+\)|TIMESTAMP) (NOT NULL|NULL)( \(FK\))?', line)
            require(match, 'Unrecognized ERD column: ' + line)
            expected[table].append((match[1], match[2], match[3] == 'NULL'))
            if match[4]:
                expected_fk_columns.add((table, match[1]))
    require(len(expected) == 26 and sum(map(len, expected.values())) == 185, 'Unexpected source ERD version/counts')
    scripts = [SQL_DIR / filename for filename in ['01_tables.sql', '02_relationships.sql', '03_sequences.sql']]
    texts = [path.read_text(encoding='utf-8') for path in scripts]
    sql = '\n'.join(texts)
    tables, primary, unique, bodies, definitions = {}, {}, {}, {}, {}
    for match in re.finditer(r'CREATE TABLE (\w+)\s*\(', texts[0]):
        table = match[1]
        body, _ = parenthesized(texts[0], match.end() - 1)
        bodies[table] = body
        tables[table], unique[table] = [], []
        for piece in split_items(body):
            if piece.startswith('CONSTRAINT '):
                key_match = re.fullmatch(r'CONSTRAINT (\w+) (PRIMARY KEY|UNIQUE)\s*\(([^)]+)\)', piece)
                if key_match:
                    if key_match[2] == 'PRIMARY KEY':
                        require(table not in primary, 'Multiple PKs: ' + table)
                        primary[table] = keys(key_match[3])
                    unique[table].append(keys(key_match[3]))
                else:
                    require(re.match(r'CONSTRAINT \w+ CHECK\s*\(', piece), 'Unrecognized table constraint: ' + piece)
            else:
                col = re.fullmatch(r'(\w+) (NUMBER\(\d+\)|VARCHAR2\(\d+ CHAR\)|CHAR\(\d+\)|TIMESTAMP)(?: DEFAULT (.+?))? (NOT NULL|NULL)', piece)
                require(col, 'Unrecognized SQL column: ' + piece)
                tables[table].append((col[1], col[2], col[4] == 'NULL'))
                definitions[table, col[1]] = col[2]
    require(tables == expected, 'SQL table/column names, order, type or NULL declarations differ from PDF')
    require(sum(column[2] for columns in tables.values() for column in columns) == 33, 'Nullable column count differs from ERD')
    print('PASS PDF parity: 26 tables, 185 columns, 33 nullable columns; no column/type/NULL drift')

    composite = {
        'MODEL_SPEC': ('MODEL_ID', 'SPEC_ITEM_ID'),
        'EQUIPMENT_ALTERNATIVE': ('SOURCE_EQUIPMENT_ID', 'TARGET_EQUIPMENT_ID'),
        'FACILITY_HOURS': ('FACILITY_ID', 'WEEKDAY_NO'),
        'PURPOSE_EQUIPMENT_RULE': ('PURPOSE_ID', 'TYPE_ID'),
        'FACILITY_PURPOSE': ('FACILITY_ID', 'PURPOSE_ID'),
        'CHECKOUT_COMPONENT': ('CHECKOUT_ID', 'COMPONENT_SEQ'),
        'RETURN_INSPECTION': ('CHECKOUT_ID', 'INSPECTION_ROUND'),
        'RETURN_COMPONENT': ('CHECKOUT_ID', 'INSPECTION_ROUND', 'COMPONENT_SEQ'),
    }
    require(len(primary) == 26, 'Expected one PK per table')
    for table, columns in expected.items():
        require(primary[table] == composite.get(table, (columns[0][0],)), 'PK mismatch: ' + table)
        for key in unique[table]:
            require(all((table, col) in definitions for col in key), 'Unknown PK/UQ column: ' + table)
    print('PASS 26 primary keys, including the eight visual composite keys and inherited alternative PK')

    fk_pattern = r'ALTER TABLE (\w+) ADD CONSTRAINT (\w+)\s+FOREIGN KEY\s*\(([^)]+)\)\s+REFERENCES (\w+)\s*\(([^)]+)\)\s*;'
    foreign, covered = [], set()
    for table, name, cols, parent, ref in re.findall(fk_pattern, texts[1]):
        cols, ref = keys(cols), keys(ref)
        require(parent in tables and table in tables, 'Unknown FK table: ' + name)
        require(len(cols) == len(ref) and ref in unique[parent], 'Missing parent PK/UQ: ' + name)
        for col, parent_col in zip(cols, ref):
            require(definitions[table, col] == definitions[parent, parent_col], 'FK datatype mismatch: ' + name)
            covered.add((table, col))
        foreign.append((table, cols, parent, ref))
    require(len(foreign) == 44 and covered == expected_fk_columns, 'Missing/additional ERD FK column coverage')
    require(('EQUIPMENT_CHECKOUT', ('REQUEST_ITEM_ID','ITEM_KIND'), 'REQUEST_ITEM', ('REQUEST_ITEM_ID','ITEM_KIND')) in foreign, 'Missing equipment discriminator FK')
    require(('FACILITY_USAGE', ('REQUEST_ITEM_ID','ITEM_KIND'), 'REQUEST_ITEM', ('REQUEST_ITEM_ID','ITEM_KIND')) in foreign, 'Missing facility discriminator FK')
    for parent, tail in [('RETURN_INSPECTION','INSPECTION_ROUND'), ('CHECKOUT_COMPONENT','COMPONENT_SEQ')]:
        require(('RETURN_COMPONENT', ('CHECKOUT_ID',tail), parent, ('CHECKOUT_ID',tail)) in foreign, 'Missing return component compound FK')
    print('PASS 44 foreign keys cover all 47 marked ERD columns, including the four critical compound relationships')

    constraints = re.findall(r'\bCONSTRAINT (\w+)', sql)
    require(len(constraints) == len(set(constraints)), 'Duplicate constraint names: ' + str([name for name,count in Counter(constraints).items() if count > 1]))
    object_names = re.findall(r'\bCREATE (?:UNIQUE )?(?:TABLE|INDEX|SEQUENCE|TRIGGER) (\w+)', sql)
    for name in object_names + constraints + list(tables) + [col[0] for columns in tables.values() for col in columns]:
        require(name.isascii() and len(name.encode('ascii')) <= 30, 'Oracle 11g identifier exceeds 30 bytes: ' + name)
    require(len(object_names) == len(set(object_names)), 'Duplicate explicit object names')
    print('PASS unique object/constraint names and Oracle 11g 30-byte identifiers')

    indexes = {table: list(unique[table]) for table in tables}
    index_count = 0
    for match in re.finditer(r'CREATE (?:UNIQUE )?INDEX (\w+) ON (\w+)\s*\(', texts[1]):
        body, _ = parenthesized(texts[1], match.end() - 1)
        index_count += 1
        if re.fullmatch(r'[\w\s,]+', body):
            indexes[match[2]].append(keys(body))
    require(index_count == 35, 'Unexpected explicit index count')
    for table, columns, _, _ in foreign:
        require(any(key[:len(columns)] == columns for key in indexes[table]), 'FK has no full leading index: ' + table + str(columns))
    for name, kind in [('UX_SEL_EQUIPMENT','E'), ('UX_SEL_FACILITY','F')]:
        start = texts[1].index('CREATE UNIQUE INDEX ' + name)
        body, _ = parenthesized(texts[1], texts[1].index('(', start))
        require(body.count(f"CASE WHEN ITEM_KIND = '{kind}'") == 2, 'Conditional UNIQUE must null both keys outside its kind: ' + name)
    print('PASS 35 explicit indexes, full FK coverage, and NULL-safe conditional selection uniqueness')

    surrogates = {table: key[0] for table,key in primary.items() if len(key) == 1 and (table,key[0]) not in expected_fk_columns}
    sequences = re.findall(r'CREATE SEQUENCE SQ_(\w+)\b', texts[2])
    triggers = re.findall(r'CREATE TRIGGER BI_(\w+)\b', texts[2])
    require(len(surrogates) == 17 and set(sequences) == set(surrogates) and set(triggers) == set(surrogates), 'Surrogate sequences/triggers mismatch')
    for table, column in surrogates.items():
        pattern = rf'CREATE TRIGGER BI_{table}\s+BEFORE INSERT ON {table}\s+FOR EACH ROW\s+BEGIN\s+IF :NEW\.{column} IS NULL THEN\s+SELECT SQ_{table}\.NEXTVAL INTO :NEW\.{column} FROM DUAL;\s+END IF;\s+END;\s*/'
        require(re.search(pattern,texts[2]), 'Invalid conditional 11g ID trigger pattern: ' + table)
    require(texts[2].count('MAXVALUE 9999999999') == 17, 'NUMBER(10) sequence bounds mismatch')
    print('PASS 17 bounded sequences and NULL-only BEFORE INSERT triggers; inherited/shared keys have no new sequence')

    for table,body in bodies.items():
        for col, values in re.findall(r'(\w+) IN\s*\(([^)]+)\)', body):
            if (table,col) not in definitions:
                continue
            limit = re.search(r'(?:VAR)?CHAR2?\((\d+)',definitions[table,col])
            if limit:
                require(all(len(value) <= int(limit[1]) for value in re.findall(r"'([^']*)'",values)), 'Code literal exceeds column capacity: ' + table + '.' + col)
    code = re.sub(r'--[^\n]*','',sql)
    forbidden = [r'\bGENERATED\s+.*?\bIDENTITY\b',r'\bDEFAULT\s+[\w.]+\.NEXTVAL\b',r'\bAUTO_INCREMENT\b',r'\bIF\s+NOT\s+EXISTS\b',r'\bFETCH\s+FIRST\b',r'\bDROP\b',r'\bTRUNCATE\b',r'\bON\s+DELETE\s+CASCADE\b']
    for pattern in forbidden:
        require(not re.search(pattern, code, re.IGNORECASE), 'Unsupported/destructive SQL: ' + pattern)
    print('PASS code lengths and unsupported/destructive syntax guardrails')
    require("TRIM(EMAIL) IS NOT NULL" in bodies['APP_USER'], 'Blank-email CHECK can pass UNKNOWN')
    require('PEOPLE_COUNT IS NOT NULL' in bodies['REQUEST_ITEM'] and 'PURPOSE_ID IS NOT NULL' in bodies['REQUEST_ITEM'], 'Facility required-field CHECK can pass UNKNOWN')
    for filename in ['install.sql','00_preflight.sql','04_verify.sql','README.md','tests/constraints.sql']:
        require((SQL_DIR/filename).is_file(), 'Missing delivery: ' + filename)
    print('PASS Oracle NULL-sensitive requirements and installation/verification documentation are present')
    smoke = (SQL_DIR/'tests/constraints.sql').read_text(encoding='utf-8')
    cases = re.findall(r"WHEN '([A-Z_]+)' THEN", smoke)
    calls = re.findall(r"expect_error\('([A-Z_]+)',\s*(-?\d+),\s*'([A-Z_]+)'\)", smoke)
    require(len(cases) == 23 and set(cases) == {case for case,_,_ in calls}, 'Smoke test cases/calls mismatch')
    for case,code,name in calls:
        require(name in constraints + object_names, 'Unknown expected smoke constraint/index: ' + case)
        require(int(code) in (-1,-2290,-2291), 'Unexpected smoke error contract: ' + case)
    for table, columns in re.findall(r'INSERT INTO (\w+)\s*\(([^)]+)\)', smoke):
        require(table in tables and all((table,col) in definitions for col in keys(columns)), 'Smoke INSERT does not match schema: ' + table)
    require(not re.search(r'^\s*(COMMIT|DROP|TRUNCATE|CREATE)\b',smoke,re.MULTILINE), 'Smoke test commits or creates/removes objects')
    require(smoke.count("'ROLLBACK TO SAVEPOINT '") == 2, 'Smoke test must roll back to its savepoint on both paths')
    print('PASS optional DML fixture columns, 23 expected-failure contracts and local-savepoint rollback paths (not executed)')
    print('\nStatic checks passed. Oracle execution and PL/SQL compilation were NOT performed.')


if __name__ == '__main__':
    try:
        main()
    except (AssertionError, KeyError, ValueError) as error:
        print('FAIL ' + str(error), file=sys.stderr)
        sys.exit(1)
