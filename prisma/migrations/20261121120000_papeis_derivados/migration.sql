-- Papéis derivados dos registros (#168): a conta é paciente se tem o
-- registro de Paciente, qualquer que seja o tipo principal. O profissional
-- pode ser paciente de outro nutricionista.
--
-- O registro de paciente passa a aceitar conta 'paciente' ou
-- 'profissional', e ninguém é paciente de si mesmo: o profissional
-- responsável não pode ser o próprio usuário do paciente.
CREATE OR REPLACE FUNCTION check_tipo_paciente()
RETURNS TRIGGER AS $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM usuarios
        WHERE id = NEW.usuario_id AND tipo_usuario IN ('paciente', 'profissional')
    ) THEN
        RAISE EXCEPTION 'Violacao de integridade: o usuario precisa ser do tipo paciente ou profissional.';
    END IF;
    IF NEW.profissional_id IS NOT NULL AND EXISTS (
        SELECT 1 FROM profissionais
        WHERE id = NEW.profissional_id AND usuario_id = NEW.usuario_id
    ) THEN
        RAISE EXCEPTION 'Violacao de integridade: o profissional nao pode ser responsavel pelo proprio registro de paciente.';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER trg_valida_paciente ON pacientes;
CREATE TRIGGER trg_valida_paciente
BEFORE INSERT OR UPDATE OF usuario_id, profissional_id ON pacientes
FOR EACH ROW EXECUTE FUNCTION check_tipo_paciente();
