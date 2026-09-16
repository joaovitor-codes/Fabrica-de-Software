import { Body, Controller, Post, Request, UseGuards } from "@nestjs/common";
import { AuthGuard } from "../auth/auth.guard";
import { RolesGuard } from "../auth/roles.guard";
import { Roles } from "../auth/roles.decorator";
import { TipoUsuario } from "@prisma/client";
import { PlanoAlimentarDto } from "./dto/plano-alimentar";
import { PlanoAlimentarService } from "./plano-alimentar.service";
import { ProfissionalService } from "../profissional/profissional.service";

@Controller('api/plano-alimentar')
export class PlanoAlimentarController {
  constructor(
    private planoAlimentarService: PlanoAlimentarService,
    private profissionalService: ProfissionalService,
  ) {}

  @UseGuards(AuthGuard, RolesGuard)
  @Roles(TipoUsuario.profissional)
  @Post()
  async createPlanoAlimentar(@Body() planoAlimentarDto: PlanoAlimentarDto, @Request() req) {
    const profissional = await this.profissionalService.findByUsuarioId(req.user.sub);
    return await this.planoAlimentarService.createPlanoAlimentar(planoAlimentarDto, profissional.id);
  }

}