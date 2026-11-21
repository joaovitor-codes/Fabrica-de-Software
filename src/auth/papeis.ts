import { TipoUsuario } from '@prisma/client';

/**
 * Papéis da conta, derivados dos registros: o `tipoUsuario` (papel
 * principal; profissional só vem da aprovação) mais `paciente` se existe o
 * registro de Paciente. Assim o profissional pode ser paciente de outro
 * nutricionista sem perder nada de nenhum dos dois lados.
 */
export function papeisDaConta(
  tipoUsuario: TipoUsuario,
  temPaciente: boolean,
): TipoUsuario[] {
  return temPaciente && tipoUsuario !== TipoUsuario.paciente
    ? [tipoUsuario, TipoUsuario.paciente]
    : [tipoUsuario];
}
