import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../auth/current-user.decorator';
import { AuthenticatedUser, JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PublishPageDto } from './publication.dto';
import { PublicationService } from './publication.service';

@UseGuards(JwtAuthGuard)
@Controller('publications')
export class PublicationController {
  constructor(private readonly publicationService: PublicationService) {}

  @Get()
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.publicationService.list(user.userId);
  }

  @Post()
  publish(@CurrentUser() user: AuthenticatedUser, @Body() dto: PublishPageDto) {
    return this.publicationService.publish(user.userId, dto);
  }

  @Patch(':id/verify-domain')
  verifyDomain(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.publicationService.verifyPublicationDomain(user.userId, id);
  }

  @Delete(':id')
  remove(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.publicationService.remove(user.userId, id);
  }
}
