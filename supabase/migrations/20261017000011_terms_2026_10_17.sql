-- WearWise: terms version 2026-10-17.
-- Live view for setup can now run for a time the participant chooses, 30 minutes up
-- to 8 hours (it was 30 minutes). The terms, privacy policy, research information
-- and researcher terms say so, and packages/legal ACCEPTANCE_VERSION moved to
-- 2026-10-17, so every account is asked to accept again. accept_terms() and sign-up
-- only record versions listed here (20261016000009 §4).

insert into private.terms_versions (version) values ('2026-10-17') on conflict do nothing;
