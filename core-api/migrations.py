"""
migrations.py — Version-based database migrations.
Each migration is a (version, sql) tuple. Runs in order, skips already-applied.
"""
MIGRATIONS = [
    (1, """
        CREATE TABLE IF NOT EXISTS _schema_version (version INTEGER PRIMARY KEY, applied_at TIMESTAMPTZ DEFAULT NOW());

        CREATE TABLE IF NOT EXISTS services (
            id TEXT PRIMARY KEY, name TEXT NOT NULL, type TEXT NOT NULL DEFAULT 'connector',
            base_url TEXT NOT NULL, health_path TEXT DEFAULT '/health', enabled BOOLEAN DEFAULT TRUE,
            timeout_ms INTEGER DEFAULT 10000, retry_count INTEGER DEFAULT 2,
            endpoint_path TEXT DEFAULT '/api/process', meta JSONB DEFAULT '{}',
            updated_at TIMESTAMPTZ DEFAULT NOW()
        );
        CREATE TABLE IF NOT EXISTS routing_rules (
            id SERIAL PRIMARY KEY, name TEXT NOT NULL, priority INTEGER DEFAULT 0,
            condition_field TEXT NOT NULL, condition_op TEXT NOT NULL DEFAULT 'eq',
            condition_value TEXT NOT NULL, target_mode TEXT NOT NULL DEFAULT 'flowable',
            enabled BOOLEAN DEFAULT TRUE, meta JSONB DEFAULT '{}', updated_at TIMESTAMPTZ DEFAULT NOW()
        );
        CREATE TABLE IF NOT EXISTS stop_factors (
            id SERIAL PRIMARY KEY, name TEXT NOT NULL, stage TEXT NOT NULL DEFAULT 'pre',
            check_type TEXT NOT NULL DEFAULT 'field_check', field_path TEXT,
            operator TEXT DEFAULT 'gte', threshold TEXT, action_on_fail TEXT DEFAULT 'REJECT',
            enabled BOOLEAN DEFAULT TRUE, priority INTEGER DEFAULT 0,
            meta JSONB DEFAULT '{}', updated_at TIMESTAMPTZ DEFAULT NOW()
        );
        CREATE TABLE IF NOT EXISTS pipeline_steps (
            id SERIAL PRIMARY KEY, pipeline_name TEXT NOT NULL DEFAULT 'default',
            step_order INTEGER NOT NULL, service_id TEXT NOT NULL REFERENCES services(id) ON DELETE CASCADE,
            enabled BOOLEAN DEFAULT TRUE, meta JSONB DEFAULT '{}', updated_at TIMESTAMPTZ DEFAULT NOW()
        );
        CREATE TABLE IF NOT EXISTS audit_log (
            id SERIAL PRIMARY KEY, entity_type TEXT, entity_id TEXT,
            action TEXT, changes JSONB, performed_at TIMESTAMPTZ DEFAULT NOW()
        );
    """),
    (2, """
        CREATE TABLE IF NOT EXISTS requests (
            id SERIAL PRIMARY KEY,
            request_id TEXT UNIQUE NOT NULL,
            customer_id TEXT,
            iin_encrypted TEXT,
            product_type TEXT,
            orchestration_mode TEXT,
            status TEXT DEFAULT 'SUBMITTED',
            result JSONB,
            post_stop_factor JSONB,
            snp_result JSONB,
            error TEXT,
            correlation_id TEXT,
            created_at TIMESTAMPTZ DEFAULT NOW(),
            updated_at TIMESTAMPTZ DEFAULT NOW()
        );
        CREATE INDEX IF NOT EXISTS idx_requests_status ON requests(status);
        CREATE INDEX IF NOT EXISTS idx_requests_created ON requests(created_at DESC);
    """),
    (3, """
        CREATE TABLE IF NOT EXISTS snp_notifications (
            id SERIAL PRIMARY KEY,
            request_id TEXT,
            snp_target TEXT,
            forwarded BOOLEAN DEFAULT FALSE,
            response_code INTEGER,
            error TEXT,
            sent_at TIMESTAMPTZ DEFAULT NOW()
        );
    """),
    (4, """
        CREATE TABLE IF NOT EXISTS system_state (
            key TEXT PRIMARY KEY,
            value_text TEXT NOT NULL DEFAULT '0',
            updated_at TIMESTAMPTZ DEFAULT NOW()
        );
        INSERT INTO system_state (key, value_text)
        VALUES ('config_version', '1')
        ON CONFLICT (key) DO NOTHING;

        CREATE TABLE IF NOT EXISTS rate_limit_buckets (
            bucket_key TEXT NOT NULL,
            window_start BIGINT NOT NULL,
            hits INTEGER NOT NULL DEFAULT 0,
            updated_at TIMESTAMPTZ DEFAULT NOW(),
            PRIMARY KEY (bucket_key, window_start)
        );

        CREATE TABLE IF NOT EXISTS circuit_breakers (
            service_id TEXT PRIMARY KEY,
            state TEXT NOT NULL DEFAULT 'CLOSED',
            opened_at_epoch DOUBLE PRECISION NOT NULL DEFAULT 0,
            failures_json JSONB NOT NULL DEFAULT '[]',
            updated_at TIMESTAMPTZ DEFAULT NOW()
        );
    """),
    (5, """
        CREATE TABLE IF NOT EXISTS request_tracker_events (
            id SERIAL PRIMARY KEY,
            request_id TEXT NOT NULL,
            stage TEXT NOT NULL,
            service_id TEXT,
            direction TEXT NOT NULL,
            status TEXT,
            title TEXT NOT NULL,
            payload JSONB DEFAULT '{}',
            correlation_id TEXT,
            created_at TIMESTAMPTZ DEFAULT NOW()
        );
        CREATE INDEX IF NOT EXISTS idx_request_tracker_request_id ON request_tracker_events(request_id, id DESC);
        CREATE INDEX IF NOT EXISTS idx_request_tracker_created_at ON request_tracker_events(created_at DESC);
    """),
    (6, """
        CREATE TABLE IF NOT EXISTS admin_users (
            username TEXT PRIMARY KEY,
            display_name TEXT,
            role TEXT NOT NULL DEFAULT 'analyst',
            password_hash TEXT NOT NULL,
            enabled BOOLEAN NOT NULL DEFAULT TRUE,
            source TEXT NOT NULL DEFAULT 'db',
            session_token TEXT,
            session_issued_at TIMESTAMPTZ,
            last_login_at TIMESTAMPTZ,
            created_at TIMESTAMPTZ DEFAULT NOW(),
            updated_at TIMESTAMPTZ DEFAULT NOW()
        );
        CREATE INDEX IF NOT EXISTS idx_admin_users_role ON admin_users(role);
        CREATE INDEX IF NOT EXISTS idx_admin_users_enabled ON admin_users(enabled);
    """),
    (7, """
        ALTER TABLE admin_users ADD COLUMN IF NOT EXISTS session_expires_at TIMESTAMPTZ;
    """),
    (8, """
        ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS performed_by TEXT;
    """),
    (9, """
        ALTER TABLE requests ADD COLUMN IF NOT EXISTS applicant_profile JSONB DEFAULT '{}'::jsonb;
        ALTER TABLE requests ADD COLUMN IF NOT EXISTS ssn_encrypted TEXT;

        UPDATE requests
        SET ssn_encrypted = COALESCE(ssn_encrypted, iin_encrypted)
        WHERE ssn_encrypted IS NULL AND iin_encrypted IS NOT NULL;
    """),
    (10, """
        ALTER TABLE requests ADD COLUMN IF NOT EXISTS ignored BOOLEAN NOT NULL DEFAULT FALSE;
        ALTER TABLE requests ADD COLUMN IF NOT EXISTS ignored_reason TEXT;
        ALTER TABLE requests ADD COLUMN IF NOT EXISTS ignored_at TIMESTAMPTZ;
        ALTER TABLE requests ADD COLUMN IF NOT EXISTS ignored_by TEXT;

        CREATE TABLE IF NOT EXISTS request_notes (
            id SERIAL PRIMARY KEY,
            request_id TEXT NOT NULL REFERENCES requests(request_id) ON DELETE CASCADE,
            note_text TEXT NOT NULL,
            created_by TEXT,
            created_at TIMESTAMPTZ DEFAULT NOW()
        );
        CREATE INDEX IF NOT EXISTS idx_request_notes_request_id ON request_notes(request_id, id DESC);
    """),
    (11, """
        ALTER TABLE requests ADD COLUMN IF NOT EXISTS external_applicant_id TEXT;
        CREATE INDEX IF NOT EXISTS idx_requests_external_applicant_id ON requests(external_applicant_id);

        INSERT INTO services (id,name,type,base_url,health_path,enabled,timeout_ms,retry_count,endpoint_path,meta)
        VALUES (
            'credit-backend',
            'Unified Applicant Backend',
            'external',
            'http://18.119.38.114',
            '/api/v1/credit-providers/available',
            TRUE,
            15000,
            1,
            '',
            '{"owner":"external-credit-server","applicant_contract":"v1"}'::jsonb
        )
        ON CONFLICT (id) DO NOTHING;
    """),
]


