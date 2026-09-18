import { ConflictException, Injectable, InternalServerErrorException, Logger, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { RegraNutricionalService } from "./regra-nutricional.service";
import { IaService } from "../ia/ia.service";
import { SugestaoSubstituto } from "../ia/dtos/ia";
import { IngredienteDTO } from "../ingrediente/dto/ingrediente";

@Injectable()
export class IngredienteSubstitutoService {
  private readonly logger = new Logger(IngredienteSubstitutoService.name);

  constructor(
    private readonly prismaService: PrismaService,
    private readonly regraNutricionalService: RegraNutricionalService,
    private readonly iaService: IaService,
  ) {}

  private async validarIngredienteRestricao(ingredienteId: string, restricaoId: string) {
    const [ingrediente, restricao] = await Promise.all([
        this.prismaService.ingrediente.findUnique({ where: { id: ingredienteId } }),
        this.prismaService.restricaoAlimentar.findUnique({ where: { id: restricaoId } }),
    ])

    if (!ingrediente) {
        throw new NotFoundException(`Ingrediente não encontrado.`);
    }

    if (!restricao) {
        throw new NotFoundException(`Restrição alimentar não encontrada.`);
    }

    return { ingrediente, restricao };
  }

  async findAll(ingredienteId: string, restricaoId: string) {
    await this.validarIngredienteRestricao(ingredienteId, restricaoId);

    return this.prismaService.ingredienteSubstituto.findMany({
      where: { ingredienteOrigemId: ingredienteId, restricaoId },
      include: { restricao: true, ingredienteDestino: true },
      orderBy: { prioridade: 'asc' },
    });
  }

  async gerarSubstituto(ingredienteId: string, restricaoId: string){
    const { ingrediente, restricao } = await this.validarIngredienteRestricao(ingredienteId, restricaoId);

    const jaExiste = await this.prismaService.ingredienteSubstituto.findFirst({
        where: { ingredienteOrigemId: ingredienteId, restricaoId },
    });

    if (jaExiste) {
        throw new ConflictException(`Já existe um substituto para esse ingrediente e restrição`);
    }

    const sugestoes = await this.iaService.encontrarSubstituto(ingrediente.nome, restricao.nome);

    const criados = await this.prismaService.$transaction(async (tx) => {
        const resultados: Array<{ ingredienteId: string; vinculo: unknown}> = [];

        for (let index =0; index < sugestoes.length; index++){
            const sugestao = sugestoes[index];

            const novoIngrediente = await tx.ingrediente.create({
                data: this.mapSugestaoParaIngrediente(sugestao),
            });

            const vinculo = await tx.ingredienteSubstituto.create({
                data: {
                    ingredienteOrigemId: ingredienteId, restricaoId,
                    ingredienteDestinoId: novoIngrediente.id,
                    prioridade: index,
                    observacao: sugestao.justificativa,
                },
                include: { restricao: true, ingredienteDestino: true },
            });

            resultados.push({ ingredienteId: novoIngrediente.id, vinculo });
        }
        return resultados;
    });

    for(const criado of criados){
        await this.regraNutricionalService.avaliarIngrediente(criado.ingredienteId);
    }

    return criados.map(c => c.vinculo);
  }

  private parseNumeroSeguro(valor: string): number {
    const numero = parseFloat(valor.replace(',', '.'));
    if(isNaN(numero)){
        this.logger.error(`Valor nutricional inválido recebido da IA: "${valor}"`);
        throw new InternalServerErrorException(`Valor nutricional inválido recebido da IA: "${valor}"`);
    }
    return numero;
  }

   private mapSugestaoParaIngrediente(sugestao: SugestaoSubstituto): IngredienteDTO {
    return {
      nome: sugestao.nome,
      caloriasKcal: this.parseNumeroSeguro(sugestao.caloriasKcal),
      proteinasG: this.parseNumeroSeguro(sugestao.proteinasG),
      carboidratosG: this.parseNumeroSeguro(sugestao.carboidratosG),
      gordurasG: this.parseNumeroSeguro(sugestao.gordurasG),
      fibrasG: this.parseNumeroSeguro(sugestao.fibrasG),
      sodioMg: this.parseNumeroSeguro(sugestao.sodioMg),
      fonteDados: 'ia_estimativa_nao_verificada',
    };
  }
}