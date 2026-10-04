-- Reviewed foundation migration. Runtime roles are never schema owners.
DO $$ BEGIN
 IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='corridra_runtime') THEN CREATE ROLE corridra_runtime NOLOGIN NOSUPERUSER NOBYPASSRLS; END IF;
 IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='corridra_auth') THEN CREATE ROLE corridra_auth NOLOGIN NOSUPERUSER NOBYPASSRLS; END IF;
END $$;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
CREATE SCHEMA identity;
CREATE SCHEMA app;
REVOKE ALL ON SCHEMA identity, app FROM PUBLIC;
GRANT USAGE ON SCHEMA identity TO corridra_auth;
GRANT USAGE ON SCHEMA app TO corridra_runtime;

CREATE TABLE identity."user" (
 id text PRIMARY KEY, name text NOT NULL, email text NOT NULL UNIQUE,
 "emailVerified" boolean NOT NULL DEFAULT false, image text,
 "createdAt" timestamptz NOT NULL DEFAULT now(), "updatedAt" timestamptz NOT NULL DEFAULT now(),
 "twoFactorEnabled" boolean NOT NULL DEFAULT false
);
CREATE TABLE identity.session (
 id text PRIMARY KEY, "userId" text NOT NULL REFERENCES identity."user"(id) ON DELETE CASCADE,
 token text NOT NULL UNIQUE, "expiresAt" timestamptz NOT NULL,
 "createdAt" timestamptz NOT NULL DEFAULT now(), "updatedAt" timestamptz NOT NULL DEFAULT now(),
 "ipAddress" text, "userAgent" text
);
CREATE INDEX session_user_idx ON identity.session("userId");
CREATE TABLE identity.account (
 id text PRIMARY KEY, "accountId" text NOT NULL, "providerId" text NOT NULL,
 "userId" text NOT NULL REFERENCES identity."user"(id) ON DELETE CASCADE,
 "accessToken" text, "refreshToken" text, "idToken" text,
 "accessTokenExpiresAt" timestamptz, "refreshTokenExpiresAt" timestamptz, scope text, password text,
 "createdAt" timestamptz NOT NULL DEFAULT now(), "updatedAt" timestamptz NOT NULL DEFAULT now(),
 UNIQUE("providerId", "accountId")
);
CREATE INDEX account_user_idx ON identity.account("userId");
CREATE TABLE identity.verification (
 id text PRIMARY KEY, identifier text NOT NULL, value text NOT NULL, "expiresAt" timestamptz NOT NULL,
 "createdAt" timestamptz NOT NULL DEFAULT now(), "updatedAt" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX verification_identifier_idx ON identity.verification(identifier);
CREATE TABLE identity."twoFactor" (
 id text PRIMARY KEY, "userId" text NOT NULL UNIQUE REFERENCES identity."user"(id) ON DELETE CASCADE,
 secret text NOT NULL, "backupCodes" text NOT NULL, verified boolean NOT NULL DEFAULT true,
 "failedVerificationCount" integer NOT NULL DEFAULT 0, "lockedUntil" timestamptz
);
CREATE TABLE identity."rateLimit" (id text PRIMARY KEY, key text NOT NULL UNIQUE, count integer NOT NULL, "lastRequest" bigint NOT NULL);
CREATE TABLE identity.principal (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), identity_id text NOT NULL UNIQUE REFERENCES identity."user"(id),
 operating_country text NOT NULL CHECK(operating_country ~ '^[A-Z]{2}$'), disabled_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE identity.assurance (
 session_id text PRIMARY KEY REFERENCES identity.session(id) ON DELETE CASCADE,
 verified_at timestamptz NOT NULL, method text NOT NULL CHECK(method IN ('totp','passkey')),
 CHECK(verified_at <= now() + interval '5 seconds')
);
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA identity TO corridra_auth;
-- The auth provider cannot read tenant business tables or grant tenant membership.
CREATE TABLE app.tenant (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text NOT NULL CHECK(length(name) BETWEEN 1 AND 120),
 synthetic boolean NOT NULL DEFAULT false, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE app.organisation (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text NOT NULL, country text NOT NULL,
 synthetic boolean NOT NULL DEFAULT false, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE app.membership (
 tenant_id uuid NOT NULL REFERENCES app.tenant(id), user_id uuid NOT NULL REFERENCES identity.principal(id),
 role text NOT NULL CHECK(role IN ('owner','admin','operator','reviewer','viewer')),
 allowed_purposes text[] NOT NULL DEFAULT ARRAY['synthetic_validation'],
 allowed_classifications text[] NOT NULL DEFAULT ARRAY['PUBLIC','INTERNAL'],
 allowed_countries text[] NOT NULL DEFAULT ARRAY['DE','ES'],
 revoked_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(tenant_id,user_id)
);
CREATE INDEX membership_user_idx ON app.membership(user_id,tenant_id);

-- Fixed search paths and no dynamic SQL. Only a bearer-derived hash identifies an actor.
CREATE FUNCTION app.actor_id() RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT p.id FROM identity.session s JOIN identity.assurance a ON a.session_id=s.id
 JOIN identity.principal p ON p.identity_id=s."userId" JOIN identity."user" u ON u.id=p.identity_id
 WHERE encode(sha256(convert_to(s.token,'UTF8')),'hex')=current_setting('corridra.session_hash',true)
 AND s."expiresAt">now() AND s."createdAt">now()-interval '24 hours'
 AND a.verified_at>now()-interval '12 hours' AND p.disabled_at IS NULL AND u."twoFactorEnabled"=true
$$;
CREATE FUNCTION app.member_role(target uuid) RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT m.role FROM app.membership m JOIN identity.principal p ON p.id=m.user_id
 WHERE m.tenant_id=target AND target=NULLIF(current_setting('corridra.tenant_id',true),'')::uuid AND m.user_id=app.actor_id() AND m.revoked_at IS NULL
 AND p.operating_country=ANY(m.allowed_countries)
 AND current_setting('corridra.purpose',true)=ANY(m.allowed_purposes)
$$;
CREATE FUNCTION app.can_access(target uuid, data_class text, data_purpose text) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT EXISTS(SELECT 1 FROM app.membership m WHERE m.tenant_id=target AND m.user_id=app.actor_id()
 AND m.revoked_at IS NULL AND app.member_role(target) IS NOT NULL
 AND data_class=ANY(m.allowed_classifications) AND data_purpose=current_setting('corridra.purpose',true))
$$;
CREATE FUNCTION app.fresh_mfa() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT EXISTS(SELECT 1 FROM identity.session s JOIN identity.assurance a ON a.session_id=s.id
 WHERE encode(sha256(convert_to(s.token,'UTF8')),'hex')=current_setting('corridra.session_hash',true)
 AND a.verified_at>now()-interval '5 minutes' AND app.actor_id() IS NOT NULL)
$$;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA app FROM PUBLIC;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA app TO corridra_runtime;
ALTER TABLE app.tenant ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.membership ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_read ON app.tenant FOR SELECT TO corridra_runtime USING(app.member_role(id) IS NOT NULL);
CREATE POLICY membership_read ON app.membership FOR SELECT TO corridra_runtime USING(app.member_role(tenant_id) IS NOT NULL);
CREATE POLICY membership_add ON app.membership FOR INSERT TO corridra_runtime WITH CHECK(app.member_role(tenant_id)='owner' AND app.fresh_mfa());
CREATE POLICY membership_change ON app.membership FOR UPDATE TO corridra_runtime USING(app.member_role(tenant_id)='owner' AND app.fresh_mfa()) WITH CHECK(app.member_role(tenant_id)='owner' AND app.fresh_mfa());
GRANT SELECT ON app.tenant, app.organisation TO corridra_runtime;
GRANT SELECT,INSERT,UPDATE ON app.membership TO corridra_runtime;

CREATE TABLE app.country (code text PRIMARY KEY CHECK(code ~ '^[A-Z]{2}$'), name text NOT NULL);
CREATE TABLE app.corridor (code text PRIMARY KEY, origin_country text NOT NULL REFERENCES app.country(code), destination_country text NOT NULL REFERENCES app.country(code));
INSERT INTO app.country VALUES ('BD','Bangladesh'),('ES','Spain'),('DE','Germany');
INSERT INTO app.corridor VALUES ('BD-ES','BD','ES');
GRANT SELECT ON app.country,app.corridor TO corridra_runtime;