def run_migrations(conn):
    cur = conn.cursor()
    # Ensure schema version table exists
    cur.execute("CREATE TABLE IF NOT EXISTS _schema_version (version INTEGER PRIMARY KEY, applied_at TIMESTAMPTZ DEFAULT NOW())")
    conn.commit()

    cur.execute("SELECT version FROM _schema_version ORDER BY version")
    applied = {row[0] for row in cur.fetchall()}

    for version, sql in MIGRATIONS:
        if version not in applied:
            cur.execute(sql)
            cur.execute("INSERT INTO _schema_version (version) VALUES (%s)", (version,))
            conn.commit()
            print(f"[migrations] applied v{version}")

    # P1-08: Migrate legacy XOR encryption (ENC:) to Fernet (ENC2:)
    try:
        cur.execute("SELECT request_id, iin_encrypted FROM requests WHERE iin_encrypted LIKE 'ENC:%%'")
        legacy_rows = cur.fetchall()
        if legacy_rows:
            from shared import encrypt_field, decrypt_field
            migrated = 0
            for rid, iin_enc in legacy_rows:
                try:
                    plaintext = decrypt_field(iin_enc)
                    new_enc = encrypt_field(plaintext)
                    cur.execute("UPDATE requests SET iin_encrypted=%s WHERE request_id=%s", (new_enc, rid))
                    migrated += 1
                except Exception as exc:
                    print(f"[migrations] WARNING: failed to migrate encryption for {rid}: {exc}")
            conn.commit()
            if migrated:
                print(f"[migrations] migrated {migrated}/{len(legacy_rows)} ENC: → ENC2: values")
    except Exception:
        pass  # table may not exist yet on first run

    cur.close()


