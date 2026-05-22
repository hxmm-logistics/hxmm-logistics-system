INSERT INTO users (username, password_hash, role, display_name, operator_id, is_active)
VALUES
  ('admin', '$2b$12$Z0gJiKYb5cmxDFvtaBbeduOkJEMIvlpRVgDWyl7T85ifU.9SiR4LO', 'admin', 'HX MM Admin', 3, TRUE),
  ('operator', '$2b$12$0mJEo5uX.79CLedQT6JP5.k1MzGNE9peL/Exf3A84qi/owJK.jBNW', 'operator', 'HX MM Operator', 2, TRUE)
ON CONFLICT (username) DO UPDATE
SET password_hash = EXCLUDED.password_hash,
    role = EXCLUDED.role,
    display_name = EXCLUDED.display_name,
    operator_id = EXCLUDED.operator_id,
    is_active = EXCLUDED.is_active,
    updated_at = NOW();
