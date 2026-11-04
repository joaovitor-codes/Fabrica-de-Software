-- A conta só vira profissional quando o admin aprova o cadastro.

-- Quem ainda aguarda a aprovação perde o acesso de profissional até ser aprovado.
UPDATE usuarios SET tipo_usuario = 'comum'
WHERE tipo_usuario = 'profissional'
  AND id IN (SELECT usuario_id FROM profissionais WHERE status_aprovacao <> 'aprovado');

-- Solicitação rejeitada e reaberta não promovia a conta ao ser aprovada.
UPDATE usuarios SET tipo_usuario = 'profissional'
WHERE tipo_usuario = 'comum'
  AND id IN (SELECT usuario_id FROM profissionais WHERE status_aprovacao = 'aprovado');

-- A solicitação agora nasce com a conta comum. O que o banco garante passa a
-- ser: cadastro aprovado só existe em conta profissional.
CREATE OR REPLACE FUNCTION check_tipo_profissional()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.status_aprovacao = 'aprovado' AND NOT EXISTS (
        SELECT 1 FROM usuarios
        WHERE id = NEW.usuario_id AND tipo_usuario = 'profissional'
    ) THEN
        RAISE EXCEPTION 'Violacao de integridade: o usuario precisa ser do tipo profissional.';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER trg_valida_profissional ON profissionais;
CREATE TRIGGER trg_valida_profissional
BEFORE INSERT OR UPDATE OF usuario_id, status_aprovacao ON profissionais
FOR EACH ROW EXECUTE FUNCTION check_tipo_profissional();