def seed_defaults(conn):
    cur = conn.cursor()

    # P0-10: Only run seed on first startup — don't overwrite operator changes
    cur.execute("SELECT value_text FROM system_state WHERE key='seed_completed'")
    row = cur.fetchone()
    if row and row[0] == 'true':
        cur.close()
        print("[seed] already completed, skipping (operator data preserved)")
        return

    svcs = [
        ("credit-backend", "Unified Applicant Backend", "external", "http://18.119.38.114", "/api/v1/credit-providers/available", ""),
        ("flowable-adapter", "Flowable Adapter", "orchestrator", "http://orchestrators:8011", "/health", "/orchestrate"),
        ("custom-adapter", "Custom Adapter", "orchestrator", "http://orchestrators:8012", "/health", "/orchestrate"),
        ("flowable-rest", "Flowable REST Engine", "engine", "http://flowable-rest:8080/flowable-rest/service", "/actuator/health", ""),
        ("isoftpull", "iSoftPull", "connector", "http://isoftpull:8101", "/health", "/api/pull"),
        ("creditsafe", "Creditsafe", "connector", "http://creditsafe:8102", "/health", "/api/report"),
        ("plaid", "Plaid", "connector", "http://plaid:8103", "/health", "/api/accounts"),
        ("crm", "CRM", "connector", "http://crm:8104", "/health", "/api/update"),
        ("report-parser", "Report Parser", "processor", "http://processors:8105", "/health", "/api/v1/parse"),
        ("stop-factor", "Stop Factor", "processor", "http://processors:8106", "/health", "/api/v1/check"),
    ]
    for s in svcs:
        cur.execute("INSERT INTO services (id,name,type,base_url,health_path,endpoint_path) VALUES (%s,%s,%s,%s,%s,%s) ON CONFLICT DO NOTHING", s)

    rules = [
        ("Auto -> Flowable default", 10, "orchestration_mode", "eq", "auto", "flowable"),
        ("Custom override", 20, "orchestration_mode", "eq", "custom", "custom"),
    ]
    for r in rules:
        cur.execute("SELECT 1 FROM routing_rules WHERE name=%s", (r[0],))
        if not cur.fetchone():
            cur.execute("INSERT INTO routing_rules (name,priority,condition_field,condition_op,condition_value,target_mode) VALUES (%s,%s,%s,%s,%s,%s)", r)

    stops = [
        ("Min credit score", "post", "field_check", "result.parsed_report.summary.credit_score", "gte", "600", "REJECT", 10),
        ("Minimum linked accounts", "post", "field_check", "result.parsed_report.summary.accounts_found", "gte", "1", "REVIEW", 20),
        ("Blacklist SSN", "pre", "blacklist", "ssn", "not_in", "blacklist", "REJECT", 5),
    ]
    for s in stops:
        cur.execute("SELECT id FROM stop_factors WHERE name=%s", (s[0],))
        row = cur.fetchone()
        if row:
            cur.execute(
                "UPDATE stop_factors SET stage=%s,check_type=%s,field_path=%s,operator=%s,threshold=%s,action_on_fail=%s,priority=%s,updated_at=NOW() WHERE id=%s",
                (s[1], s[2], s[3], s[4], s[5], s[6], s[7], row[0]),
            )
        else:
            cur.execute("INSERT INTO stop_factors (name,stage,check_type,field_path,operator,threshold,action_on_fail,priority) VALUES (%s,%s,%s,%s,%s,%s,%s,%s)", s)

    steps = [("default", 1, "isoftpull"), ("default", 2, "creditsafe"), ("default", 3, "plaid"), ("default", 4, "crm")]
    for s in steps:
        cur.execute("SELECT 1 FROM pipeline_steps WHERE pipeline_name=%s AND step_order=%s AND service_id=%s", s)
        if not cur.fetchone():
            cur.execute("INSERT INTO pipeline_steps (pipeline_name,step_order,service_id) VALUES (%s,%s,%s)", s)

    cur.execute("INSERT INTO system_state (key, value_text) VALUES ('config_version', '1') ON CONFLICT (key) DO NOTHING")
    cur.execute("INSERT INTO system_state (key, value_text) VALUES ('seed_completed', 'true') ON CONFLICT (key) DO UPDATE SET value_text='true'")

    conn.commit()
    cur.close()
    print("[seed] defaults ensured (first run)")
