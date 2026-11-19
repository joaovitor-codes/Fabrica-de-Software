import {
  BadRequestException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { IaService } from '../../ia/ia.service';
import { ReceitaIngredienteDTO } from './dtos/receita-ingrediente';
import {
  alimentosSensiveisCitados,
  interpretarIngredientesNaoListados,
  juntarApontados,
} from './ingredientes-ocultos';

const CONFERENCIA_INDISPONIVEL =
  'Não foi possível conferir os ingredientes do modo de preparo agora. ' +
  'Tente de novo em alguns minutos.';

/**
 * A lista de ingredientes da receita: validação antes de gravar e a
 * checagem, por IA, de ingredientes citados no modo de preparo que faltam
 * na lista. Usado ao criar e editar receita e na adaptação.
 */
@Injectable()
export class IngredientesReceitaService {
  private readonly logger = new Logger(IngredientesReceitaService.name);

  constructor(
    private readonly prismaService: PrismaService,
    private readonly iaService: IaService,
  ) {}

  /**
   * Confere a lista de ingredientes antes de gravar: repetido ou inexistente
   * daria erro 500 no banco (chave e FK de receita_ingredientes). Devolve os
   * ingredientes, na ordem da lista, para a checagem do modo de preparo.
   */
  async validarIngredientes(itens: ReceitaIngredienteDTO[]) {
    const ids = itens.map((i) => i.ingredienteId);
    const repetidos = [
      ...new Set(ids.filter((id, i) => ids.indexOf(id) !== i)),
    ];
    if (repetidos.length > 0) {
      throw new BadRequestException(
        `Ingrediente repetido na receita: ${repetidos.join(', ')}`,
      );
    }

    const idsUnidades = [...new Set(itens.map((i) => i.unidadeMedidaId))];
    const [ingredientes, unidades] = await Promise.all([
      this.prismaService.ingrediente.findMany({
        where: { id: { in: ids } },
        select: { id: true, nome: true },
      }),
      this.prismaService.unidadeMedida.findMany({
        where: { id: { in: idsUnidades }, ativo: true },
        select: { id: true },
      }),
    ]);

    const encontrados = new Map(ingredientes.map((i) => [i.id, i]));
    const faltando = ids.filter((id) => !encontrados.has(id));
    if (faltando.length > 0) {
      throw new BadRequestException(
        `Ingrediente não encontrado: ${faltando.join(', ')}`,
      );
    }
    const unidadesOk = new Set(unidades.map((u) => u.id));
    const unidadesFaltando = idsUnidades.filter((id) => !unidadesOk.has(id));
    if (unidadesFaltando.length > 0) {
      throw new BadRequestException(
        `Unidade de medida não encontrada ou inativa: ${unidadesFaltando.join(', ')}`,
      );
    }

    return ids.map((id) => encontrados.get(id)!);
  }

  /**
   * Ingredientes que o modo de preparo cita e a lista não tem: o que a IA
   * aponta mais os alimentos sensíveis achados por palavra, sem IA (o texto
   * do autor não consegue escondê-los). Se a IA falha ou responde fora do
   * formato, a conferência não aconteceu: 503, e quem chama não grava nada.
   * Lista vazia quer dizer só "conferido, nada a apontar".
   */
  async verificarIngredientesOcultos(
    modoPreparo: string | null | undefined,
    nomesIngredientes: string[],
  ): Promise<string[]> {
    if (!modoPreparo?.trim()) {
      return [];
    }
    let resposta: unknown;
    try {
      resposta = await this.iaService.ingredientesNaoListados(
        modoPreparo,
        nomesIngredientes,
      );
    } catch (erro) {
      this.logger.error(
        `Falha ao conferir ingredientes do modo de preparo: ${erro}`,
      );
      throw new ServiceUnavailableException(CONFERENCIA_INDISPONIVEL);
    }
    const daIa = interpretarIngredientesNaoListados(resposta);
    if (!daIa) {
      this.logger.error(
        `Resposta da IA fora do formato ao conferir o modo de preparo: ${JSON.stringify(resposta)}`,
      );
      throw new ServiceUnavailableException(CONFERENCIA_INDISPONIVEL);
    }
    return juntarApontados(
      daIa,
      alimentosSensiveisCitados(modoPreparo, nomesIngredientes),
    );
  }

  /** Aviso ao autor quando a IA apontou ingrediente fora da lista. */
  avisoIngredientesOcultos(ingredientesNaoListados: string[]) {
    if (ingredientesNaoListados.length === 0) {
      return {};
    }
    return {
      aviso:
        `O modo de preparo cita ingredientes que não estão na lista: ` +
        `${ingredientesNaoListados.join(', ')}. Inclua-os na receita: ` +
        `enquanto isso, ela não aparece para quem tem alergia ou restrição grave.`,
    };
  }
}
