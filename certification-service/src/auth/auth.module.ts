import { Module } from '@nestjs/common';
import { AuthClientService } from '../auth-client/auth-client.service';
import { JwtAuthGuard } from './jwt-auth.guard';
import { InternalAuthGuard } from './internal-api-key.guard';
import { RolesGuard } from './roles.guard';

@Module({
  providers: [AuthClientService, JwtAuthGuard, InternalAuthGuard, RolesGuard],
  exports: [AuthClientService, JwtAuthGuard, InternalAuthGuard, RolesGuard],
})
export class AuthModule {}
