"""
migrations.py — Version-based database migrations.
Each migration is a (version, sql) tuple. Runs in order, skips already-applied.
"""
import json

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
    (12, """
        DELETE FROM pipeline_steps WHERE service_id='crm';
        DELETE FROM services WHERE id='crm';

        INSERT INTO services (
            id,name,type,base_url,health_path,enabled,timeout_ms,retry_count,endpoint_path,meta
        )
        VALUES
            (
                'flowable-adapter',
                'Flowable Adapter',
                'orchestrator',
                'http://orchestrators:8011',
                '/health',
                TRUE,
                10000,
                2,
                '/orchestrate',
                '{}'::jsonb
            ),
            (
                'custom-adapter',
                'Custom Adapter',
                'orchestrator',
                'http://orchestrators:8012',
                '/health',
                TRUE,
                10000,
                2,
                '/orchestrate',
                '{}'::jsonb
            ),
            (
                'flowable-rest',
                'Flowable REST Engine',
                'engine',
                'http://flowable-rest:8080/flowable-rest/service',
                '/actuator/health',
                TRUE,
                10000,
                2,
                '',
                '{}'::jsonb
            ),
            (
                'isoftpull',
                'iSoftPull',
                'connector',
                'http://isoftpull:8101',
                '/health',
                TRUE,
                10000,
                2,
                '/api/pull',
                '{}'::jsonb
            ),
            (
                'creditsafe',
                'Creditsafe',
                'connector',
                'http://creditsafe:8102',
                '/health',
                TRUE,
                10000,
                2,
                '/api/report',
                '{}'::jsonb
            ),
            (
                'plaid',
                'Plaid',
                'connector',
                'http://plaid:8103',
                '/health',
                TRUE,
                10000,
                2,
                '/api/accounts',
                '{}'::jsonb
            ),
            (
                'report-parser',
                'Report Parser',
                'processor',
                'http://processors:8105',
                '/health',
                TRUE,
                10000,
                2,
                '/api/v1/parse',
                '{}'::jsonb
            ),
            (
                'stop-factor',
                'Stop Factor',
                'processor',
                'http://processors:8106',
                '/health',
                TRUE,
                10000,
                2,
                '/api/v1/check',
                '{}'::jsonb
            )
        ON CONFLICT (id) DO NOTHING;

        INSERT INTO services (
            id,name,type,base_url,health_path,enabled,timeout_ms,retry_count,endpoint_path,meta
        )
        VALUES (
            'decision-service',
            'Decision Service',
            'processor',
            'http://processors:8107',
            '/health',
            TRUE,
            10000,
            1,
            '/api/v1/decide',
            '{"owner":"processors","editable_rules":"stop_factors.stage=decision"}'::jsonb
        )
        ON CONFLICT (id) DO UPDATE SET
            name=EXCLUDED.name,
            type=EXCLUDED.type,
            base_url=EXCLUDED.base_url,
            health_path=EXCLUDED.health_path,
            endpoint_path=EXCLUDED.endpoint_path,
            meta=EXCLUDED.meta,
            updated_at=NOW();

        UPDATE pipeline_steps
        SET step_order=1, meta=COALESCE(meta, '{}'::jsonb) - 'skip_in_flowable', updated_at=NOW()
        WHERE pipeline_name='default' AND service_id='isoftpull';

        UPDATE pipeline_steps
        SET step_order=2, meta=COALESCE(meta, '{}'::jsonb) - 'skip_in_flowable', updated_at=NOW()
        WHERE pipeline_name='default' AND service_id='creditsafe';

        UPDATE pipeline_steps
        SET step_order=3, meta=COALESCE(meta, '{}'::jsonb) || '{"skip_in_flowable": true}'::jsonb, updated_at=NOW()
        WHERE pipeline_name='default' AND service_id='plaid';

        INSERT INTO pipeline_steps (pipeline_name, step_order, service_id, enabled, meta)
        SELECT 'default', 1, 'isoftpull', TRUE, '{}'::jsonb
        WHERE NOT EXISTS (
            SELECT 1 FROM pipeline_steps WHERE pipeline_name='default' AND service_id='isoftpull'
        );

        INSERT INTO pipeline_steps (pipeline_name, step_order, service_id, enabled, meta)
        SELECT 'default', 2, 'creditsafe', TRUE, '{}'::jsonb
        WHERE NOT EXISTS (
            SELECT 1 FROM pipeline_steps WHERE pipeline_name='default' AND service_id='creditsafe'
        );

        INSERT INTO pipeline_steps (pipeline_name, step_order, service_id, enabled, meta)
        SELECT 'default', 3, 'plaid', TRUE, '{"skip_in_flowable": true}'::jsonb
        WHERE NOT EXISTS (
            SELECT 1 FROM pipeline_steps WHERE pipeline_name='default' AND service_id='plaid'
        );

        UPDATE stop_factors
        SET stage='decision',
            field_path='result.parsed_report.summary.credit_score',
            operator='gte',
            threshold='580',
            action_on_fail='REJECT',
            priority=10,
            updated_at=NOW()
        WHERE name='Min credit score';

        DELETE FROM stop_factors WHERE name='Minimum linked accounts';

        INSERT INTO stop_factors (name, stage, check_type, field_path, operator, threshold, action_on_fail, enabled, priority, meta)
        SELECT 'Required reports available', 'decision', 'field_check', 'result.parsed_report.summary.required_reports_available', 'eq', 'true', 'REVIEW', TRUE, 5, '{"decision_rule":true}'::jsonb
        WHERE NOT EXISTS (SELECT 1 FROM stop_factors WHERE name='Required reports available');

        INSERT INTO stop_factors (name, stage, check_type, field_path, operator, threshold, action_on_fail, enabled, priority, meta)
        SELECT 'Max collection count 5', 'decision', 'field_check', 'result.parsed_report.summary.collection_count', 'lte', '5', 'REJECT', TRUE, 20, '{"decision_rule":true}'::jsonb
        WHERE NOT EXISTS (SELECT 1 FROM stop_factors WHERE name='Max collection count 5');

        INSERT INTO stop_factors (name, stage, check_type, field_path, operator, threshold, action_on_fail, enabled, priority, meta)
        SELECT 'Max Creditsafe alerts 1', 'decision', 'field_check', 'result.parsed_report.summary.creditsafe_compliance_alert_count', 'lte', '1', 'REJECT', TRUE, 30, '{"decision_rule":true}'::jsonb
        WHERE NOT EXISTS (SELECT 1 FROM stop_factors WHERE name='Max Creditsafe alerts 1');

        UPDATE stop_factors
        SET stage='decision',
            check_type='field_check',
            field_path='result.parsed_report.summary.required_reports_available',
            operator='eq',
            threshold='true',
            action_on_fail='REVIEW',
            priority=5,
            meta=COALESCE(meta, '{}'::jsonb) || '{"decision_rule":true}'::jsonb,
            updated_at=NOW()
        WHERE name='Required reports available';

        UPDATE stop_factors
        SET stage='decision',
            check_type='field_check',
            field_path='result.parsed_report.summary.collection_count',
            operator='lte',
            threshold='5',
            action_on_fail='REJECT',
            priority=20,
            meta=COALESCE(meta, '{}'::jsonb) || '{"decision_rule":true}'::jsonb,
            updated_at=NOW()
        WHERE name='Max collection count 5';

        UPDATE stop_factors
        SET stage='decision',
            check_type='field_check',
            field_path='result.parsed_report.summary.creditsafe_compliance_alert_count',
            operator='lte',
            threshold='1',
            action_on_fail='REJECT',
            priority=30,
            meta=COALESCE(meta, '{}'::jsonb) || '{"decision_rule":true}'::jsonb,
            updated_at=NOW()
        WHERE name='Max Creditsafe alerts 1';
    """),

    (13, """
        -- Client behavior history for AI Pre-Screen
        CREATE TABLE IF NOT EXISTS client_history (
            id SERIAL PRIMARY KEY,
            client_key TEXT NOT NULL,
            request_id TEXT NOT NULL,
            event_type TEXT NOT NULL DEFAULT 'APPLICATION',
            credit_score INTEGER,
            collection_count INTEGER,
            decision TEXT,
            decision_reason TEXT,
            decision_source TEXT,
            ai_risk_score INTEGER,
            ai_recommendation TEXT,
            product_type TEXT,
            city TEXT,
            state TEXT,
            route_mode TEXT,
            processing_time_ms INTEGER,
            created_at TIMESTAMPTZ DEFAULT NOW()
        );
        CREATE INDEX IF NOT EXISTS idx_client_history_key ON client_history(client_key, created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_client_history_created ON client_history(created_at DESC);

        INSERT INTO services (id, name, type, base_url, health_path, enabled, timeout_ms, retry_count, endpoint_path, meta)
        VALUES (
            'ai-prescreen',
            'AI Pre-Screen',
            'processor',
            'http://ai-prescreen:8109',
            '/health',
            TRUE,
            10000,
            1,
            '/api/v1/prescreen',
            '{"model":"gpt-4o-mini","owner":"ai-prescreen","optional":true,"position":"before_routing"}'::jsonb
        )
        ON CONFLICT (id) DO NOTHING;

        INSERT INTO services (id, name, type, base_url, health_path, enabled, timeout_ms, retry_count, endpoint_path, meta)
        VALUES (
            'ai-advisor',
            'AI Risk Advisor',
            'processor',
            'http://ai-advisor:8108',
            '/health',
            TRUE,
            15000,
            1,
            '/api/v1/assess',
            '{"model":"gpt-4o-mini","owner":"ai-advisor","optional":true}'::jsonb
        )
        ON CONFLICT (id) DO NOTHING;

        INSERT INTO pipeline_steps (pipeline_name, step_order, service_id, enabled, meta)
        SELECT 'default', 4, 'ai-advisor', TRUE, '{"optional":true}'::jsonb
        WHERE NOT EXISTS (
            SELECT 1 FROM pipeline_steps WHERE pipeline_name='default' AND service_id='ai-advisor'
        );

        INSERT INTO stop_factors (name, stage, check_type, field_path, operator, threshold, action_on_fail, enabled, priority, meta)
        SELECT 'AI high risk score', 'decision', 'field_check', 'result.ai_assessment.risk_score', 'gte', '80', 'REVIEW', TRUE, 2, '{"decision_rule":true,"ai_rule":true}'::jsonb
        WHERE NOT EXISTS (SELECT 1 FROM stop_factors WHERE name='AI high risk score');
    """),

    (14, """
        CREATE TABLE IF NOT EXISTS ai_usage_log (
            id          SERIAL PRIMARY KEY,
            request_id  TEXT,
            service_id  TEXT NOT NULL,
            model       TEXT NOT NULL DEFAULT 'gpt-4o-mini',
            prompt_tokens      INTEGER DEFAULT 0,
            completion_tokens  INTEGER DEFAULT 0,
            total_tokens       INTEGER DEFAULT 0,
            cost_usd    NUMERIC(10,6) DEFAULT 0,
            status      TEXT DEFAULT 'ok',
            error_code  TEXT,
            created_at  TIMESTAMPTZ DEFAULT NOW()
        );
        CREATE INDEX IF NOT EXISTS idx_ai_usage_service_ts ON ai_usage_log (service_id, created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_ai_usage_ts        ON ai_usage_log (created_at DESC);
    """),

    (15, """
        ALTER TABLE requests ADD COLUMN IF NOT EXISTS persisted_at TIMESTAMPTZ;
        ALTER TABLE requests ADD COLUMN IF NOT EXISTS recovery_attempts INTEGER NOT NULL DEFAULT 0;
        ALTER TABLE requests ADD COLUMN IF NOT EXISTS last_recovery_at TIMESTAMPTZ;

        -- Back-fill persisted_at for existing rows
        UPDATE requests SET persisted_at = created_at WHERE persisted_at IS NULL;

        -- Index for recovery queries (requests stuck in intermediate states)
        CREATE INDEX IF NOT EXISTS idx_requests_status_created ON requests(status, created_at);
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
        ("report-parser", "Report Parser", "processor", "http://processors:8105", "/health", "/api/v1/parse"),
        ("stop-factor", "Stop Factor", "processor", "http://processors:8106", "/health", "/api/v1/check"),
        ("decision-service", "Decision Service", "processor", "http://processors:8107", "/health", "/api/v1/decide"),
        ("ai-advisor", "AI Risk Advisor", "processor", "http://ai-advisor:8108", "/health", "/api/v1/assess"),
        ("ai-prescreen", "AI Pre-Screen", "processor", "http://ai-prescreen:8109", "/health", "/api/v1/prescreen"),
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
        ("Blacklist SSN", "pre", "blacklist", "ssn", "not_in", "blacklist", "REJECT", 5),
        ("Required reports available", "decision", "field_check", "result.parsed_report.summary.required_reports_available", "eq", "true", "REVIEW", 5),
        ("Min credit score", "decision", "field_check", "result.parsed_report.summary.credit_score", "gte", "580", "REJECT", 10),
        ("Max collection count 5", "decision", "field_check", "result.parsed_report.summary.collection_count", "lte", "5", "REJECT", 20),
        ("Max Creditsafe alerts 1", "decision", "field_check", "result.parsed_report.summary.creditsafe_compliance_alert_count", "lte", "1", "REJECT", 30),
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

    steps = [
        {"pipeline_name": "default", "step_order": 1, "service_id": "isoftpull", "meta": {}},
        {"pipeline_name": "default", "step_order": 2, "service_id": "creditsafe", "meta": {}},
        {"pipeline_name": "default", "step_order": 3, "service_id": "plaid", "meta": {"skip_in_flowable": True}},
        {"pipeline_name": "default", "step_order": 4, "service_id": "ai-advisor", "meta": {"optional": True}},
    ]
    for step in steps:
        cur.execute("SELECT id FROM pipeline_steps WHERE pipeline_name=%s AND service_id=%s", (step["pipeline_name"], step["service_id"]))
        row = cur.fetchone()
        if row:
            cur.execute(
                "UPDATE pipeline_steps SET step_order=%s, enabled=TRUE, meta=%s, updated_at=NOW() WHERE id=%s",
                (step["step_order"], json.dumps(step["meta"]), row[0]),
            )
        else:
            cur.execute(
                "INSERT INTO pipeline_steps (pipeline_name,step_order,service_id,meta) VALUES (%s,%s,%s,%s)",
                (step["pipeline_name"], step["step_order"], step["service_id"], json.dumps(step["meta"])),
            )

    cur.execute("INSERT INTO system_state (key, value_text) VALUES ('config_version', '1') ON CONFLICT (key) DO NOTHING")
    cur.execute("INSERT INTO system_state (key, value_text) VALUES ('seed_completed', 'true') ON CONFLICT (key) DO UPDATE SET value_text='true'")

    conn.commit()
    cur.close()
    print("[seed] defaults ensured (first run)")
